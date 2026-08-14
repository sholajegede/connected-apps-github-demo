import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { internal } from "./_generated/api";
import { auditEvent, auditOutcome, storageMode } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * The server gateway.
 *
 * Everything that changes state stays an `internalMutation`. This file is the
 * one door into those, and it only opens for a caller that holds
 * `CONVEX_SERVER_SECRET` — a value set on the Convex deployment and known to
 * the Next.js server. The browser never has it, so a page cannot forge an
 * audit row, mark a connection linked, or read the store wholesale.
 *
 * This is not a substitute for user authentication, which arrives with the
 * sign-in flow. It is the boundary that keeps the broker's writes server-side
 * in the meantime.
 */

function assertServer(secret: string): void {
  const expected = process.env.CONVEX_SERVER_SECRET;
  if (!expected) {
    throw new Error(
      "CONVEX_SERVER_SECRET is not set on the Convex deployment. Refusing.",
    );
  }
  if (secret !== expected) {
    throw new Error("Rejected: bad server secret.");
  }
}

const secret = v.string();

/* ------------------------------------------------------------ broker use -- */

/**
 * Everything the broker needs to decide whether it may act, in one round
 * trip: the user and their GitHub connection state.
 */
export const brokerContext = query({
  args: { secret, kindeUserId: v.string() },
  handler: async (
    ctx,
    args,
  ): Promise<{
    user: Doc<"users"> | null;
    connection: Doc<"connections"> | null;
  }> => {
    assertServer(args.secret);

    const user = await ctx.db
      .query("users")
      .withIndex("by_kindeUserId", (q) => q.eq("kindeUserId", args.kindeUserId))
      .unique();
    if (!user) return { user: null, connection: null };

    const connection = await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", user._id).eq("provider", "github"),
      )
      .unique();

    return { user, connection };
  },
});

export const recordAudit = mutation({
  args: {
    secret,
    correlationId: v.string(),
    userId: v.optional(v.id("users")),
    runId: v.optional(v.id("runs")),
    event: auditEvent,
    outcome: auditOutcome,
    actionId: v.optional(v.string()),
    storageMode: storageMode,
    detail: v.optional(v.string()),
  },
  returns: v.id("auditLog"),
  handler: async (ctx, args): Promise<Id<"auditLog">> => {
    assertServer(args.secret);
    const { secret: _secret, ...row } = args;
    return await ctx.runMutation(internal.audit.record, row);
  },
});

export const noteBrokered = mutation({
  args: {
    secret,
    connectionId: v.id("connections"),
    githubLogin: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertServer(args.secret);
    await ctx.runMutation(internal.connections.noteBrokered, {
      connectionId: args.connectionId,
      githubLogin: args.githubLogin,
    });
    return null;
  },
});

/* ------------------------------------------------------ connection setup -- */

export const upsertUser = mutation({
  args: {
    secret,
    kindeUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    assertServer(args.secret);
    return await ctx.runMutation(internal.users.upsert, {
      kindeUserId: args.kindeUserId,
      email: args.email,
      name: args.name,
    });
  },
});

export const markLinked = mutation({
  args: {
    secret,
    userId: v.id("users"),
    kindeConnectionId: v.string(),
    kindeSessionId: v.optional(v.string()),
    githubLogin: v.optional(v.string()),
    grantedScopes: v.optional(v.array(v.string())),
  },
  returns: v.id("connections"),
  handler: async (ctx, args): Promise<Id<"connections">> => {
    assertServer(args.secret);
    const { secret: _secret, ...rest } = args;
    return await ctx.runMutation(internal.connections.markLinked, rest);
  },
});

export const markRevoked = mutation({
  args: { secret, userId: v.id("users") },
  returns: v.union(v.id("connections"), v.null()),
  handler: async (ctx, args): Promise<Id<"connections"> | null> => {
    assertServer(args.secret);
    return await ctx.runMutation(internal.connections.markRevoked, {
      userId: args.userId,
    });
  },
});

export const syncCatalog = mutation({
  args: {
    secret,
    entries: v.array(
      v.object({
        actionId: v.string(),
        title: v.string(),
        description: v.string(),
        effect: v.union(v.literal("read"), v.literal("write")),
        actsAsUser: v.boolean(),
        requiredScopes: v.array(v.string()),
      }),
    ),
  },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    assertServer(args.secret);
    return await ctx.runMutation(internal.catalog.sync, {
      entries: args.entries,
    });
  },
});

/* ------------------------------------------------------------ agent runs -- */

export const startRun = mutation({
  args: {
    secret,
    userId: v.id("users"),
    correlationId: v.string(),
    goal: v.string(),
    storageMode: storageMode,
    model: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args): Promise<Id<"runs">> => {
    assertServer(args.secret);
    const { secret: _secret, ...rest } = args;
    return await ctx.runMutation(internal.runs.start, rest);
  },
});

export const appendRunEvent = mutation({
  args: {
    secret,
    runId: v.id("runs"),
    type: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  returns: v.id("runEvents"),
  handler: async (ctx, args): Promise<Id<"runEvents">> => {
    assertServer(args.secret);
    const { secret: _secret, ...rest } = args;
    return await ctx.runMutation(internal.runs.appendEvent, rest);
  },
});

export const finishRun = mutation({
  args: {
    secret,
    runId: v.id("runs"),
    status: v.union(
      v.literal("succeeded"),
      v.literal("failed"),
      v.literal("refused"),
    ),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    assertServer(args.secret);
    await ctx.runMutation(internal.runs.finish, {
      runId: args.runId,
      status: args.status,
      error: args.error,
    });
    return null;
  },
});

/* --------------------------------------------------------------- reset -- */

/**
 * Clear one user's history so a narrative run can start from zero.
 *
 * Runs, timeline events and audit rows go. The user and the connection stay,
 * because the narrative needs the connection it was given. This exists for the
 * end-to-end script; the application never calls it.
 */
export const resetUserHistory = mutation({
  args: { secret, userId: v.id("users") },
  returns: v.object({
    runs: v.number(),
    runEvents: v.number(),
    auditLog: v.number(),
  }),
  handler: async (ctx, args) => {
    assertServer(args.secret);

    const runs = await ctx.db
      .query("runs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    let removedEvents = 0;
    for (const run of runs) {
      const events = await ctx.db
        .query("runEvents")
        .withIndex("by_run", (q) => q.eq("runId", run._id))
        .collect();
      for (const event of events) {
        await ctx.db.delete(event._id);
        removedEvents += 1;
      }
      await ctx.db.delete(run._id);
    }

    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);

    return {
      runs: runs.length,
      runEvents: removedEvents,
      auditLog: rows.length,
    };
  },
});

/* ----------------------------------------------------------- inspection -- */

/**
 * Every row in every table.
 *
 * This exists for `scripts/prove-no-stored-token.ts`, which has to be able to
 * look everywhere before it can honestly claim the store holds no credential.
 * An assertion that only checks the tables it expects proves nothing.
 */
export const dumpAll = query({
  args: { secret },
  handler: async (ctx, args): Promise<Record<string, unknown[]>> => {
    assertServer(args.secret);
    return {
      users: await ctx.db.query("users").collect(),
      connections: await ctx.db.query("connections").collect(),
      actions: await ctx.db.query("actions").collect(),
      runs: await ctx.db.query("runs").collect(),
      runEvents: await ctx.db.query("runEvents").collect(),
      auditLog: await ctx.db.query("auditLog").collect(),
    };
  },
});
