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

/** Business profile captured by the onboarding flow (§51). All optional. */
export const updateBusinessProfile = mutation({
  args: {
    businessType: v.optional(v.string()),
    sells: v.optional(v.string()),
    audience: v.optional(v.string()),
    growthGoal: v.optional(v.string()),
    revenueGoal: v.optional(v.number()),
    teamSize: v.optional(v.string()),
    onboarded: v.optional(v.boolean()),
  },
  handler: async (ctx, fields) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const { onboarded, ...rest } = fields;
    const clean = Object.fromEntries(
      Object.entries(rest).filter(([, value]) => value !== undefined),
    );
    const patch = clean as Record<string, unknown>;
    if (onboarded) patch.onboardedAt = Date.now();
    await ctx.db.patch(userId, patch);
  },
});
