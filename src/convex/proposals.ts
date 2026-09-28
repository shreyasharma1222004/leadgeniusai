import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Doc } from "./_generated/dataModel";

// ── Proposals (Phase 2 §12/§13) ─────────────────────────────────────────────
//
// Persisted proposals linked to a deal (the leads row). Status lifecycle:
//   draft → sent → (viewed) → accepted | rejected
//
// HONESTY RULES:
//  • `viewedAt` exists in the schema for the day real view tracking is built,
//    but NOTHING in this file ever writes it. "Mark viewed" is deliberately
//    not offered — we cannot know a proposal was opened (§12).
//  • sentAt is set when the user explicitly marks the proposal sent. This
//    records the user's real-world action; it does not claim an email was
//    delivered. To actually email a proposal, use the existing outreach
//    composer on the deal — that flow logs a real message.
//  • acceptedAt/rejectedAt are set only via explicit user actions.
//
// Every function is authenticated and ownership-checked like the rest of the
// app: the caller can only ever read/write their own workspace's proposals.

const PROPOSAL_STATUS = ["draft", "sent", "viewed", "accepted", "rejected"] as const;

const optionalText = {
  summary: v.optional(v.string()),
  problem: v.optional(v.string()),
  solution: v.optional(v.string()),
  deliverables: v.optional(v.array(v.string())),
  timeline: v.optional(v.string()),
  pricing: v.optional(v.string()),
  outcomes: v.optional(v.string()),
  nextSteps: v.optional(v.string()),
};

async function requireUserId(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) throw new Error("You need to sign in to do that.");
  return userId;
}

type ProposalDoc = Doc<"proposals">;

async function getOwnedProposal(ctx: MutationCtx, id: string): Promise<ProposalDoc> {
  const userId = await requireUserId(ctx);
  const proposal = await ctx.db.get(id as never);
  if (!proposal || (proposal as ProposalDoc).userId !== userId) {
    throw new Error("Proposal not found.");
  }
  return proposal as ProposalDoc;
}

/** All proposals for the workspace, newest first. */
export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("proposals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
  },
});

/** One proposal, ownership-checked. */
export const get = query({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const p = await ctx.db.get(id);
    if (!p || p.userId !== userId) return null;
    return p;
  },
});

/** All proposals for one deal (ownership enforced via the deal). */
export const listForDeal = query({
  args: { dealId: v.id("leads") },
  handler: async (ctx, { dealId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const deal = await ctx.db.get(dealId);
    if (!deal || deal.userId !== userId) return [];
    return await ctx.db
      .query("proposals")
      .withIndex("by_deal", (q) => q.eq("dealId", dealId))
      .collect();
  },
});

/**
 * Create a proposal (as a draft). Title + deal required; the deal's value and
 * currency prefill the proposal's pricing context but the proposal value is
 * editable and independent.
 */
export const create = mutation({
  args: {
    dealId: v.id("leads"),
    title: v.string(),
    value: v.optional(v.number()),
    currency: v.optional(v.string()),
    ...optionalText,
  },
  handler: async (ctx, { dealId, title, ...fields }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("You need to sign in to do that.");
    const deal = await ctx.db.get(dealId);
    if (!deal || deal.userId !== userId) throw new Error("Deal not found.");
    const name = title.trim();
    if (!name) throw new Error("Give the proposal a title.");
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    const now = Date.now();
    return await ctx.db.insert("proposals", {
      userId,
      dealId,
      title: name,
      status: "draft",
      createdAt: now,
      updatedAt: now,
      ...clean,
    });
  },
});

/**
 * Edit a draft (or any proposal's content fields). Content edits are allowed
 * in any status — a sent proposal can be revised — but status itself only
 * changes through the dedicated transition mutations below.
 */
export const update = mutation({
  args: {
    id: v.id("proposals"),
    title: v.optional(v.string()),
    value: v.optional(v.number()),
    currency: v.optional(v.string()),
    ...optionalText,
  },
  handler: async (ctx, { id, ...fields }) => {
    await getOwnedProposal(ctx, id);
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, v]) => v !== undefined),
    );
    if (clean.title !== undefined && !(clean.title as string).trim()) {
      throw new Error("Title can't be empty.");
    }
    await ctx.db.patch(id as never, { ...clean, updatedAt: Date.now() });
  },
});

/** Mark sent — records the user's real-world action with a real timestamp. */
export const markSent = mutation({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const proposal = await getOwnedProposal(ctx, id);
    if (proposal.status === "accepted" || proposal.status === "rejected") {
      throw new Error(
        `This proposal was already ${proposal.status} — its outcome can't change.`,
      );
    }
    await ctx.db.patch(id, { status: "sent", sentAt: Date.now(), updatedAt: Date.now() });
    // Proposals count as deal activity — but only if the linked deal still
    // exists (legacy data can hold a proposal whose deal was removed).
    const deal = await ctx.db.get(proposal.dealId);
    if (deal) await ctx.db.patch(proposal.dealId, { lastActivityAt: Date.now() });
  },
});

/** Mark accepted — terminal state; keeps the actual timestamp. */
export const markAccepted = mutation({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const proposal = await getOwnedProposal(ctx, id);
    if (proposal.status === "rejected") {
      throw new Error("This proposal was rejected — create a new one instead.");
    }
    await ctx.db.patch(id, {
      status: "accepted",
      acceptedAt: Date.now(),
      rejectedAt: undefined,
      rejectedReason: undefined,
      updatedAt: Date.now(),
    });
    const deal = await ctx.db.get(proposal.dealId);
    if (deal) await ctx.db.patch(proposal.dealId, { lastActivityAt: Date.now() });
  },
});

/** Mark rejected — terminal state, with an optional honest reason. */
export const markRejected = mutation({
  args: { id: v.id("proposals"), reason: v.optional(v.string()) },
  handler: async (ctx, { id, reason }) => {
    const proposal = await getOwnedProposal(ctx, id);
    if (proposal.status === "accepted") {
      throw new Error("This proposal was accepted — its outcome can't change.");
    }
    const clean = reason?.trim();
    await ctx.db.patch(id, {
      status: "rejected",
      rejectedAt: Date.now(),
      acceptedAt: undefined,
      rejectedReason: clean || undefined,
      updatedAt: Date.now(),
    });
    const deal = await ctx.db.get(proposal.dealId);
    if (deal) await ctx.db.patch(proposal.dealId, { lastActivityAt: Date.now() });
  },
});

/**
 * Revert to draft — only from `sent`. Never touches sentAt/viewedAt/accepted/
 * rejected timestamps (history stays true); the status alone moves back.
 */
export const revertToDraft = mutation({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    const proposal = await getOwnedProposal(ctx, id);
    if (proposal.status === "accepted" || proposal.status === "rejected") {
      throw new Error("A decided proposal can't go back to draft.");
    }
    await ctx.db.patch(id, { status: "draft", updatedAt: Date.now() });
  },
});

export const remove = mutation({
  args: { id: v.id("proposals") },
  handler: async (ctx, { id }) => {
    await getOwnedProposal(ctx, id);
    await ctx.db.delete(id);
  },
});
