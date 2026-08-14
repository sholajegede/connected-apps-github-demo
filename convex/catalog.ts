import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import { actionEffect } from "./schema";
import type { Doc } from "./_generated/dataModel";

/**
 * The persisted projection of the code action registry.
 *
 * `src/lib/actions/registry.ts` stays the source of truth. This table exists
 * so the console and the audit trail can join against a stable catalogue. It
 * is synced from the registry, never edited by hand and never by the browser.
 */

const entry = v.object({
  actionId: v.string(),
  title: v.string(),
  description: v.string(),
  effect: actionEffect,
  actsAsUser: v.boolean(),
  requiredScopes: v.array(v.string()),
});

export const sync = internalMutation({
  args: { entries: v.array(entry) },
  returns: v.number(),
  handler: async (ctx, args): Promise<number> => {
    const now = Date.now();
    const seen = new Set<string>();

    for (const item of args.entries) {
      seen.add(item.actionId);
      const existing = await ctx.db
        .query("actions")
        .withIndex("by_actionId", (q) => q.eq("actionId", item.actionId))
        .unique();

      if (existing) {
        await ctx.db.patch(existing._id, {
          ...item,
          enabled: true,
          updatedAt: now,
        });
      } else {
        await ctx.db.insert("actions", { ...item, enabled: true, updatedAt: now });
      }
    }

    // An action removed from the registry is disabled, not deleted, so audit
    // rows that reference it still resolve.
    for (const row of await ctx.db.query("actions").collect()) {
      if (!seen.has(row.actionId) && row.enabled) {
        await ctx.db.patch(row._id, { enabled: false, updatedAt: now });
      }
    }

    return args.entries.length;
  },
});

export const list = query({
  args: {},
  handler: async (ctx): Promise<Doc<"actions">[]> => {
    return await ctx.db.query("actions").collect();
  },
});

export const getByActionId = query({
  args: { actionId: v.string() },
  handler: async (ctx, args): Promise<Doc<"actions"> | null> => {
    return await ctx.db
      .query("actions")
      .withIndex("by_actionId", (q) => q.eq("actionId", args.actionId))
      .unique();
  },
});
