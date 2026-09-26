import type { Doc } from "@/convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import {
  LEAD_STATUS_LABELS,
  PIPELINE_VALUE_STATUSES,
  defaultProbability,
  isQualified,
  weightedValue,
} from "@/lib/leadStatus";

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

  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
  const inPipeline = leads.filter((l) => PIPELINE_VALUE_STATUSES.includes(l.status));
  const won = leads.filter((l) => l.status === "won");
  const lost = leads.filter((l) => l.status === "lost");

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
    meetingsBooked: leads.filter((l) => ["proposal", "interested", "won"].includes(l.status)).length,
    overdueFollowUps: followUps.filter((f) => f.status === "pending" && f.dueAt < now).length,
    dueTodayFollowUps: followUps.filter(
      (f) => f.status === "pending" && f.dueAt >= now && f.dueAt <= endOfDay.getTime(),
    ).length,
    unreadReplies: messages.filter((m) => m.direction === "received" && !m.readAt).length,
    activeCampaigns: campaigns.filter((c) => c.status === "active").length,
    proposalsOut: leads.filter((l) => l.status === "proposal").length,
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
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));
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
  const open = leads.filter((l) => !["won", "lost"].includes(l.status));

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
    (l) => l.status === "proposal" && l.lastContactedAt !== undefined && now - l.lastContactedAt > 4 * DAY,
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
    actions.push({
      id: `fu-${f._id}`,
      title: `Follow up with ${leadName(f.leadId)}${f.note ? ` — ${f.note}` : ""}`,
      to: `/leads/${f.leadId}`,
      kind: "followup",
      priority: 0,
    });
  }
  if (metrics.unreadReplies > 0) {
    actions.push({
      id: "inbox",
      title: `Answer ${metrics.unreadReplies} waiting repl${metrics.unreadReplies === 1 ? "y" : "ies"}`,
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
      to: `/leads/${f.leadId}`,
      kind: "followup",
      priority: 2,
    });
  }
  if (metrics.proposalsOut >= 2) {
    actions.push({
      id: "proposals",
      title: `Check on ${metrics.proposalsOut} open proposals`,
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

export function statusLabelOf(status: string): string {
  return LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status;
}
