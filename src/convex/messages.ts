import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

// ── Queries ────────────────────────────────────────────────────────────────

/** Inbox: every message for the workspace, newest first. */
export const listForUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("messages")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

/** Conversation for one lead, oldest first. */
export const threadForLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return [];
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect();
    return msgs.sort((a, b) => a.createdAt - b.createdAt);
  },
});

export const unreadCount = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return 0;
    const msgs = await ctx.db
      .query("messages")
      .withIndex("by_user_created", (q) => q.eq("userId", userId))
      .collect();
    return msgs.filter((m) => m.direction === "received" && !m.readAt).length;
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────

/** Log an outbound message. Called by the composer and by campaign sends. */
export const logOutbound = mutation({
  args: {
    leadId: v.id("leads"),
    campaignId: v.optional(v.id("campaigns")),
    channel: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
    provider: v.optional(v.string()),
  },
  handler: async (ctx, { leadId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    return await ctx.db.insert("messages", {
      userId,
      leadId,
      direction: "sent",
      createdAt: Date.now(),
      sentAt: rest.status === "sent" ? Date.now() : undefined,
      ...rest,
    });
  },
});

/** Log an inbound reply so threads read like a real inbox. */
export const logInbound = mutation({
  args: {
    leadId: v.id("leads"),
    channel: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, { leadId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    return await ctx.db.insert("messages", {
      userId,
      leadId,
      direction: "received",
      status: "unread",
      createdAt: Date.now(),
      ...rest,
    });
  },
});

export const markRead = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const msg = await ctx.db.get(id);
    if (!msg || msg.userId !== userId) throw new Error("Message not found.");
    await ctx.db.patch(id, { readAt: Date.now(), status: "read" });
  },
});

export const remove = mutation({
  args: { id: v.id("messages") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const msg = await ctx.db.get(id);
    if (!msg || msg.userId !== userId) throw new Error("Message not found.");
    await ctx.db.delete(id);
  },
});

// ── Email sending (Resend). Set RESEND_API_KEY to enable live sending. ─────

export const sendEmail = action({
  args: {
    leadId: v.id("leads"),
    subject: v.string(),
    body: v.string(),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, { leadId, subject, body, campaignId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");

    const email = await ctx.runQuery(internal.messages.getLeadEmail, {
      leadId,
      userId,
    });
    if (!email) {
      throw new Error(
        "This lead has no email address. Add one on the lead page, or copy the message instead.",
      );
    }

    const apiKey = process.env.RESEND_API_KEY;
    if (!apiKey) {
      throw new Error(
        "Email sending isn't connected yet. Add a RESEND_API_KEY in the Keys settings — until then, use “Copy message” and send it yourself.",
      );
    }

    const from = process.env.RESEND_FROM_EMAIL ?? "DealFlow AI <onboarding@resend.dev>";
    let response: Response;
    try {
      response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ from, to: email, subject, text: body }),
      });
    } catch {
      throw new Error("Couldn't reach the email provider — check your connection and retry.");
    }

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(
        `The email provider rejected this send (${response.status}). ${detail.slice(0, 200)}`,
      );
    }

    const payload = (await response.json().catch(() => ({}))) as { id?: string };
    return { provider: "resend" as const, providerId: payload.id ?? null };
  },
});

/** Ownership-checked email lookup used by the send action. */
export const getLeadEmail = internalQuery({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, { leadId, userId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return null;
    return lead.email ?? null;
  },
});

/** Mark that a send attempt produced a message row (used by campaigns). */
export const logCampaignSend = mutation({
  args: {
    leadId: v.id("leads"),
    campaignId: v.id("campaigns"),
    channel: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { leadId, campaignId, ...rest }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    await ctx.db.insert("messages", {
      userId,
      leadId,
      campaignId,
      direction: "sent",
      createdAt: Date.now(),
      sentAt: rest.status === "sent" ? Date.now() : undefined,
      ...rest,
    });
  },
});
