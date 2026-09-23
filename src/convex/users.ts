import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";

/**
 * Get the current signed in user. Returns null if the user is not signed in.
 * Usage: const signedInUser = await ctx.runQuery(api.users.currentUser);
 * THIS FUNCTION IS READ-ONLY. DO NOT MODIFY.
 */
export const currentUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return await ctx.db.get(userId);
  },
});

export const updateProfile = mutation({
  args: {
    name: v.optional(v.string()),
    company: v.optional(v.string()),
    onboarded: v.optional(v.boolean()),
  },
  handler: async (ctx, { name, company, onboarded }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const patch: { name?: string; company?: string; onboardedAt?: number } = {};
    if (name !== undefined) patch.name = name;
    if (company !== undefined) patch.company = company;
    if (onboarded) patch.onboardedAt = Date.now();
    await ctx.db.patch(userId, patch);
  },
});
