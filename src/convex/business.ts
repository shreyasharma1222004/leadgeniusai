import { getAuthUserId } from "@convex-dev/auth/server";
import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import {
  GOAL_KINDS,
  GOAL_PERIODS,
  GOAL_STATUSES,
  computeGoalCurrent,
  formatGoalValue,
  goalProgressFraction,
  type GoalKind,
  type GoalPeriod,
} from "../lib/goalEngine";

// ── Business Profile (Phase 1 §1) ───────────────────────────────────────────

/** The authenticated user's business profile, or null when not yet created. */
export const myProfile = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    return (
      (await ctx.db
        .query("businessProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first()) ?? null
    );
  },
});

/**
 * Create or update the caller's business profile (single record per user).
 * All fields optional except businessName. Ownership: the record is always
 * keyed to the authenticated user — a caller can never touch another user's
 * profile.
 */
export const saveProfile = mutation({
  args: {
    businessName: v.string(),
    website: v.optional(v.string()),
    industry: v.optional(v.string()),
    businessType: v.optional(v.string()),
    businessModel: v.optional(v.string()),
    products: v.optional(v.string()),
    description: v.optional(v.string()),
    targetGeography: v.optional(v.string()),
    currency: v.optional(v.string()),
    teamSize: v.optional(v.string()),
    currentMonthlyRevenue: v.optional(v.number()),
    targetMonthlyRevenue: v.optional(v.number()),
    acquisitionChannels: v.optional(v.array(v.string())),
    avgSalesCycle: v.optional(v.string()),
    primaryChallenge: v.optional(v.string()),
  },
  handler: async (ctx, fields) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const name = fields.businessName.trim();
    if (!name) throw new Error("Business name is required.");

    const existing = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    // Strip undefined so partial saves never erase untouched fields.
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    clean.businessName = name;

    if (existing) {
      await ctx.db.patch(existing._id, clean);
      return { id: existing._id, created: false };
    }
    const id = await ctx.db.insert("businessProfiles", {
      userId,
      businessName: name,
      website: fields.website,
      industry: fields.industry,
      businessType: fields.businessType,
      businessModel: fields.businessModel,
      products: fields.products,
      description: fields.description,
      targetGeography: fields.targetGeography,
      currency: fields.currency,
      teamSize: fields.teamSize,
      currentMonthlyRevenue: fields.currentMonthlyRevenue,
      targetMonthlyRevenue: fields.targetMonthlyRevenue,
      acquisitionChannels: fields.acquisitionChannels,
      avgSalesCycle: fields.avgSalesCycle,
      primaryChallenge: fields.primaryChallenge,
    });
    return { id, created: true };
  },
});

// ── Business Goals (Phase 1 §2) ─────────────────────────────────────────────

/**
 * The caller's goals WITH their current values derived live from real CRM
 * records. Nothing here is stored progress — every number is computed at
 * read time by goalEngine from the user's own leads, and unmeasurable kinds
 * come back with `current: null` plus a plain-language reason.
 */
export const goalsWithProgress = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const goals = await ctx.db
      .query("businessGoals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Workspace currency (Phase 2 cleanup item 2): the business profile's saved
    // currency is the single default for every money figure in the app.
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    return goals
      .map((g) => {
        const kind = g.kind as GoalKind;
        const period = g.period as GoalPeriod;
        const derived = computeGoalCurrent(kind, period, leads);
        const manual =
          derived.current === null && g.manualCurrentValue !== undefined
            ? g.manualCurrentValue
            : null;
        const current = derived.current ?? manual;
        return {
          ...g,
          kind,
          period,
          current,
          derivedCurrent: derived.current,
          usingManualValue: derived.current === null && manual !== null,
          unit: derived.unit,
          basis: derived.basis,
          unavailableReason: derived.unavailableReason,
          formatted: current !== null ? formatGoalValue(current, derived.unit, profile?.currency) : null,
          progress: goalProgressFraction(current, g.targetValue),
        };
      })
      .sort((a, b) => a.createdAt - b.createdAt);
  },
});

/** Create a goal. Kind/period validated against the shared engine's enums. */
export const createGoal = mutation({
  args: {
    name: v.string(),
    kind: v.string(),
    targetValue: v.optional(v.number()),
    period: v.string(),
    deadline: v.optional(v.number()),
  },
  handler: async (ctx, { name, kind, targetValue, period, deadline }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const trimmed = name.trim();
    if (!trimmed) throw new Error("Give the goal a name.");
    if (!GOAL_KINDS.includes(kind as GoalKind)) throw new Error("Unknown goal type.");
    if (!GOAL_PERIODS.includes(period as GoalPeriod)) throw new Error("Unknown period.");
    if (targetValue !== undefined && targetValue < 0) {
      throw new Error("Target can't be negative.");
    }
    return await ctx.db.insert("businessGoals", {
      userId,
      name: trimmed,
      kind,
      targetValue,
      period,
      status: "active",
      deadline,
      createdAt: Date.now(),
    });
  },
});

/** Edit a goal's name, target, period, deadline, or status. */
export const updateGoal = mutation({
  args: {
    id: v.id("businessGoals"),
    name: v.optional(v.string()),
    targetValue: v.optional(v.number()),
    period: v.optional(v.string()),
    deadline: v.optional(v.number()),
    status: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const goal = await ctx.db.get(id);
    if (!goal || goal.userId !== userId) throw new Error("Goal not found.");
    if (fields.period !== undefined && !GOAL_PERIODS.includes(fields.period as GoalPeriod)) {
      throw new Error("Unknown period.");
    }
    if (fields.status !== undefined && !GOAL_STATUSES.includes(fields.status as never)) {
      throw new Error("Unknown status.");
    }
    if (fields.targetValue !== undefined && fields.targetValue < 0) {
      throw new Error("Target can't be negative.");
    }
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    await ctx.db.patch(id, clean);
  },
});

export const deleteGoal = mutation({
  args: { id: v.id("businessGoals") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const goal = await ctx.db.get(id);
    if (!goal || goal.userId !== userId) throw new Error("Goal not found.");
    await ctx.db.delete(id);
  },
});

/**
 * Set a manual current value — ONLY allowed for goal kinds whose value can't
 * be derived from CRM data (retention/custom). Measurable kinds reject this
 * so nobody can overwrite real derived numbers with made-up ones.
 */
export const setManualCurrentValue = mutation({
  args: { id: v.id("businessGoals"), value: v.optional(v.number()) },
  handler: async (ctx, { id, value }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const goal = await ctx.db.get(id);
    if (!goal || goal.userId !== userId) throw new Error("Goal not found.");
    const kind = goal.kind as GoalKind;
    if (kind !== "retention" && kind !== "custom") {
      throw new Error(
        "This goal is measured automatically from your CRM — its current value can't be set by hand.",
      );
    }
    await ctx.db.patch(id, { manualCurrentValue: value });
  },
});
