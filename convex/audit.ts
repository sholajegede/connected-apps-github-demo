import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { auditEvent, auditOutcome, storageMode } from "./schema";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * The audit trail.
 *
 * Every brokered action and every revocation writes exactly one row, carrying
 * the correlationId that ties it back to the run that caused it. Rows are
 * written by the server only — the browser cannot forge or edit one — and no
 * row ever carries a credential.
 */

export const record = internalMutation({
  args: {
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
    return await ctx.db.insert("auditLog", { ...args, at: Date.now() });
  },
});

export const byCorrelationId = query({
  args: { correlationId: v.string() },
  handler: async (ctx, args): Promise<Doc<"auditLog">[]> => {
    return await ctx.db
      .query("auditLog")
      .withIndex("by_correlationId", (q) =>
        q.eq("correlationId", args.correlationId),
      )
      .collect();
  },
});

export const recent = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args): Promise<Doc<"auditLog">[]> => {
    return await ctx.db
      .query("auditLog")
      .withIndex("by_at")
      .order("desc")
      .take(Math.min(args.limit ?? 50, 200));
  },
});

export const forUser = query({
  args: { userId: v.id("users") },
  handler: async (ctx, args): Promise<Doc<"auditLog">[]> => {
    return await ctx.db
      .query("auditLog")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
  },
});
