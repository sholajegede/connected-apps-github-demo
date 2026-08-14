import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { connectionStatus } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Connection state for a user's GitHub link.
 *
 * Nothing here is a credential. The access token and the refresh token stay
 * with Kinde. This table only records that a link exists, what state it is in,
 * and how often a token has been brokered against it.
 */

export const markLinked = internalMutation({
  args: {
    userId: v.id("users"),
    kindeConnectionId: v.string(),
    githubLogin: v.optional(v.string()),
    grantedScopes: v.optional(v.array(v.string())),
  },
  returns: v.id("connections"),
  handler: async (ctx, args): Promise<Id<"connections">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "github"),
      )
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        kindeConnectionId: args.kindeConnectionId,
        status: "linked",
        githubLogin: args.githubLogin ?? existing.githubLogin,
        grantedScopes: args.grantedScopes ?? existing.grantedScopes,
        linkedAt: now,
        revokedAt: undefined,
      });
      return existing._id;
    }

    return await ctx.db.insert("connections", {
      userId: args.userId,
      provider: "github",
      kindeConnectionId: args.kindeConnectionId,
      status: "linked",
      githubLogin: args.githubLogin,
      grantedScopes: args.grantedScopes,
      linkedAt: now,
      brokerCount: 0,
    });
  },
});

/**
 * Record that the connection was revoked centrally. The user stays signed into
 * the app; only the GitHub link is cut.
 */
export const markRevoked = internalMutation({
  args: { userId: v.id("users") },
  returns: v.union(v.id("connections"), v.null()),
  handler: async (ctx, args): Promise<Id<"connections"> | null> => {
    const existing = await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "github"),
      )
      .unique();
    if (!existing) return null;

    await ctx.db.patch(existing._id, {
      status: "revoked",
      revokedAt: Date.now(),
    });
    return existing._id;
  },
});

/** Note that the broker successfully fetched a token for this connection. */
export const noteBrokered = internalMutation({
  args: {
    connectionId: v.id("connections"),
    githubLogin: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const connection = await ctx.db.get(args.connectionId);
    if (!connection) return null;
    await ctx.db.patch(args.connectionId, {
      lastBrokeredAt: Date.now(),
      brokerCount: connection.brokerCount + 1,
      githubLogin: args.githubLogin ?? connection.githubLogin,
    });
    return null;
  },
});

export const setStatus = internalMutation({
  args: { connectionId: v.id("connections"), status: connectionStatus },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.connectionId, { status: args.status });
    return null;
  },
});

export const getForUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"connections"> | null> => {
    return await ctx.db
      .query("connections")
      .withIndex("by_user_provider", (q) =>
        q.eq("userId", args.userId).eq("provider", "github"),
      )
      .unique();
  },
});
