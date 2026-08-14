import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { runStatus, storageMode } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/** One agent task and its timeline. */

export const start = internalMutation({
  args: {
    userId: v.id("users"),
    correlationId: v.string(),
    goal: v.string(),
    storageMode: storageMode,
    model: v.optional(v.string()),
  },
  returns: v.id("runs"),
  handler: async (ctx, args): Promise<Id<"runs">> => {
    return await ctx.db.insert("runs", {
      ...args,
      status: "running",
      startedAt: Date.now(),
    });
  },
});

export const finish = internalMutation({
  args: {
    runId: v.id("runs"),
    status: runStatus,
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.runId, {
      status: args.status,
      error: args.error,
      finishedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Append to a run's timeline. The sequence number is assigned here so the
 * timeline stays ordered whatever order callers arrive in.
 */
export const appendEvent = internalMutation({
  args: {
    runId: v.id("runs"),
    type: v.string(),
    message: v.string(),
    data: v.optional(v.any()),
  },
  returns: v.id("runEvents"),
  handler: async (ctx, args): Promise<Id<"runEvents">> => {
    const run = await ctx.db.get(args.runId);
    if (!run) throw new Error("Run not found.");

    const last = await ctx.db
      .query("runEvents")
      .withIndex("by_run_seq", (q) => q.eq("runId", args.runId))
      .order("desc")
      .first();

    return await ctx.db.insert("runEvents", {
      runId: args.runId,
      correlationId: run.correlationId,
      seq: (last?.seq ?? 0) + 1,
      type: args.type,
      message: args.message,
      data: args.data,
      at: Date.now(),
    });
  },
});

export const get = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<Doc<"runs"> | null> => {
    return await ctx.db.get(args.runId);
  },
});

export const events = query({
  args: { runId: v.id("runs") },
  handler: async (ctx, args): Promise<Doc<"runEvents">[]> => {
    return await ctx.db
      .query("runEvents")
      .withIndex("by_run_seq", (q) => q.eq("runId", args.runId))
      .order("asc")
      .collect();
  },
});

export const forUser = query({
  args: { userId: v.id("users"), limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"runs">[]> => {
    return await ctx.db
      .query("runs")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .order("desc")
      .take(Math.min(args.limit ?? 20, 100));
  },
});
