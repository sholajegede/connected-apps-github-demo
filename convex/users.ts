import { v } from "convex/values";
import { internalMutation, query } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";

/**
 * Users are created from the verified Kinde session on the server. The browser
 * cannot mint one, so this mutation is internal.
 */
export const upsert = internalMutation({
  args: {
    kindeUserId: v.string(),
    email: v.optional(v.string()),
    name: v.optional(v.string()),
  },
  returns: v.id("users"),
  handler: async (ctx, args): Promise<Id<"users">> => {
    const now = Date.now();
    const existing = await ctx.db
      .query("users")
      .withIndex("by_kindeUserId", (q) => q.eq("kindeUserId", args.kindeUserId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        email: args.email ?? existing.email,
        name: args.name ?? existing.name,
        lastSeenAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert("users", {
      kindeUserId: args.kindeUserId,
      email: args.email,
      name: args.name,
      createdAt: now,
      lastSeenAt: now,
    });
  },
});

export const getByKindeUserId = query({
  args: { kindeUserId: v.string() },
  handler: async (ctx, args): Promise<Doc<"users"> | null> => {
    return await ctx.db
      .query("users")
      .withIndex("by_kindeUserId", (q) => q.eq("kindeUserId", args.kindeUserId))
      .unique();
  },
});
