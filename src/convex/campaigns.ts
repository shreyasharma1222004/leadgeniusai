import { getAuthUserId } from "@convex-dev/auth/server";
import { action, internalMutation, internalQuery, mutation, query } from "./_generated/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";

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

/** Send the campaign message to every pending recipient. */
export const sendAll = action({
  args: { id: v.id("campaigns") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");

    const campaign = await ctx.runQuery(internal.campaigns.getOwned, { id, userId });
    if (!campaign) throw new Error("Campaign not found.");

    const rows = await ctx.runQuery(internal.campaigns.pendingRows, { id, userId });
    if (rows.length === 0) {
      return {
        sent: 0,
        failed: 0,
        skipped: 0,
        failures: [] as string[],
        reason: "Nothing pending — every recipient is already handled.",
      };
    }

    let sent = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const row of rows) {
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

        const apiKey = process.env.RESEND_API_KEY;
        if (!apiKey) {
          throw new Error("RESEND_API_KEY is not configured");
        }
        const from = process.env.RESEND_FROM_EMAIL ?? "DealFlow AI <onboarding@resend.dev>";
        const response = await fetch("https://api.resend.com/emails", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            from,
            to: email,
            subject: campaign.subject ?? campaign.name,
            text: campaign.body,
          }),
        });
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error(`Provider error ${response.status}: ${detail.slice(0, 120)}`);
        }

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
        await ctx.runMutation(internal.campaigns.markContacted, { leadId: row.leadId, userId });
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

    return { sent, failed, skipped: 0, failures: [...new Set(failures)].slice(0, 3) };
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

export const markContacted = internalMutation({
  args: { leadId: v.id("leads"), userId: v.id("users") },
  handler: async (ctx, { leadId, userId }) => {
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return;
    await ctx.db.patch(leadId, {
      status: lead.status === "new" ? "contacted" : lead.status,
      lastContactedAt: Date.now(),
    });
  },
});
