import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { computeClosedStats, computePipelineStats } from "../lib/revenue";
import {
  computeGoalCurrent,
  formatGoalValue,
  goalProgressFraction,
  type GoalKind,
  type GoalPeriod,
} from "../lib/goalEngine";
import { computeClients } from "../lib/clients";

// ── Copilot conversation persistence (Phase 3 §2a) ─────────────────────────
//
// Persistence ONLY for the public surface: the deterministic engine in
// src/lib/assistant.ts remains the fallback answer generator. Phase 3 §2b-1
// adds INTERNAL helpers used exclusively by the server-side Copilot AI action
// (src/convex/ai.ts): an ownership-checked conversation read, a bounded
// history window, an internal assistant-turn writer, and a compact verified
// workspace snapshot. Internal functions are never callable from the browser,
// and every one of them still enforces the same userId scoping.
//
// Security model, same as every Phase 2 module: every function authenticates
// via getAuthUserId, and every read/write re-verifies that the conversation
// belongs to the caller. Messages are additionally user-stamped at insert, so
// a guessed conversationId can never grant access to another workspace's chat.

const DEFAULT_TITLE = "New conversation";
const MAX_TITLE = 80;
const MAX_CONTENT = 8000;

function cleanTitle(title: string | undefined): string {
  const t = (title ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  return t || DEFAULT_TITLE;
}

/** The caller's conversations, most recently active first. */
export const listConversations = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const rows = await ctx.db
      .query("conversations")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return rows.sort((a, b) => b.updatedAt - a.updatedAt);
  },
});

/** One conversation, only when owned by the caller. */
export const getConversation = query({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const conv = await ctx.db.get(id);
    if (!conv || conv.userId !== userId) return null;
    return conv;
  },
});

/**
 * Messages for one conversation. The client-supplied conversationId is NEVER
 * trusted: ownership of the parent conversation is verified first.
 */
export const listMessages = query({
  args: { conversationId: v.id("conversations") },
  handler: async (ctx, { conversationId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.userId !== userId) return [];
    return await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
  },
});

/** Create a conversation owned by the caller. No AI, no title generation. */
export const createConversation = mutation({
  args: { title: v.optional(v.string()) },
  handler: async (ctx, { title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const now = Date.now();
    return await ctx.db.insert("conversations", {
      userId,
      title: cleanTitle(title),
      createdAt: now,
      updatedAt: now,
    });
  },
});

/** Rename (used for deterministic local titles after the first message). */
export const renameConversation = mutation({
  args: { id: v.id("conversations"), title: v.string() },
  handler: async (ctx, { id, title }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const conv = await ctx.db.get(id);
    if (!conv || conv.userId !== userId) throw new Error("Conversation not found.");
    // Rename does NOT bump updatedAt — ordering stays by real chat activity.
    await ctx.db.patch(id, { title: cleanTitle(title) });
  },
});

/** Shared turn-writer used by the public mutation and the AI action alike. */
async function insertTurn(
  ctx: MutationCtx,
  args: {
    conversationId: Id<"conversations">;
    userId: Id<"users">;
    role: "user" | "assistant";
    content: string;
  },
): Promise<Id<"conversationMessages">> {
  const conv = await ctx.db.get(args.conversationId);
  if (!conv || conv.userId !== args.userId) throw new Error("Conversation not found.");
  const clean = args.content.slice(0, MAX_CONTENT).trim();
  if (!clean) throw new Error("Message is empty.");
  const now = Date.now();
  const id = await ctx.db.insert("conversationMessages", {
    conversationId: args.conversationId,
    userId: args.userId, // user-stamped for defense in depth
    role: args.role,
    content: clean,
    createdAt: now,
  });
  await ctx.db.patch(args.conversationId, { updatedAt: now });
  return id;
}

export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, { conversationId, role, content }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    return await insertTurn(ctx, { conversationId, userId, role, content });
  },
});

/**
 * Delete a conversation and ALL of its messages in the same mutation — no
 * orphaned rows are ever left behind.
 */
export const deleteConversation = mutation({
  args: { id: v.id("conversations") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const conv = await ctx.db.get(id);
    if (!conv || conv.userId !== userId) throw new Error("Conversation not found.");
    const msgs = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", id))
      .collect();
    for (const m of msgs) await ctx.db.delete(m._id);
    await ctx.db.delete(id);
  },
});

// ── Phase 3 §2b-1: internal helpers for the server-side Copilot AI action ──
//
// These are internal (never callable from the browser). The Copilot action in
// src/convex/ai.ts derives userId from the authenticated session and passes it
// explicitly; every helper re-checks ownership before touching any row.

/** Ownership-checked conversation read for server-side use. */
export const getOwnedConversation = internalQuery({
  args: { conversationId: v.id("conversations"), userId: v.id("users") },
  handler: async (ctx, { conversationId, userId }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.userId !== userId) return null;
    return conv;
  },
});

/**
 * The most recent `limit` messages of an owned conversation, oldest first.
 * Hard-capped so the AI context can never grow unbounded.
 */
export const recentMessages = internalQuery({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    limit: v.number(),
  },
  handler: async (ctx, { conversationId, userId, limit }) => {
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.userId !== userId) return [];
    const rows = await ctx.db
      .query("conversationMessages")
      .withIndex("by_conversation", (q) => q.eq("conversationId", conversationId))
      .order("asc")
      .collect();
    return rows.slice(-Math.max(1, Math.min(16, Math.round(limit))));
  },
});

/** Append the AI's assistant turn (ownership re-verified). */
export const appendAssistantMessage = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, { conversationId, userId, content }) =>
    insertTurn(ctx, { conversationId, userId, role: "assistant", content }),
});

/**
 * Compact, VERIFIED workspace snapshot for the Copilot AI — derived entirely
 * server-side from the caller's own records using the exact Phase 2 metric
 * definitions (computePipelineStats / computeClosedStats / goalEngine /
 * computeClients). No raw documents, no message bodies, no lead dumps.
 */
export const copilotSnapshot = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const goalRows = await ctx.db
      .query("businessGoals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();

    const pipeline = computePipelineStats(leads);
    const closed = computeClosedStats(leads);

    // Client summary is kept deliberately cheap: touch-based derivation only
    // (no messages/followUps join) — counts and top clients by recorded
    // revenue, matching the Clients page's revenue definition.
    const clients = computeClients(leads, profile?.products);
    const topClients = [...clients]
      .sort((a, b) => b.totalRevenue - a.totalRevenue)
      .slice(0, 3)
      .map((c) => ({ name: c.name, totalRevenue: c.totalRevenue, wonDeals: c.wonDeals.length }));

    const goals = goalRows.map((g) => {
      const derived = computeGoalCurrent(
        g.kind as GoalKind,
        g.period as GoalPeriod,
        leads,
      );
      const current =
        derived.current ??
        (derived.current === null && g.manualCurrentValue !== undefined
          ? g.manualCurrentValue
          : null);
      return {
        name: g.name,
        kind: g.kind,
        period: g.period,
        status: g.status,
        targetValue: g.targetValue,
        current,
        progress: goalProgressFraction(current, g.targetValue),
        formatted:
          current !== null
            ? formatGoalValue(current, derived.unit, profile?.currency)
            : null,
      };
    });

    return {
      currency: profile?.currency,
      profile: profile
        ? {
            businessName: profile.businessName,
            industry: profile.industry,
            businessModel: profile.businessModel,
            products: profile.products,
            description: profile.description,
            targetGeography: profile.targetGeography,
            primaryChallenge: profile.primaryChallenge,
          }
        : null,
      goals,
      pipeline: {
        openDeals: pipeline.openDeals,
        openOpportunities: pipeline.openOpportunities,
        pipelineValue: pipeline.pipelineValue,
        weightedPipeline: pipeline.weightedPipeline,
      },
      revenue: {
        wonRevenue: closed.wonRevenue,
        wonCount: closed.wonCount,
        lostValue: closed.lostValue,
        lostCount: closed.lostCount,
        winRate: closed.winRate,
        avgDealSize: closed.avgDealSize,
      },
      clients: {
        count: clients.length,
        healthyCount: clients.filter((c) => c.health.state === "healthy").length,
        top: topClients,
      },
    };
  },
});
