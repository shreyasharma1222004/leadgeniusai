import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query } from "./_generated/server";
import { v } from "convex/values";

// ── Queries ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("templates")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    channel: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { name, subject, body, channel, tags }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    return await ctx.db.insert("templates", {
      userId,
      name,
      subject,
      body,
      channel,
      tags,
      createdAt: Date.now(),
    });
  },
});

export const update = mutation({
  args: {
    id: v.id("templates"),
    name: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    channel: v.string(),
    tags: v.optional(v.array(v.string())),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const tpl = await ctx.db.get(id);
    if (!tpl || tpl.userId !== userId) throw new Error("Template not found.");
    await ctx.db.patch(id, fields);
  },
});

export const remove = mutation({
  args: { id: v.id("templates") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const tpl = await ctx.db.get(id);
    if (!tpl || tpl.userId !== userId) throw new Error("Template not found.");
    await ctx.db.delete(id);
  },
});

export const touch = mutation({
  args: { id: v.id("templates") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const tpl = await ctx.db.get(id);
    if (!tpl || tpl.userId !== userId) throw new Error("Template not found.");
    await ctx.db.patch(id, { lastUsedAt: Date.now() });
  },
});
