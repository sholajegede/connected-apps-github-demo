import { v } from "convex/values";
import { query } from "./_generated/server";

/**
 * Live counters for the operator console.
 *
 * Everything here is derived from the audit log, so the numbers are what
 * actually happened rather than what the app believes happened.
 *
 * "Tokens the app stored" is deliberately NOT computed here. It is a property
 * of the deployment, not of the data, and the server decides it — the console
 * is handed that number from the server alongside the storage mode.
 */

export const forUser = query({
  args: { userId: v.optional(v.id("users")) },
  handler: async (ctx, args) => {
    if (!args.userId) {
      return {
        actionsBrokered: 0,
        actionsInvoked: 0,
        actionsRefused: 0,
        revocations: 0,
        lastRevokedAt: null as number | null,
        actionsAfterRevocation: 0,
        actionsAfterRevocationByMode: {} as Record<string, number>,
      };
    }

    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();

    const revocations = rows.filter(
      (row) => row.event === "connection.revoked" && row.outcome === "allowed",
    );
    const lastRevokedAt = revocations.reduce<number | null>(
      (latest, row) => (latest === null || row.at > latest ? row.at : latest),
      null,
    );

    const invoked = rows.filter(
      (row) => row.event === "action.invoked" && row.outcome === "allowed",
    );

    // Actions that succeeded after the most recent revocation. In
    // connected-app mode this must be zero. In stored-key mode it is not, and
    // that is the whole point of showing it.
    const after =
      lastRevokedAt === null
        ? []
        : invoked.filter((row) => row.at > lastRevokedAt);

    const byMode: Record<string, number> = {};
    for (const row of after) {
      byMode[row.storageMode] = (byMode[row.storageMode] ?? 0) + 1;
    }

    return {
      actionsBrokered: rows.filter(
        (row) => row.event === "token.brokered" && row.outcome === "allowed",
      ).length,
      actionsInvoked: invoked.length,
      actionsRefused: rows.filter((row) => row.outcome === "refused").length,
      revocations: revocations.length,
      lastRevokedAt,
      actionsAfterRevocation: after.length,
      actionsAfterRevocationByMode: byMode,
    };
  },
});

/** The most recent runs for the console's history panel. */
export const recentRuns = query({
  args: { userId: v.optional(v.id("users")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = args.userId;
    if (!userId) return [];
    return await ctx.db
      .query("runs")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(Math.min(args.limit ?? 10, 50));
  },
});

/** The audit trail for the records view. */
export const auditForUser = query({
  args: { userId: v.optional(v.id("users")), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const userId = args.userId;
    if (!userId) return [];
    const rows = await ctx.db
      .query("auditLog")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows
      .sort((a, b) => b.at - a.at)
      .slice(0, Math.min(args.limit ?? 40, 200));
  },
});
