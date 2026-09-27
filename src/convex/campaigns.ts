import { getAuthUserId } from "@convex-dev/auth/server";
import {
  action,
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx,
} from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { resolveSendLimits, type SendLimits } from "../lib/sendLimits";

// How long a send lock is trusted. A send that crashes without releasing its
// lock only blocks the campaign for this long.
const SEND_LOCK_TTL_MS = 2 * 60 * 1000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ── Queries ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("campaigns")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const getWithLeads = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) return null;
    const rows = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    const withLeads = await Promise.all(
      rows.map(async (row) => {
        const lead = await ctx.db.get(row.leadId);
        return { ...row, lead };
      }),
    );
    return { campaign, rows: withLeads.filter((r) => r.lead) };
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────

export const create = mutation({
  args: {
    name: v.string(),
    description: v.optional(v.string()),
    channel: v.string(),
    subject: v.optional(v.string()),
    templateId: v.optional(v.id("templates")),
    body: v.string(),
    leadIds: v.array(v.id("leads")),
  },
  handler: async (ctx, { name, description, channel, subject, templateId, body, leadIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");

    const campaignId = await ctx.db.insert("campaigns", {
      userId,
      name,
      description,
      channel,
      subject,
      templateId,
      body,
      status: "active",
      createdAt: Date.now(),
    });

    let added = 0;
    for (const leadId of leadIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.userId !== userId) continue;
      const existing = await ctx.db
        .query("campaignLeads")
        .withIndex("by_lead", (q) => q.eq("leadId", leadId))
        .collect();
      if (existing.some((r) => r.campaignId === campaignId)) continue;
      await ctx.db.insert("campaignLeads", {
        userId,
        campaignId,
        leadId,
        status: "pending",
      });
      added++;
    }
    return { campaignId, added };
  },
});

export const update = mutation({
  args: {
    id: v.id("campaigns"),
    name: v.string(),
    description: v.optional(v.string()),
    channel: v.string(),
    subject: v.optional(v.string()),
    body: v.string(),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) throw new Error("Campaign not found.");
    await ctx.db.patch(id, fields);
  },
});

export const setStatus = mutation({
  args: { id: v.id("campaigns"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) throw new Error("Campaign not found.");
    if (!["draft", "active", "completed"].includes(status)) {
      throw new Error("Unknown status.");
    }
    await ctx.db.patch(id, { status });
  },
});

export const addLeads = mutation({
  args: { id: v.id("campaigns"), leadIds: v.array(v.id("leads")) },
  handler: async (ctx, { id, leadIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) throw new Error("Campaign not found.");
    let added = 0;
    for (const leadId of leadIds) {
      const lead = await ctx.db.get(leadId);
      if (!lead || lead.userId !== userId) continue;
      const existing = await ctx.db
        .query("campaignLeads")
        .withIndex("by_lead", (q) => q.eq("leadId", leadId))
        .collect();
      if (existing.some((r) => r.campaignId === id)) continue;
      await ctx.db.insert("campaignLeads", {
        userId,
        campaignId: id,
        leadId,
        status: "pending",
      });
      added++;
    }
    return { added };
  },
});

export const remove = mutation({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) throw new Error("Campaign not found.");
    const rows = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    await ctx.db.delete(id);
  },
});

export const removeLead = mutation({
  args: { id: v.id("campaignLeads") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const row = await ctx.db.get(id);
    if (!row || row.userId !== userId) throw new Error("Not found.");
    await ctx.db.delete(id);
  },
});

// ── Sending ────────────────────────────────────────────────────────────────

/**
 * What the UI shows before confirming a send: pending recipients, the limits
 * in force, and how much of today's daily allowance is already used.
 */
export const sendPreview = query({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) return null;
    const rows = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    const pending = rows.filter((r) => r.userId === userId && r.status === "pending").length;
    const startOfDay = new Date();
    startOfDay.setUTCHours(0, 0, 0, 0);
    const sentToday = await countRealSendsSince(ctx, userId, startOfDay.getTime());
    return {
      pending,
      sentToday,
      limits: resolveSendLimits(process.env),
      sendInProgressAt: campaign.sendInProgressAt ?? null,
    };
  },
});

/** Count real (delivered-attempt) outbound sends for a user since a timestamp. */
async function countRealSendsSince(ctx: QueryCtx, userId: Id<"users">, since: number) {
  const msgs = await ctx.db
    .query("messages")
    .withIndex("by_user_created", (q) => q.eq("userId", userId).gte("createdAt", since))
    .collect();
  return msgs.filter((m) => m.direction === "sent" && m.status === "sent" && m.provider !== "manual")
    .length;
}

/**
 * Send the campaign message to pending recipients — with safety rails
 * (production hardening §4):
 *   • batch cap      — at most `maxBatch` recipients per invocation
 *   • daily cap      — per-user, per-UTC-day cap on real sends
 *   • throttling     — pause between individual emails
 *   • duplicate lock — a time-based lock prevents concurrent double-sends
 *   • per-row status — every attempt is recorded; the client shows counts
 * Rows left pending by the caps stay pending — press send again to continue.
 * Limits resolve from CAMPAIGN_* env vars (see src/lib/sendLimits.ts) so they
 * can later be tied to subscription plans without touching this action.
 */
interface SendAllResult {
  sent: number;
  failed: number;
  skipped: number;
  failures: string[];
  reason?: string;
  limits: SendLimits;
}

export const sendAll = action({
  args: { id: v.id("campaigns") },
  // Explicit return type: this action goes through the generated API barrel,
  // which includes this module — without the annotation TypeScript infers
  // sendAll's type from itself and never terminates.
  handler: async (ctx, { id }): Promise<SendAllResult> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");

    const limits = resolveSendLimits(process.env);

    const campaign = await ctx.runQuery(internal.campaigns.getOwned, { id, userId });
    if (!campaign) throw new Error("Campaign not found.");

    // Duplicate-send guard: acquire the time-based lock first.
    const now = Date.now();
    const acquired = await ctx.runMutation(internal.campaigns.acquireSendLock, { id, at: now });
    if (!acquired) {
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        failures: [] as string[],
        reason:
          "A send is already in progress for this campaign. Wait a moment and check recipient statuses before sending again.",
        limits,
      };
    }

    try {
      const fromName = await ctx.runQuery(internal.campaigns.senderName, { userId });
      const rows = await ctx.runQuery(internal.campaigns.pendingRows, { id, userId });
      if (rows.length === 0) {
        return {
          sent: 0,
          failed: 0,
          skipped: 0,
          failures: [] as string[],
          reason: "Nothing pending — every recipient is already handled.",
          limits,
        };
      }

      // Daily cap: count this user's real sends since the start of the UTC day.
      const startOfDay = new Date();
      startOfDay.setUTCHours(0, 0, 0, 0);
      const sentToday = await ctx.runQuery(internal.campaigns.sendsToday, {
        userId,
        since: startOfDay.getTime(),
      });
      const dailyRemaining = Math.max(0, limits.maxPerDay - sentToday);
      const budget = Math.min(rows.length, limits.maxBatch, dailyRemaining);

      let sent = 0;
      let failed = 0;
      const failures: string[] = [];

      for (const [index, row] of rows.slice(0, budget).entries()) {
        // Throttle between sends (not before the first) to be a polite sender.
        if (limits.throttleMs > 0 && index > 0) await sleep(limits.throttleMs);
        try {
          const email = await ctx.runQuery(internal.campaigns.leadEmail, {
            leadId: row.leadId,
            userId,
          });
          if (!email) {
            await ctx.runMutation(internal.campaigns.markRow, {
              rowId: row._id,
              status: "failed",
              error: "No email address on the lead",
            });
            await ctx.runMutation(api.messages.logCampaignSend, {
              leadId: row.leadId,
              campaignId: id,
              channel: campaign.channel,
              subject: campaign.subject,
              body: campaign.body,
              status: "failed",
              error: "No email address on the lead",
            });
            failed++;
            failures.push("A lead is missing an email address");
            continue;
          }

          await ctx.runAction(internal.emailDelivery.deliverEmail, {
            to: email,
            subject: campaign.subject ?? campaign.name,
            text: campaign.body,
            fromName: fromName ?? undefined,
          });

          await ctx.runMutation(internal.campaigns.markRow, {
            rowId: row._id,
            status: "sent",
            error: undefined,
          });
          await ctx.runMutation(api.messages.logCampaignSend, {
            leadId: row.leadId,
            campaignId: id,
            channel: campaign.channel,
            subject: campaign.subject,
            body: campaign.body,
            status: "sent",
          });
          await ctx.runMutation(internal.campaigns.markContacted, {
            leadId: row.leadId,
            userId,
            campaignId: id,
          });
          sent++;
        } catch (err) {
          const message = err instanceof Error ? err.message : "Unknown send error";
          await ctx.runMutation(internal.campaigns.markRow, {
            rowId: row._id,
            status: "failed",
            error: message,
          });
          failed++;
          failures.push(message);
        }
      }

      // Anything not attempted this run stays pending for the next send.
      const deferred = rows.length - budget;
      let reason: string | undefined;
      if (deferred > 0) {
        reason =
          dailyRemaining <= 0
            ? `Daily sending limit reached (${limits.maxPerDay} sends per day). ${deferred} recipient${deferred === 1 ? "" : "s"} remain pending — try again tomorrow.`
            : `Batch limit: sent up to ${limits.maxBatch} this run. ${deferred} recipient${deferred === 1 ? "" : "s"} remain pending — press send again to continue.`;
      }

      return {
        sent,
        failed,
        skipped: deferred,
        failures: [...new Set(failures)].slice(0, 3),
        reason,
        limits,
      };
    } finally {
      await ctx.runMutation(internal.campaigns.releaseSendLock, { id, at: now });
    }
  },
});

/** Log a manual "I reached out myself" touch for campaign rows. */
export const markSentManually = mutation({
  args: { id: v.id("campaigns"), rowIds: v.array(v.id("campaignLeads")) },
  handler: async (ctx, { id, rowIds }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) throw new Error("Campaign not found.");
    for (const rowId of rowIds) {
      const row = await ctx.db.get(rowId);
      if (!row || row.userId !== userId || row.campaignId !== id) continue;
      await ctx.db.patch(rowId, { status: "sent", sentAt: Date.now() });
      await ctx.db.insert("messages", {
        userId,
        leadId: row.leadId,
        campaignId: id,
        channel: campaign.channel,
        direction: "sent",
        status: "sent",
        subject: campaign.subject,
        body: campaign.body,
        provider: "manual",
        createdAt: Date.now(),
        sentAt: Date.now(),
      });
      // The campaign row proves this lead was targeted — stamp attribution.
      await stampCampaignAttribution(ctx, row.leadId, id, userId);
    }
    return { marked: rowIds.length };
  },
});

// ── Internal helpers ───────────────────────────────────────────────────────

export const getOwned = internalQuery({
  args: { id: v.id("campaigns"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.userId !== userId) return null;
    return campaign;
  },
});

/** From display name for Gmail SMTP delivery ("Rahul Sharma <you@gmail.com>"). */
export const senderName = internalQuery({
  args: { userId: v.id("users") },
  handler: async (ctx, { userId }) => {
    const user = await ctx.db.get(userId);
    return user?.company ?? user?.name ?? null;
  },
});

export const pendingRows = internalQuery({
  args: { id: v.id("campaigns"), userId: v.id("users") },
  handler: async (ctx, { id, userId }) => {
    const rows = await ctx.db
      .query("campaignLeads")
      .withIndex("by_campaign", (q) => q.eq("campaignId", id))
      .collect();
    return rows.filter((r) => r.userId === userId && r.status === "pending");
  },
});

export const leadEmail = internalQuery({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, { leadId, userId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return null;
    return lead.email ?? null;
  },
});

export const markRow = internalMutation({
  args: {
    rowId: v.id("campaignLeads"),
    status: v.string(),
    error: v.optional(v.string()),
  },
  handler: async (ctx, { rowId, status, error }) => {
    await ctx.db.patch(rowId, {
      status,
      error,
      sentAt: status === "sent" ? Date.now() : undefined,
    });
  },
});

/**
 * Stamp verified campaign attribution on a lead (Phase 2 §9).
 *
 * Called from sendAll / markSentManually AFTER the existing campaignLeads row
 * proves the relationship — the campaign genuinely targeted this lead, so the
 * attribution is a fact, not a guess. First-write-wins: an existing campaignId
 * is NEVER overwritten (the original acquisition source is the one that
 * matters for revenue breakdowns). Leads reached outside any campaign keep
 * campaignId undefined and stay in the honest "No attribution data yet" bucket.
 */
async function stampCampaignAttribution(
  ctx: MutationCtx,
  leadId: Id<"leads">,
  campaignId: Id<"campaigns">,
  userId: Id<"users">,
) {
  const lead = await ctx.db.get(leadId);
  if (!lead || lead.userId !== userId) return;
  if (lead.campaignId !== undefined) return; // first-write-wins
  await ctx.db.patch(leadId, { campaignId });
}

export const markContacted = internalMutation({
  args: {
    leadId: v.id("leads"),
    userId: v.id("users"),
    campaignId: v.optional(v.id("campaigns")),
  },
  handler: async (ctx, { leadId, userId, campaignId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return;
    await ctx.db.patch(leadId, {
      status: lead.status === "new" ? "contacted" : lead.status,
      lastContactedAt: Date.now(),
      lastActivityAt: Date.now(),
    });
    if (campaignId !== undefined) {
      await stampCampaignAttribution(ctx, leadId, campaignId, userId);
    }
  },
});

// ── Send-lock + daily-count internals ──────────────────────────────────────

/** Acquire the send lock if no live lock exists. Returns false when busy. */
export const acquireSendLock = internalMutation({
  args: { id: v.id("campaigns"), at: v.number() },
  handler: async (ctx, { id, at }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign) return false;
    const existing = campaign.sendInProgressAt;
    if (existing !== undefined && Date.now() - existing < SEND_LOCK_TTL_MS) return false;
    await ctx.db.patch(id, { sendInProgressAt: at });
    return true;
  },
});

/** Release the send lock (only if we still own it). */
export const releaseSendLock = internalMutation({
  args: { id: v.id("campaigns"), at: v.number() },
  handler: async (ctx, { id, at }) => {
    const campaign = await ctx.db.get(id);
    if (!campaign || campaign.sendInProgressAt !== at) return;
    await ctx.db.patch(id, { sendInProgressAt: undefined });
  },
});

/** Real email sends since a timestamp — used to enforce the daily cap. */
export const sendsToday = internalQuery({
  args: { userId: v.id("users"), since: v.number() },
  handler: async (ctx, { userId, since }) => countRealSendsSince(ctx, userId, since),
});
