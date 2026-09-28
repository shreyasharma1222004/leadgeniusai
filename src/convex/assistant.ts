import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Copilot conversation persistence (Phase 3 §2a) ─────────────────────────
//
// Persistence ONLY. This module never calls an AI service — answers come from
// the deterministic engine in src/lib/assistant.ts. Titles are derived locally
// by the client (deterministic, bounded); nothing here generates content.
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

/**
 * Append one user or assistant turn. Role is validator-constrained to
 * "user" | "assistant"; ownership of the conversation is enforced; the
 * conversation's updatedAt is bumped so the list orders by activity.
 */
export const addMessage = mutation({
  args: {
    conversationId: v.id("conversations"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
  },
  handler: async (ctx, { conversationId, role, content }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const conv = await ctx.db.get(conversationId);
    if (!conv || conv.userId !== userId) throw new Error("Conversation not found.");
    const clean = content.slice(0, MAX_CONTENT).trim();
    if (!clean) throw new Error("Message is empty.");
    const now = Date.now();
    const id = await ctx.db.insert("conversationMessages", {
      conversationId,
      userId, // user-stamped for defense in depth
      role,
      content: clean,
      createdAt: now,
    });
    await ctx.db.patch(conversationId, { updatedAt: now });
    return id;
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
