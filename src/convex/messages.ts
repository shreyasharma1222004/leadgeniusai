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
    // A reply means they engaged: advance the lead into Discovery (a real
    // pipeline stage — never write legacy values like "replied" here).
    const updates: { status?: string; lastContactedAt: number } = {
      lastContactedAt: Date.now(),
    };
    if (lead.status === "contacted" || lead.status === "new") {
      updates.status = "discovery";
    }
    await ctx.db.patch(leadId, updates);
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

// ── Email sending (Gmail SMTP → Resend → built-in gateway) ─────────────

export const sendEmail = action({
  args: {
    leadId: v.id("leads"),
    subject: v.string(),
    body: v.string(),
    campaignId: v.optional(v.id("campaigns")),
  },
  // Explicit return type: the runAction below goes through the generated API
  // barrel, which includes this module — without the annotation TypeScript
  // infers sendEmail's type from itself and never terminates.
  handler: async (
    ctx,
    { leadId, subject, body, campaignId },
  ): Promise<{ provider: string; providerId: string | null }> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");

    const target = await ctx.runQuery(internal.messages.getLeadEmail, {
      leadId,
      userId,
    });
    if (!target?.email) {
      throw new Error(
        "This lead has no email address. Add one on the lead page, or copy the message instead.",
      );
    }

    const result = await ctx.runAction(internal.emailDelivery.deliverEmail, {
      to: target.email,
      subject,
      text: body,
      fromName: target.fromName ?? undefined,
    });
    return result;
  },
});

/** Ownership-checked email + sender-name lookup used by the send action. */
export const getLeadEmail = internalQuery({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, { leadId, userId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return null;
    const sender = await ctx.db.get(userId);
    return {
      email: lead.email ?? null,
      // Display name on the From header for Gmail SMTP sends.
      fromName: sender?.company ?? sender?.name ?? null,
    };
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
