import { getAuthUserId } from "@convex-dev/auth/server";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
} from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
  computeClosedStats,
  computePipelineStats,
  dealCurrency,
  dealTitle,
  flaggedOpenDeals,
  isOpenDeal,
  lastActivityOf,
  stageLastAtMap,
} from "../lib/revenue";
import { canonicalStatus, statusLabel, weightedValue } from "../lib/leadStatus";
import {
  computeGoalCurrent,
  formatGoalValue,
  goalProgressFraction,
  type GoalKind,
  type GoalPeriod,
} from "../lib/goalEngine";
import {
  computeClients,
  filterClients,
  sortClients,
  type Client,
  type ClientFilterState,
} from "../lib/clients";

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
 * Hard-capped so the AI context can never grow unbounded. Non-text tool-call
 * marker turns participate in the same bounded window as every other row.
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
 * 2c-4A: persist ONE non-content assistant turn (e.g. the honest note shown
 * when the model requested a tool that this action deliberately does not
 * execute yet). Insert-once inside the conversation; the caller MUST pass a
 * session-derived userId — never a model-supplied one.
 */
export const persistToolCallMarker = internalMutation({
  args: {
    conversationId: v.id("conversations"),
    userId: v.id("users"),
    note: v.string(),
  },
  handler: async (
    ctx,
    { conversationId, userId, note },
  ): Promise<Id<"conversationMessages">> => {
    return insertTurn(ctx, {
      conversationId,
      userId,
      role: "assistant",
      content: note.slice(0, 300),
    });
  },
});

/**
 * Streaming support (Phase 3 §2b-3A): update the content of ONE existing
 * assistant message as the model's reply accumulates. The row is created
 * once by appendAssistantMessage and patched in place — chunks never create
 * rows, so exactly one persisted assistant message remains. Ownership is
 * re-verified on every patch: the row must belong to the caller, be an
 * assistant turn, and live in a conversation the caller owns.
 */
export const updateAssistantMessage = internalMutation({
  args: {
    messageId: v.id("conversationMessages"),
    userId: v.id("users"),
    content: v.string(),
  },
  handler: async (ctx, { messageId, userId, content }) => {
    const row = await ctx.db.get(messageId);
    if (!row || row.userId !== userId || row.role !== "assistant") {
      throw new Error("Message not found.");
    }
    const conv = await ctx.db.get(row.conversationId);
    if (!conv || conv.userId !== userId) throw new Error("Conversation not found.");
    await ctx.db.patch(messageId, { content: content.slice(0, MAX_CONTENT) });
  },
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

// ── Phase 3 §2b-2: read-only record retrieval for the Copilot ─────────────
//
// Deterministic, bounded, category-driven retrieval over the caller's OWN
// records. The category is chosen SERVER-SIDE from the user's question (§8 —
// the model never picks queries and never gets raw database access). Every
// category reuses the Phase 2 definitions (flaggedOpenDeals/dealFlags,
// computeClients, dealCurrency, statusLabel) so Copilot record answers agree
// with Dashboard, Pipeline, Clients and Analytics. Projections only — no
// message bodies, no AI fields, no raw documents.
export const retrieveForCopilot = internalQuery({
  args: {
    userId: v.id("users"),
    category: v.union(
      v.literal("leads_followup"),
      v.literal("deals_open"),
      v.literal("deals_attention"),
      v.literal("clients_top"),
      v.literal("proposals_pending"),
    ),
    limit: v.number(),
  },
  handler: async (ctx, { userId, category, limit }) => {
    const cap = Math.max(1, Math.min(20, Math.round(limit)));
    const now = Date.now();

    if (category === "deals_open" || category === "deals_attention") {
      const leads = await ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      if (category === "deals_open") {
        const open = leads.filter(isOpenDeal);
        const rows = [...open]
          .sort((a, b) => (b.dealValue ?? 0) - (a.dealValue ?? 0))
          .slice(0, cap);
        return {
          category,
          totalMatching: open.length,
          partial: open.length > rows.length,
          records: rows.map((l) => ({
            id: l._id,
            name: dealTitle(l),
            stage: statusLabel(canonicalStatus(l.status)),
            value: l.dealValue,
            currency: dealCurrency(l),
            probability: l.probability,
            expectedCloseAt: l.expectedCloseAt,
            lastActivityAt: lastActivityOf(l),
            createdAt: l._creationTime,
          })),
        };
      }
      // deals_attention: exactly the flaggedOpenDeals definition the
      // Analytics "Deals needing attention" section uses (flag rank, then
      // value) — same signals, same thresholds, no new definitions.
      const history = await ctx.db
        .query("dealStageHistory")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const flagged = flaggedOpenDeals(leads, stageLastAtMap(history), [], now);
      return {
        category,
        totalMatching: flagged.length,
        partial: flagged.length > cap,
        records: flagged.slice(0, cap).map(({ lead, flags }) => ({
          id: lead._id,
          name: dealTitle(lead),
          stage: statusLabel(canonicalStatus(lead.status)),
          value: lead.dealValue,
          currency: dealCurrency(lead),
          probability: lead.probability,
          flags: flags.map((f) => f.detail),
          lastActivityAt: lastActivityOf(lead),
          expectedCloseAt: lead.expectedCloseAt,
        })),
      };
    }

    if (category === "leads_followup") {
      const leads = await ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const open = leads.filter(
        (l) => !["won", "lost"].includes(canonicalStatus(l.status)),
      );
      // Overdue follow-ups first, then staled last activity, then untouched
      // new leads (oldest first). Real timestamps only — never invented.
      const quietness = (l: Parameters<typeof lastActivityOf>[0]) => {
        const last = lastActivityOf(l);
        return last === undefined ? Number.POSITIVE_INFINITY : now - last;
      };
      const ranked = [...open].sort((a, b) => {
        const aOver = a.nextFollowUpAt !== undefined && a.nextFollowUpAt < now ? 0 : 1;
        const bOver = b.nextFollowUpAt !== undefined && b.nextFollowUpAt < now ? 0 : 1;
        return aOver - bOver || quietness(a) - quietness(b);
      });
      const rows = ranked.slice(0, cap);
      return {
        category,
        totalMatching: open.length,
        partial: open.length > rows.length,
        records: rows.map((l) => ({
          id: l._id,
          name: l.name,
          company: l.company,
          stage: statusLabel(canonicalStatus(l.status)),
          source: l.source,
          score: l.score,
          tags: l.tags,
          lastActivityAt: lastActivityOf(l),
          nextFollowUpAt: l.nextFollowUpAt,
          dealValue: l.dealValue,
          currency: dealCurrency(l),
          createdAt: l._creationTime,
        })),
      };
    }

    if (category === "clients_top") {
      const profile = await ctx.db
        .query("businessProfiles")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .first();
      const leads = await ctx.db
        .query("leads")
        .withIndex("by_user", (q) => q.eq("userId", userId))
        .collect();
      const clients = computeClients(leads, profile?.products);
      // Ordered by the same recorded-revenue definition the Clients page and
      // the Copilot snapshot use (Σ dealValue over won deals).
      const ranked = [...clients].sort((a, b) => b.totalRevenue - a.totalRevenue);
      const rows = ranked.slice(0, cap);
      return {
        category,
        totalMatching: clients.length,
        partial: clients.length > rows.length,
        records: rows.map((c) => ({
          id: c.key,
          name: c.name,
          contact: c.primaryLead.name,
          industry: c.industry,
          totalRevenue: c.totalRevenue,
          wonDeals: c.wonDeals.length,
          activeDeals: c.activeDeals.length,
          lastActivityAt: c.lastActivityAt,
          health: c.health.state,
          healthDetail: c.health.detail,
        })),
      };
    }

    // proposals_pending — sent/viewed proposals awaiting an outcome, newest
    // send first. Deal names resolve from the caller's own leads only.
    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const pending = proposals.filter(
      (p) => p.status === "sent" || p.status === "viewed",
    );
    const sorted = [...pending].sort(
      (a, b) => (b.sentAt ?? b.updatedAt) - (a.sentAt ?? a.updatedAt),
    );
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const dealName = new Map(leads.map((l) => [l._id as string, dealTitle(l)]));
    const capped = sorted.slice(0, cap);
    return {
      category,
      totalMatching: pending.length,
      partial: pending.length > capped.length,
      records: capped.map((p) => ({
        id: p._id,
        title: p.title,
        deal: dealName.get(p.dealId) ?? "Deal no longer exists",
        status: p.status,
        value: p.value,
        currency: p.currency,
        sentAt: p.sentAt,
        updatedAt: p.updatedAt,
        createdAt: p.createdAt,
      })),
    };
  },
});

// ── Phase 2c-2: read-only Copilot tools (first tool: get_deal) ─────────────
//
// Tools are INTERNAL server-side capabilities for the Copilot (invoked only
// from ai.copilotReply, never callable from the browser). The 2c-1 contract:
// validated tool name → validated arguments → authenticated execution →
// user-scoped read → bounded/sanitized projection → result envelope.
// userId is NEVER a tool argument — it is resolved server-side from the
// authenticated session and every read is scoped by it. Foreign and missing
// records deliberately share one not_found result (no existence leak).

/** Success envelope for a single-entity tool result (2c-1 §5). */
export type ToolOk<T> = {
  ok: true;
  tool: string;
  data: T;
  returnedCount: number;
};

/** Structured failure envelope — safe to hand to the model. */
export type ToolErr = {
  ok: false;
  tool: string;
  error: {
    code: "invalid_args" | "not_found" | "unknown_tool" | "failed";
    message: string;
  };
};

/**
 * Structural Convex-ID check (T4) — rejects malformed IDs BEFORE any database
 * lookup. Final existence/ownership authority remains the scoped get() below.
 */
export function isValidConvexIdShape(id: string): boolean {
  return /^[0-9a-z]{20,40}$/.test(id);
}

/**
 * Approved get_deal projection (T5/T6/T7): fixed field list, every value
 * derived from the existing Phase 2 helpers so the tool can never disagree
 * with Deal Detail, Pipeline, Analytics or retrieval. Zero-preserving (no
 * `|| undefined` anywhere) and null-preserving — absent optional fields stay
 * absent, never fabricated.
 */
export function projectDealForCopilot(lead: Doc<"leads">): Record<string, unknown> {
  return {
    id: lead._id,
    name: dealTitle(lead),
    stage: statusLabel(canonicalStatus(lead.status)),
    status: canonicalStatus(lead.status),
    value: lead.dealValue,
    currency: dealCurrency(lead),
    probability: lead.probability,
    weightedValue: weightedValue(lead.dealValue, lead.probability, lead.status),
    expectedCloseAt: lead.expectedCloseAt,
    wonAt: lead.wonAt,
    lostAt: lead.lostAt,
    lossReason: lead.lossReason,
    lastActivityAt: lastActivityOf(lead),
    createdAt: lead._creationTime,
    source: lead.source,
    company: lead.company,
    contactName: lead.name,
  };
}

/**
 * Ownership decision for get_deal (T2/T3/T8), extracted pure so it is
 * deterministically testable: a missing row and a foreign row are the SAME
 * not_found outcome — no existence leak across workspaces. Identical
 * predicate to the proven leads.get / proposals.get ownership idiom.
 */
export function dealToolDecision(
  lead: Doc<"leads"> | null,
  userId: Id<"users">,
): { ok: true } | { ok: false; code: "not_found" } {
  if (!lead || lead.userId !== userId) return { ok: false, code: "not_found" };
  return { ok: true };
}

/**
 * get_deal (2c-2): inspect ONE owned deal by ID.
 * Input: exactly { dealId }. Output: the approved projection only.
 * Missing/foreign IDs return the same not_found result. Projection excludes
 * userId, notes, AI internals, message bodies and campaign internals.
 */
export const toolGetDeal = internalQuery({
  args: { userId: v.id("users"), dealId: v.string() },
  handler: async (
    ctx,
    { userId, dealId },
  ): Promise<ToolOk<Record<string, unknown>> | ToolErr> => {
    // Validation FIRST (T4): a malformed ID is rejected before any database
    // lookup.
    if (!isValidConvexIdShape(dealId)) {
      return {
        ok: false,
        tool: "get_deal",
        error: { code: "invalid_args", message: "Invalid deal ID." },
      };
    }

    // v.id("leads") throws on a structurally invalid string, so this cast is
    // only reached for well-formed IDs; the scoped get() below decides
    // existence + ownership in ONE indexed read.
    const lead = await ctx.db.get(dealId as unknown as Id<"leads">);
    const decision = dealToolDecision(lead, userId);
    if (!decision.ok) {
      // T2/T3/T8: missing AND foreign share one result — no ownership leak.
      return {
        ok: false,
        tool: "get_deal",
        error: { code: decision.code, message: "Deal not found." },
      };
    }

    return { ok: true, tool: "get_deal", data: projectDealForCopilot(lead!), returnedCount: 1 };
  },
});

// ── Phase 2c-3B: get_clients ───────────────────────────────────────────────
//
// Bounded client LIST tool. Same boundary as get_deal/get_client: validated
// arguments → authenticated read (by_user) → computeClients → the CANONICAL
// sortClients/filterClients semantics from the Clients page → hard cap →
// per-client projection reusing projectClientForCopilot verbatim. No second
// client identity, no new sorting/filtering/revenue rules (§4/§7/§8).

export type GetClientsArgs = {
  sort?: "revenue" | "activity" | "name";
  filter?: { hasActiveDeals?: boolean; minRevenue?: boolean };
  limit?: number;
};

export const CLIENTS_LIST_DEFAULT_LIMIT = 10;
export const CLIENTS_LIST_MAX_LIMIT = 20;

const CLIENTS_SORTS = ["revenue", "activity", "name"] as const;

/**
 * Strict argument parsing (T9): input must be a plain object with only the
 * known keys; enums/booleans/integer limits validated — malformed input is
 * REJECTED, never silently interpreted. `limit: 0` is valid and yields an
 * empty result (the caller asked for none); limits above the hard cap are
 * CLAMPED to 20, not rejected (bounded read-only contract, §2/§9).
 */
export function parseGetClientsArgs(
  raw: unknown,
): { ok: true; args: GetClientsArgs } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== "sort" && k !== "filter" && k !== "limit") return { ok: false };
  }
  const out: GetClientsArgs = {};
  if (o.sort !== undefined) {
    if (typeof o.sort !== "string" || !CLIENTS_SORTS.includes(o.sort as never)) {
      return { ok: false };
    }
    out.sort = o.sort as GetClientsArgs["sort"];
  }
  if (o.filter !== undefined) {
    if (typeof o.filter !== "object" || o.filter === null || Array.isArray(o.filter)) {
      return { ok: false };
    }
    const f = o.filter as Record<string, unknown>;
    for (const k of Object.keys(f)) {
      if (k !== "hasActiveDeals" && k !== "minRevenue") return { ok: false };
    }
    out.filter = {};
    if (f.hasActiveDeals !== undefined) {
      if (typeof f.hasActiveDeals !== "boolean") return { ok: false };
      out.filter.hasActiveDeals = f.hasActiveDeals;
    }
    if (f.minRevenue !== undefined) {
      if (typeof f.minRevenue !== "boolean") return { ok: false };
      out.filter.minRevenue = f.minRevenue;
    }
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== "number" || !Number.isInteger(o.limit) || o.limit < 0) {
      return { ok: false };
    }
    out.limit = o.limit;
  }
  return { ok: true, args: out };
}

/**
 * Canonical filter/sort/cap pipeline (T1–T8/T13), pure + testable: maps the
 * tool's boolean filters onto the EXISTING ClientFilterState, then applies
 * the canonical filterClients → sortClients → hard cap. No new business
 * rules — the canonical helper has no inverse filters, so `false`/absent
 * applies no narrowing rather than inventing one (§7/§8).
 */
export function runGetClientsPipeline(
  args: GetClientsArgs,
  allClients: Client[],
): Client[] {
  const state: ClientFilterState = {
    health: "all",
    minRevenue: args.filter?.minRevenue === true ? "gt0" : "",
    active: args.filter?.hasActiveDeals === true ? "hasActive" : "all",
    q: "",
  };
  const filtered = filterClients(allClients, state);
  // Default sort "revenue" = the Clients page's own list ordering (§7).
  const sorted = sortClients(filtered, args.sort ?? "revenue");
  const effectiveLimit = Math.min(
    CLIENTS_LIST_MAX_LIMIT,
    args.limit ?? CLIENTS_LIST_DEFAULT_LIMIT,
  );
  return sorted.slice(0, effectiveLimit);
}

/**
 * get_clients (2c-3B): bounded client list for the authenticated workspace.
 * Two indexed reads (leads + profile), then computeClients and the canonical
 * filterClients/sortClients helpers — the exact semantics the Clients page
 * shows. Default sort "revenue"; default limit 10; hard cap 20;
 * `returnedCount` = number returned, not the number matching the filter.
 */
export const toolGetClients = internalQuery({
  args: { userId: v.id("users"), args: v.any() },
  handler: async (
    ctx,
    { userId, args },
  ): Promise<ToolOk<Record<string, unknown>[]> | ToolErr> => {
    const parsed = parseGetClientsArgs(args);
    if (!parsed.ok) {
      return {
        ok: false,
        tool: "get_clients",
        error: { code: "invalid_args", message: "Invalid arguments." },
      };
    }

    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();

    const rows = runGetClientsPipeline(
      parsed.args,
      computeClients(leads, profile?.products),
    );
    return {
      ok: true,
      tool: "get_clients",
      data: rows.map(projectClientForCopilot),
      returnedCount: rows.length,
    };
  },
});

// ── Phase 2c-3C: get_proposals ─────────────────────────────────────────────
//
// Bounded proposal LIST tool. Same boundary as the other tools: validated
// arguments → authenticated read (by_user) → exact status filter →
// updatedAt-desc ordering → hard cap → fixed 13-field projection. Statuses
// are the canonical proposal lifecycle values (proposals.ts PROPOSAL_STATUS)
// compared exactly — no second normalization system. Deal names resolve ONLY
// through the caller's own leads via dealTitle; a missing/foreign deal keeps
// the existing safe "Deal no longer exists" behavior. Proposal sections are
// deliberately NOT projected (may be large/sensitive) — 2c-1 §3.

export const GET_PROPOSALS_DEFAULT_LIMIT = 10;
export const GET_PROPOSALS_MAX_LIMIT = 20;

export type GetProposalsArgs = {
  status?: "all" | "draft" | "sent" | "viewed" | "accepted" | "rejected";
  limit?: number;
};

const PROPOSAL_TOOL_STATUSES = [
  "all",
  "draft",
  "sent",
  "viewed",
  "accepted",
  "rejected",
] as const;

/** Strict argument parsing (T11): plain object, known keys only, enum status,
 *  integer limit ≥ 0. `limit: 0` is valid → empty result; values above the
 *  hard cap are CLAMPED later, not rejected. Malformed input is rejected. */
export function parseGetProposalsArgs(
  raw: unknown,
): { ok: true; args: GetProposalsArgs } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== "status" && k !== "limit") return { ok: false };
  }
  const out: GetProposalsArgs = {};
  if (o.status !== undefined) {
    if (typeof o.status !== "string" || !PROPOSAL_TOOL_STATUSES.includes(o.status as never)) {
      return { ok: false };
    }
    out.status = o.status as GetProposalsArgs["status"];
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== "number" || !Number.isInteger(o.limit) || o.limit < 0) {
      return { ok: false };
    }
    out.limit = o.limit;
  }
  return { ok: true, args: out };
}

/**
 * Approved get_proposals projection (T12/T14): exactly the 13 contract
 * fields. Zero-preserving (value: 0 stays 0 — no `|| undefined` anywhere);
 * absent optionals stay absent. No userId, no proposal sections/bodies, no
 * raw lead/deal objects, no campaign data.
 */
export function projectProposalForCopilot(
  p: Doc<"proposals">,
  dealName: string,
): Record<string, unknown> {
  return {
    id: p._id,
    title: p.title,
    status: p.status,
    value: p.value,
    currency: p.currency,
    sentAt: p.sentAt,
    acceptedAt: p.acceptedAt,
    rejectedAt: p.rejectedAt,
    rejectedReason: p.rejectedReason,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    dealName,
    dealId: p.dealId,
  };
}

/**
 * Canonical filter/order/cap pipeline (T1–T10/T13/T17), pure + testable:
 * exact status match ("all"/absent → no narrowing), then updatedAt DESC (the
 * approved contract ordering), then the hard cap. Single predicates, no
 * second business-logic implementation.
 */
export function runGetProposalsPipeline(
  args: GetProposalsArgs,
  proposals: Doc<"proposals">[],
): Doc<"proposals">[] {
  const status = args.status ?? "all";
  const filtered =
    status === "all"
      ? proposals
      : proposals.filter((p) => p.status === status);
  const sorted = [...filtered].sort((a, b) => b.updatedAt - a.updatedAt);
  const effectiveLimit = Math.min(
    GET_PROPOSALS_MAX_LIMIT,
    args.limit ?? GET_PROPOSALS_DEFAULT_LIMIT,
  );
  return sorted.slice(0, effectiveLimit);
}

/**
 * get_proposals (2c-3C): bounded proposal list for the authenticated
 * workspace. Two indexed reads (proposals by_user + the caller's own leads
 * for deal-name resolution — one pass, no N+1). Default limit 10, hard cap
 * 20, `returnedCount` = number returned.
 */
export const toolGetProposals = internalQuery({
  args: { userId: v.id("users"), args: v.any() },
  handler: async (
    ctx,
    { userId, args },
  ): Promise<ToolOk<Record<string, unknown>[]> | ToolErr> => {
    const parsed = parseGetProposalsArgs(args);
    if (!parsed.ok) {
      return {
        ok: false,
        tool: "get_proposals",
        error: { code: "invalid_args", message: "Invalid arguments." },
      };
    }

    const proposals = await ctx.db
      .query("proposals")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    // Deal names resolve from the caller's OWN leads only (by_user) — the
    // map can never contain a foreign deal, and a missing/removed deal keeps
    // the established safe label (§9/T15).
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const dealName = new Map(leads.map((l) => [l._id as string, dealTitle(l)]));

    const rows = runGetProposalsPipeline(parsed.args, proposals);
    return {
      ok: true,
      tool: "get_proposals",
      data: rows.map((p) =>
        projectProposalForCopilot(p, dealName.get(p.dealId) ?? "Deal no longer exists"),
      ),
      returnedCount: rows.length,
    };
  },
});

// ── Phase 2c-3A: get_client ────────────────────────────────────────────────
//
// Same pattern as get_deal: validation → decision → projection, with the
// pure parts extracted for deterministic testing. Clients are DERIVED by
// computeClients from the authenticated user's own leads — there is no
// client table, so a key from another workspace simply does not exist in the
// derived set: missing and foreign are the SAME not_found (no existence
// leak). All semantics (revenue, counts, health, retention, deal roles) come
// verbatim from computeClients — no second definition (§6/§9).

/** Client-key validation (T4): string, non-blank, ≤120 characters. */
export function isValidClientKey(key: unknown): key is string {
  return typeof key === "string" && key.trim().length > 0 && key.length <= 120;
}

/** Maximum related deals returned inside one get_client result (2c-1 §4). */
export const CLIENT_DEAL_CAP = 20;

/**
 * Client resolution (T2/T3/T10), pure + testable: find the derived client
 * whose stable key matches. Missing and foreign keys return the identical
 * not_found decision.
 */
export function clientToolDecision(
  clients: Client[],
  clientKey: string,
): { ok: true; client: Client } | { ok: false; code: "not_found" } {
  const client = clients.find((c) => c.key === clientKey.trim());
  if (!client) return { ok: false, code: "not_found" };
  return { ok: true, client };
}

/**
 * Approved get_client projection (T5/T6/T8/T9): fixed fields reused verbatim
 * from the computed Client — totalRevenue/openValue/counts/health/retention
 * are NOT recomputed here. Related deals capped at CLIENT_DEAL_CAP, each with
 * only the eight approved fields. Zero-preserving; absent optionals stay
 * absent. Never exposes userId, notes, emails, message bodies or AI fields.
 */
export function projectClientForCopilot(client: Client): Record<string, unknown> {
  return {
    key: client.key,
    name: client.name,
    contact: client.primaryLead.name,
    industry: client.industry,
    website: client.website,
    totalRevenue: client.totalRevenue,
    openValue: client.openValue,
    wonDeals: client.wonDeals.length,
    activeDeals: client.activeDeals.length,
    lostDeals: client.deals.filter((d) => d.role === "lost").length,
    lastActivityAt: client.lastActivityAt,
    nextActivityAt: client.nextActivityAt,
    health: { state: client.health.state, detail: client.health.detail },
    retention: {
      state: client.retention.state,
      evidence: client.retention.evidence,
    },
    deals: client.deals.slice(0, CLIENT_DEAL_CAP).map((d) => ({
      id: d.lead._id,
      name: dealTitle(d.lead),
      role: d.role,
      value: d.lead.dealValue,
      currency: dealCurrency(d.lead),
      status: canonicalStatus(d.lead.status),
      wonAt: d.lead.wonAt,
      lastActivityAt: lastActivityOf(d.lead),
    })),
  };
}

/**
 * get_client (2c-3A): inspect ONE derived client by its stable key.
 * Input: exactly { clientKey }. Two indexed reads (leads + profile for the
 * same products input the Clients page/snapshot use) — no N+1, no client
 * table. Missing/foreign keys return the same not_found result.
 */
export const toolGetClient = internalQuery({
  args: { userId: v.id("users"), clientKey: v.string() },
  handler: async (
    ctx,
    { userId, clientKey },
  ): Promise<ToolOk<Record<string, unknown>> | ToolErr> => {
    // Validation FIRST (T4): reject malformed keys before any database read.
    if (!isValidClientKey(clientKey)) {
      return {
        ok: false,
        tool: "get_client",
        error: { code: "invalid_args", message: "Invalid client key." },
      };
    }

    // Clients are derived at read time from the caller's own records — the
    // same derivation the Clients page and copilotSnapshot use (§3/§6).
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const profile = await ctx.db
      .query("businessProfiles")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .first();
    const clients = computeClients(leads, profile?.products);

    const decision = clientToolDecision(clients, clientKey);
    if (!decision.ok) {
      // T2/T3/T10: missing AND foreign share one result — no ownership leak.
      return {
        ok: false,
        tool: "get_client",
        error: { code: decision.code, message: "Client not found." },
      };
    }

    return {
      ok: true,
      tool: "get_client",
      data: projectClientForCopilot(decision.client),
      returnedCount: 1,
    };
  },
});

// ── Phase 2c-3D: get_followups ─────────────────────────────────────────────
//
// Bounded follow-up LIST tool — the fifth and final initial read-only tool.
// Bucket semantics REUSE the existing followUps.stats definitions exactly
// (local endOfDay 23:59:59.999 boundary; overdue < now; today ≤ endOfDay;
// upcoming > endOfDay; done = completed rows) — no new date model (§5/§6).
// The reference time is captured ONCE per invocation and passed through the
// pure pipeline so tests are deterministic. Follow-up rows whose lead no
// longer exists are dropped, matching followUps.listForUser's established
// safe behavior — a foreign lead can therefore never resolve to a name.

export const GET_FOLLOWUPS_DEFAULT_LIMIT = 10;
export const GET_FOLLOWUPS_MAX_LIMIT = 20;

export type GetFollowupsArgs = {
  bucket?: "overdue" | "today" | "upcoming" | "done" | "all";
  limit?: number;
};

const FOLLOWUP_BUCKETS = ["overdue", "today", "upcoming", "done", "all"] as const;
type FollowUpRow = Doc<"followUps">;

/** Strict argument parsing (T10): known keys only, enum bucket, integer
 *  limit ≥ 0. Default bucket "all" — the canonical unfiltered behavior. */
export function parseGetFollowupsArgs(
  raw: unknown,
): { ok: true; args: GetFollowupsArgs } | { ok: false } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { ok: false };
  const o = raw as Record<string, unknown>;
  for (const k of Object.keys(o)) {
    if (k !== "bucket" && k !== "limit") return { ok: false };
  }
  const out: GetFollowupsArgs = {};
  if (o.bucket !== undefined) {
    if (typeof o.bucket !== "string" || !FOLLOWUP_BUCKETS.includes(o.bucket as never)) {
      return { ok: false };
    }
    out.bucket = o.bucket as GetFollowupsArgs["bucket"];
  }
  if (o.limit !== undefined) {
    if (typeof o.limit !== "number" || !Number.isInteger(o.limit) || o.limit < 0) {
      return { ok: false };
    }
    out.limit = o.limit;
  }
  return { ok: true, args: out };
}

/**
 * Canonical bucket logic (T2–T6/T16), extracted pure with an explicit
 * reference time: mirrors followUps.stats exactly — overdue < now;
 * today ≤ local end-of-day; upcoming > end-of-day; done = status "done";
 * "all"/absent applies no narrowing. One clock read per invocation.
 */
export function bucketFollowUps(
  bucket: GetFollowupsArgs["bucket"] | undefined,
  rows: FollowUpRow[],
  now: number,
): FollowUpRow[] {
  const which = bucket ?? "all";
  if (which === "all") return rows;
  const endOfDay = new Date(now);
  endOfDay.setHours(23, 59, 59, 999);
  const end = endOfDay.getTime();
  if (which === "done") return rows.filter((f) => f.status === "done");
  const pending = rows.filter((f) => f.status === "pending");
  if (which === "overdue") return pending.filter((f) => f.dueAt < now);
  if (which === "today") return pending.filter((f) => f.dueAt >= now && f.dueAt <= end);
  return pending.filter((f) => f.dueAt > end); // upcoming
}

/**
 * Approved get_followups projection (T11/T15): exactly the 7 contract
 * fields. leadName is the lead record's own name field — no second naming
 * algorithm. note preserved verbatim; no userId/emails/messages/campaigns.
 */
export function projectFollowUpForCopilot(
  f: FollowUpRow,
  leadName: string,
): Record<string, unknown> {
  return {
    id: f._id,
    leadId: f.leadId,
    leadName,
    note: f.note,
    dueAt: f.dueAt,
    status: f.status,
    completedAt: f.completedAt,
  };
}

/** Canonical ordering (T12): dueAt ASC — followUps.listForUser's own sort. */
export function sortFollowUpsForCopilot(rows: FollowUpRow[]): FollowUpRow[] {
  return [...rows].sort((a, b) => a.dueAt - b.dueAt);
}

/**
 * get_followups (2c-3D): bounded follow-up list for the authenticated
 * workspace. Two indexed reads (followUps by_user_due + the caller's own
 * leads for one-pass name resolution — no N+1). Rows whose lead is missing
 * are dropped (listForUser semantics). Default bucket "all",
 * default limit 10, hard cap 20, dueAt ASC throughout.
 */
export const toolGetFollowups = internalQuery({
  args: { userId: v.id("users"), args: v.any() },
  handler: async (
    ctx,
    { userId, args },
  ): Promise<ToolOk<Record<string, unknown>[]> | ToolErr> => {
    const parsed = parseGetFollowupsArgs(args);
    if (!parsed.ok) {
      return {
        ok: false,
        tool: "get_followups",
        error: { code: "invalid_args", message: "Invalid arguments." },
      };
    }

    // One clock read per invocation (§6).
    const now = Date.now();
    const rows = await ctx.db
      .query("followUps")
      .withIndex("by_user_due", (q) => q.eq("userId", userId))
      .collect();
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const leadName = new Map(leads.map((l) => [l._id as string, l.name]));

    // Bucket → sort → cap through the pure canonical helpers. Rows whose
    // lead no longer exists are dropped (listForUser semantics) — the lead
    // map is built only from the caller's own leads, so a foreign leadId
    // can never resolve to a name (§10/T13).
    const filtered = bucketFollowUps(parsed.args.bucket, rows, now).filter(
      (f) => leadName.has(f.leadId as string),
    );
    const sorted = sortFollowUpsForCopilot(filtered);
    const effectiveLimit = Math.min(
      GET_FOLLOWUPS_MAX_LIMIT,
      parsed.args.limit ?? GET_FOLLOWUPS_DEFAULT_LIMIT,
    );
    const capped = sorted.slice(0, effectiveLimit);
    return {
      ok: true,
      tool: "get_followups",
      data: capped.map((f) =>
        projectFollowUpForCopilot(f, leadName.get(f.leadId as string) ?? ""),
      ),
      returnedCount: capped.length,
    };
  },
});
