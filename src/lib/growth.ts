import type { Doc } from "@/convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  PIPELINE_VALUE_STATUSES,
  REPLIED_STATUSES,
  canonicalStatus,
  defaultProbability,
  isQualified,
  statusLabel,
  weightedValue,
} from "@/lib/leadStatus";

/**
 * ── Metric definitions (single source of truth — production hardening §8) ──
 *
 * Every business metric in the app is computed HERE and only here. Counts,
 * rates, and money are kept strictly apart:
 *
 *   totalLeads            COUNT of every lead in the workspace
 *   newThisWeek           COUNT of leads created in the last 7 days
 *   qualified             COUNT whose canonical stage is Qualified or beyond
 *                         (contacted, discovery, proposal, interested, won)
 *   activeOpportunities   COUNT of open leads in a value stage
 *                         (discovery, proposal, interested)
 *   pipelineValue         MONEY: sum of dealValue on active opportunities
 *                         (raw, unweighted)
 *   weightedPipeline      MONEY ESTIMATE: Σ dealValue × probability ÷ 100
 *                         over active opportunities — a FORECAST, explicitly
 *                         an estimate based on the pipeline data available,
 *                         never a committed figure
 *   wonRevenue            MONEY: sum of dealValue on won deals
 *   lostValue             MONEY: sum of dealValue on lost deals
 *   wonCount              COUNT of won deals
 *   conversionRate        RATE: wonCount ÷ totalLeads (all-time, %)
 *   winRate (Analytics)   RATE: won ÷ (won + lost) — closed deals only (%)
 *   responseRate          RATE: received messages ÷ sent messages (%)
 *   replyRate (Analytics) RATE: leads whose canonical stage counts as replied
 *                         (discovery, proposal, interested, won — see
 *                         REPLIED_STATUSES) ÷ totalLeads (%). Stage-based;
 *                         legacy "replied" values are canonicalized first.
 *   meetingsBooked        COUNT of leads at Proposal or beyond
 *                         (proposal, interested, won). Pre-2025-09 the app
 *                         had a separate "meeting" stage; it is now Proposal.
 *   meetingRate           RATE: meetingsBooked ÷ totalLeads (%)
 *   proposalsOut          COUNT of leads at the Proposal stage
 *   avgDealSize           MONEY: wonRevenue ÷ won deals that have a value
 *   avgScore              SCORE: mean AI/heuristic lead score (0–100)
 *
 * Anything labeled "weighted" or "forecast" in the UI derives from
 * weightedPipeline and is an estimate. Dashboard and Analytics pages both
 * consume these functions, so a metric can never disagree with itself across
 * pages. (The former src/lib/analytics.ts was merged into this file.)
 *
 * ── Phase 2 (Revenue & Customer OS) additions ───────────────────────────
 *
 * Revenue/deal metrics now live in src/lib/revenue.ts (kept alias-free so it
 * can be shared server-side). The SAME definitions are used by Pipeline,
 * Analytics, Dashboard and the Copilot:
 *
 *   pipelineValue        MONEY: Σ dealValue over open deals (canonical stage
 *                        not won/lost) — see computePipelineStats
 *   weightedPipeline     MONEY ESTIMATE: Σ value × probability over open deals
 *   wonRevenue           MONEY: Σ dealValue on won deals (all-time actual)
 *   period won revenue   Dated by wonAt (§7 fix). Won deals that predate the
 *                        timestamp are EXCLUDED from period numbers (and the
 *                        exclusion count is disclosed) — never guessed at.
 *   winRate              RATE: won ÷ (won + lost) — CLOSED deals only. Distinct
 *                        from conversionRate (won ÷ all leads) above; labels
 *                        never mix the two formulas.
 *   avgDealSize          MONEY: won revenue ÷ won deals that have a value
 *   salesCycle           DAYS: wonAt − createdAt, only where BOTH exist
 *   dealFlags            Transparent stall/risk reasons with thresholds
 *                        centralized in REVENUE_THRESHOLDS — no opaque scoring
 *
 * Clients are DERIVED in src/lib/clients.ts from won deals grouped by
 * company/contact — no duplicate contact/company entity exists.
 */

type Lead = Doc<"leads">;
type Message = Doc<"messages">;
type FollowUp = { _id: string; leadId: string; dueAt: number; status: string; note?: string };

const DAY = 24 * 60 * 60 * 1000;

/** Currency formatting for deal values. Compact for large numbers. */
export function money(n: number | undefined): string {
  if (n === undefined || n === null) return "—";
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString()}`;
}

// ── Core metrics (§7) — every number derived from actual records ────────────

export interface GrowthMetrics {
  totalLeads: number;
  newThisWeek: number;
  qualified: number;
  activeOpportunities: number;
  pipelineValue: number; // sum of dealValue on open, in-pipeline deals
  weightedPipeline: number; // value × probability
  wonRevenue: number; // sum of dealValue on won deals
  lostValue: number;
  wonCount: number;
  conversionRate: number; // leads → won
  responseRate: number; // replies / sent (messages)
  avgDealSize: number | null; // mean dealValue of won deals with a value
  meetingsBooked: number;
  overdueFollowUps: number;
  dueTodayFollowUps: number;
  unreadReplies: number;
  activeCampaigns: number;
  proposalsOut: number;
}

export function computeGrowthMetrics(
  leads: Lead[],
  messages: Message[],
  followUps: FollowUp[],
  campaigns: { status: string }[],
): GrowthMetrics {
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const open = leads.filter((l) => !["won", "lost"].includes(canonicalStatus(l.status)));
  const inPipeline = leads.filter((l) =>
    PIPELINE_VALUE_STATUSES.includes(canonicalStatus(l.status)),
  );
  const won = leads.filter((l) => canonicalStatus(l.status) === "won");
  const lost = leads.filter((l) => canonicalStatus(l.status) === "lost");

  const pipelineValue = inPipeline.reduce((s, l) => s + (l.dealValue ?? 0), 0);
  const weightedPipeline = inPipeline.reduce(
    (s, l) => s + weightedValue(l.dealValue, l.probability, l.status),
    0,
  );
  const wonRevenue = won.reduce((s, l) => s + (l.dealValue ?? 0), 0);
  const valuedWon = won.filter((l) => l.dealValue !== undefined);

  const sent = messages.filter((m) => m.direction === "sent").length;
  const received = messages.filter((m) => m.direction === "received").length;

  return {
    totalLeads: leads.length,
    newThisWeek: leads.filter((l) => now - l._creationTime < 7 * DAY).length,
    qualified: leads.filter((l) => isQualified(l.status)).length,
    activeOpportunities: inPipeline.length,
    pipelineValue,
    weightedPipeline,
    wonRevenue,
    lostValue: lost.reduce((s, l) => s + (l.dealValue ?? 0), 0),
    wonCount: won.length,
    conversionRate: leads.length ? Math.round((won.length / leads.length) * 100) : 0,
    responseRate: sent ? Math.round((received / sent) * 100) : 0,
    avgDealSize: valuedWon.length
      ? Math.round(wonRevenue / valuedWon.length)
      : null,
    meetingsBooked: leads
      .filter((l) => ["proposal", "interested", "won"].includes(canonicalStatus(l.status)))
      .length,
    overdueFollowUps: followUps.filter((f) => f.status === "pending" && f.dueAt < now).length,
    dueTodayFollowUps: followUps.filter(
      (f) => f.status === "pending" && f.dueAt >= now && f.dueAt <= endOfDay.getTime(),
    ).length,
    unreadReplies: messages.filter((m) => m.direction === "received" && !m.readAt).length,
    activeCampaigns: campaigns.filter((c) => c.status === "active").length,
    proposalsOut: leads.filter((l) => canonicalStatus(l.status) === "proposal").length,
  };
}

// ── AI Growth Brief (§6) — generated from the metrics above ─────────────────

export interface BriefLine {
  text: string;
  to?: string;
  tone?: "plain" | "danger" | "accent";
}

export function computeGrowthBrief(
  metrics: GrowthMetrics,
  leads: Lead[],
): { headline: BriefLine[]; enoughData: boolean } {
  const lines: BriefLine[] = [];

  if (metrics.totalLeads === 0) {
    return { headline: [], enoughData: false };
  }

  if (metrics.overdueFollowUps > 0) {
    lines.push({
      text: `${metrics.overdueFollowUps} follow-up${metrics.overdueFollowUps === 1 ? "" : "s"} overdue`,
      to: "/tasks",
      tone: "danger",
    });
  }
  if (metrics.unreadReplies > 0) {
    lines.push({
      text: `${metrics.unreadReplies} repl${metrics.unreadReplies === 1 ? "y" : "ies"} waiting in your inbox`,
      to: "/inbox",
      tone: "accent",
    });
  }
  if (metrics.proposalsOut > 0) {
    lines.push({
      text: `${metrics.proposalsOut} proposal${metrics.proposalsOut === 1 ? "" : "s"} in play — worth a nudge if quiet`,
      to: "/pipeline",
    });
  }

  // Highest-value open opportunity, by actual deal value then score
  const open = leads.filter((l) => !["won", "lost"].includes(canonicalStatus(l.status)));
  const top = [...open].sort(
    (a, b) => (b.dealValue ?? 0) - (a.dealValue ?? 0) || (b.score ?? 0) - (a.score ?? 0),
  )[0];
  if (top) {
    const label =
      top.dealValue !== undefined
        ? `${top.name}${top.company ? ` (${top.company})` : ""} — ${money(top.dealValue)}`
        : `${top.name}${top.company ? ` (${top.company})` : ""}`;
    lines.push({
      text: `Highest-value opportunity: ${label}`,
      to: `/leads/${top._id}`,
    });
  }

  const dormant = open.filter(
    (l) => l.lastContactedAt !== undefined && Date.now() - l.lastContactedAt > 10 * DAY,
  ).length;
  if (dormant >= 2) {
    lines.push({
      text: `${dormant} engaged leads haven't been touched in 10+ days`,
      to: "/leads",
      tone: "danger",
    });
  }

  if (metrics.wonCount > 0 && metrics.conversionRate > 0) {
    lines.push({
      text: `${metrics.wonCount} deal${metrics.wonCount === 1 ? "" : "s"} won so far — ${metrics.conversionRate}% of all leads convert`,
      to: "/analytics",
    });
  }

  if (lines.length === 0) {
    lines.push({
      text: `You have ${metrics.activeOpportunities} active opportunit${metrics.activeOpportunities === 1 ? "y" : "ies"} and ${metrics.dueTodayFollowUps} follow-up${metrics.dueTodayFollowUps === 1 ? "" : "s"} due today. Nothing is burning.`,
      to: "/pipeline",
    });
  }

  return { headline: lines, enoughData: true };
}

// ── AI Growth Opportunities (§9) — evidence-backed recommendations ──────────

export interface GrowthOpportunity {
  id: string;
  title: string;
  evidence: string; // the "because" — always a real number/name
  action: { label: string; to: string };
}

export function computeOpportunities(
  metrics: GrowthMetrics,
  leads: Lead[],
  followUps: FollowUp[],
): GrowthOpportunity[] {
  const out: GrowthOpportunity[] = [];
  const now = Date.now();
  const open = leads.filter((l) => !["won", "lost"].includes(canonicalStatus(l.status)));

  // 1. Qualified leads never contacted
  const neverContacted = open.filter(
    (l) => l.lastContactedAt === undefined && l.status !== "new",
  );
  const freshUnworked = open.filter((l) => l.status === "new" && l.score !== undefined && l.score >= 70);
  const unworked = [...neverContacted, ...freshUnworked];
  if (unworked.length >= 3) {
    const names = unworked
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 3)
      .map((l) => l.name.split(" ")[0]);
    out.push({
      id: "unworked",
      title: `${unworked.length} leads haven't been contacted yet`,
      evidence: `Including ${names.join(", ")} — ${unworked.filter((l) => (l.score ?? 0) >= 70).length} of them score 70+.`,
      action: { label: "Review leads", to: "/leads" },
    });
  }

  // 2. Dormant engaged leads
  const dormant = open.filter(
    (l) => l.lastContactedAt !== undefined && now - l.lastContactedAt > 10 * DAY && l.nextFollowUpAt === undefined,
  );
  if (dormant.length >= 2) {
    out.push({
      id: "dormant",
      title: `Revive ${dormant.length} dormant opportunit${dormant.length === 1 ? "y" : "ies"}`,
      evidence: `${dormant.map((l) => l.name).slice(0, 3).join(", ")}${dormant.length > 3 ? " and more" : ""} — last touch ${timeAgo(dormant[0].lastContactedAt)}, no follow-up scheduled.`,
      action: { label: "Open pipeline", to: "/pipeline" },
    });
  }

  // 3. Stale proposals
  const staleProposals = open.filter(
    (l) =>
      canonicalStatus(l.status) === "proposal" &&
      l.lastContactedAt !== undefined &&
      now - l.lastContactedAt > 4 * DAY,
  );
  if (staleProposals.length > 0) {
    out.push({
      id: "stale-proposals",
      title: `${staleProposals.length} proposal${staleProposals.length === 1 ? "" : "s"} waiting too long`,
      evidence: `${staleProposals[0].name} — sent ${timeAgo(staleProposals[0].lastContactedAt)} with no activity since.`,
      action: { label: "Create follow-up", to: "/tasks" },
    });
  }

  // 4. Overdue follow-ups
  if (metrics.overdueFollowUps >= 3) {
    const first = followUps.find((f) => f.status === "pending" && f.dueAt < now);
    const leadName = leads.find((l) => l._id === first?.leadId)?.name;
    out.push({
      id: "overdue",
      title: `${metrics.overdueFollowUps} follow-ups are overdue`,
      evidence: first && leadName ? `Oldest: ${leadName}, due ${timeAgo(first.dueAt)}.` : "They're blocking momentum across the pipeline.",
      action: { label: "Open tasks", to: "/tasks" },
    });
  }

  // 5. Untouched new leads (first impression window)
  const fresh = open.filter((l) => l.status === "new" && now - l._creationTime > 2 * DAY);
  if (fresh.length >= 2) {
    out.push({
      id: "fresh",
      title: `${fresh.length} new leads added 2+ days ago with no outreach`,
      evidence: "First-touch speed is the one variable you fully control — these are cooling.",
      action: { label: "Review leads", to: "/leads" },
    });
  }

  // 6. High-value deal with no close date
  const dateless = open.filter((l) => l.dealValue !== undefined && l.expectedCloseAt === undefined);
  if (dateless.length > 0) {
    out.push({
      id: "dateless",
      title: `${dateless.length} deal${dateless.length === 1 ? " has" : "s have"} value but no expected close date`,
      evidence: ` forecasting and weighted pipeline stay incomplete until they're dated.`,
      action: { label: "Open pipeline", to: "/pipeline" },
    });
  }

  return out.slice(0, 5);
}

// ── Today's Growth Plan (§10) — up to 5 prioritized, real actions ───────────

export interface PlanAction {
  id: string;
  title: string;
  /** Why this was selected — always a real signal from the record. */
  why: string;
  to: string; // where to do it
  kind: "followup" | "reply" | "review" | "deal" | "outreach";
  priority: number;
}

export function computeTodayPlan(
  metrics: GrowthMetrics,
  leads: Lead[],
  followUps: FollowUp[],
): PlanAction[] {
  const actions: PlanAction[] = [];
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);
  const leadName = (id: string) => leads.find((l) => l._id === id)?.name ?? "a lead";

  // Highest value first: overdue follow-ups, then replies, then today's dues
  for (const f of followUps.filter((f) => f.status === "pending" && f.dueAt < now).slice(0, 2)) {
    const lead = leads.find((l) => l._id === f.leadId);
    const leadWhy = [
      lead?.dealValue !== undefined ? money(lead.dealValue) : null,
      (lead?.score ?? 0) >= 70 ? `score ${lead?.score}` : null,
      lead ? statusLabelOf(canonicalStatus(lead.status)) : null,
    ]
      .filter(Boolean)
      .join(" · ");
    actions.push({
      id: `fu-${f._id}`,
      title: `Follow up with ${leadName(f.leadId)}${f.note ? ` — ${f.note}` : ""}`,
      why: `Overdue — last due ${timeAgo(f.dueAt)}${leadWhy ? ` · ${leadWhy}` : ""}`,
      to: `/leads/${f.leadId}`,
      kind: "followup",
      priority: 0,
    });
  }
  if (metrics.unreadReplies > 0) {
    actions.push({
      id: "inbox",
      title: `Answer ${metrics.unreadReplies} waiting repl${metrics.unreadReplies === 1 ? "y" : "ies"}`,
      why: "Replies waiting — response speed drives reply-to-meeting rates",
      to: "/inbox",
      kind: "reply",
      priority: 1,
    });
  }
  for (const f of followUps
    .filter((f) => f.status === "pending" && f.dueAt >= now && f.dueAt <= endOfDay.getTime())
    .slice(0, 2)) {
    actions.push({
      id: `fu-${f._id}`,
      title: `Due today: ${f.note || `follow up with ${leadName(f.leadId)}`}`,
      why: "Scheduled for today",
      to: `/leads/${f.leadId}`,
      kind: "followup",
      priority: 2,
    });
  }
  if (metrics.proposalsOut >= 2) {
    actions.push({
      id: "proposals",
      title: `Check on ${metrics.proposalsOut} open proposals`,
      why: `${metrics.proposalsOut} deals sitting at Proposal — the stage where deals stall most`,
      to: "/pipeline",
      kind: "deal",
      priority: 3,
    });
  }
  const fresh = leads.filter((l) => l.status === "new");
  if (fresh.length >= 3) {
    actions.push({
      id: "outreach",
      title: `Send first outreach to ${Math.min(fresh.length, 3)} new leads`,
      why: `${fresh.length} leads added but never contacted — first-touch speed is controllable`,
      to: "/leads",
      kind: "outreach",
      priority: 4,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority).slice(0, 5);
}

// ── Next Best Action (§13) + Deal Health (§18) — measurable only ────────────

export type DealHealth = "healthy" | "attention" | "inactive" | "unknown";

export interface LeadAction {
  text: string;
  reason: string;
  to?: string;
}

export function nextBestAction(lead: Lead): LeadAction | null {
  const now = Date.now();
  const last = lead.lastContactedAt;

  if (lead.status === "won") return null;
  if (lead.status === "lost") return null;

  if (last === undefined) {
    return {
      text: lead.summary
        ? `Send the first outreach — ${lead.approach ? "use the suggested angle" : "lead with their context"}.`
        : "Analyze this lead, then send the first outreach.",
      reason: "No contact has been made yet — this is the oldest open gap.",
      to: "compose",
    };
  }

  const daysSince = (now - last) / DAY;

  if (lead.status === "proposal" && daysSince >= 4) {
    return {
      text: "Nudge with a short follow-up on the proposal — offer to answer questions live.",
      reason: `Proposal sent ${timeAgo(last)} with no activity since.`,
      to: "compose",
    };
  }
  if (daysSince >= 7) {
    return {
      text: "Re-engage with something useful — a case study or new proof point, not a bare 'checking in'.",
      reason: `Last touch was ${timeAgo(last)}; no follow-up is scheduled.`,
      to: "compose",
    };
  }
  if (lead.nextFollowUpAt === undefined && ["contacted", "discovery"].includes(lead.status)) {
    return {
      text: "Schedule the next follow-up so this doesn't go cold.",
      reason: "Contacted recently but no next step is on the calendar.",
      to: "followup",
    };
  }
  if (lead.dealValue === undefined && ["proposal", "interested", "discovery"].includes(lead.status)) {
    return {
      text: "Set the deal value and expected close date — it makes your pipeline forecast real.",
      reason: "This opportunity is deep in the pipeline but has no value attached.",
      to: "deal",
    };
  }
  return null;
}

export function dealHealth(lead: Lead, followUpCount: number): { state: DealHealth; detail: string } {
  const now = Date.now();
  if (["won", "lost"].includes(lead.status)) {
    return { state: "unknown", detail: lead.status === "won" ? "Closed-won" : "Closed-lost" };
  }
  const last = lead.lastContactedAt;
  if (last === undefined) {
    return { state: "attention", detail: "Never contacted" };
  }
  const days = (now - last) / DAY;
  if (days > 10) return { state: "inactive", detail: `No activity for ${Math.round(days)} days` };
  if (days > 5 && lead.nextFollowUpAt === undefined) {
    return { state: "attention", detail: `Quiet ${Math.round(days)} days, nothing scheduled` };
  }
  if (followUpCount === 0 && lead.status !== "new") {
    return { state: "attention", detail: "No follow-up planned" };
  }
  return { state: "healthy", detail: `Active — last touch ${timeAgo(last)}` };
}

// ── Shared label helper ──────────────────────────────────────────────────────
// Canonicalization-aware label helper. Prefer statusLabel() from
// src/lib/leadStatus.ts, which does the same thing for plain status strings.

export function statusLabelOf(status: string): string {
  return statusLabel(canonicalStatus(status));
}

// ── Page-level analytics (former src/lib/analytics.ts, merged §8) ───────────
// Consumed by the Analytics page. All metrics derive from the same
// canonical-stage helpers used by computeGrowthMetrics above, so Dashboard
// and Analytics can never disagree about replies, meetings, or win rates.

export interface FunnelStage {
  key: string;
  label: string;
  count: number;
}

export interface Analytics {
  total: number;
  funnel: FunnelStage[];
  contactRate: number;
  replyRate: number;
  meetingRate: number;
  winRate: number;
  won: number;
  lost: number;
  avgScore: number | null;
  activeCampaigns: number;
  messagesSent: number;
  repliesReceived: number;
  followUpsDue: number;
  topIndustries: { name: string; count: number }[];
}

export function computeAnalytics(
  leads: Lead[],
  messages: Message[],
  campaigns: { status: string }[],
  followUps: { status: string; dueAt: number }[],
): Analytics {
  const total = leads.length;

  // Contacted = ever actually touched: a recorded lastContactedAt OR a stage
  // that only exists after a touch (Qualified and beyond).
  const contacted = leads.filter(
    (l) => l.lastContactedAt !== undefined || isQualified(l.status),
  ).length;

  // Stage-based replied count on canonical stages (legacy values mapped).
  const replied = leads
    .filter((l) => REPLIED_STATUSES.includes(canonicalStatus(l.status)))
    .length;
  const meetings = leads
    .filter((l) => ["proposal", "interested", "won"].includes(canonicalStatus(l.status)))
    .length;
  const won = leads.filter((l) => canonicalStatus(l.status) === "won").length;
  const lost = leads.filter((l) => canonicalStatus(l.status) === "lost").length;

  const scored = leads.filter((l) => l.score !== undefined);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, l) => sum + (l.score ?? 0), 0) / scored.length)
      : null;

  // Funnel over canonical stages, grouping legacy rows into their mapped
  // column so every lead appears exactly once.
  const funnel: FunnelStage[] = LEAD_STATUSES.map((s) => ({
    key: s,
    label: LEAD_STATUS_LABELS[s],
    count: leads.filter((l) => canonicalStatus(l.status) === s).length,
  }));

  const messagesSent = messages.filter((m) => m.direction === "sent").length;
  const repliesReceived = messages.filter((m) => m.direction === "received").length;

  return {
    total,
    funnel,
    contactRate: total ? Math.round((contacted / total) * 100) : 0,
    replyRate: total ? Math.round((replied / total) * 100) : 0,
    meetingRate: total ? Math.round((meetings / total) * 100) : 0,
    winRate: won + lost > 0 ? Math.round((won / (won + lost)) * 100) : 0,
    won,
    lost,
    avgScore,
    activeCampaigns: campaigns.filter((c) => c.status === "active").length,
    messagesSent,
    repliesReceived,
    followUpsDue: followUps.filter(
      (f) => f.status === "pending" && f.dueAt <= Date.now() + 24 * 3600_000,
    ).length,
    topIndustries: Object.entries(
      leads.reduce<Record<string, number>>((acc, lead) => {
        if (lead.industry) {
          const key = lead.industry.trim();
          acc[key] = (acc[key] ?? 0) + 1;
        }
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([name, count]) => ({ name, count })),
  };
}
