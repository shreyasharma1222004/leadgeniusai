import type { Doc } from "@/convex/_generated/dataModel";
import { LEAD_STATUS_LABELS, type LeadStatus } from "@/lib/leadStatus";
import { timeAgo } from "@/lib/format";

type Lead = Doc<"leads">;
type Message = Doc<"messages">;
type FollowUpRow = { _id: string; leadId: string; dueAt: number; status: string; note?: string };
type CampaignRow = { _id: string; name: string; status: string };

export interface AssistantReply {
  intent: string;
  text: string;
  bullets: string[];
  leadIds: string[];
}

/**
 * Business context (Phase 1 §7) — profile + goals the Copilot can reason
 * over. All values come from the caller's own workspace; nothing invented.
 */
export interface CopilotContext {
  businessName?: string;
  industry?: string;
  businessModel?: string;
  products?: string;
  targetGeography?: string;
  primaryChallenge?: string;
  growthGoal?: string;
  goals: {
    name: string;
    period: string;
    current: number | null;
    targetValue?: number;
    unit: "money" | "count" | "percent";
    formatted: string | null;
    progress: number | null;
    unavailableReason?: string;
  }[];
}

/**
 * Rule-based assistant brain. Answers real questions from the workspace data —
 * no fabricated facts, every claim is backed by the numbers it computed.
 */
export function askAssistant(
  question: string,
  leads: Lead[],
  messages: Message[],
  followUps: FollowUpRow[],
  campaigns: CampaignRow[],
  context?: CopilotContext,
): AssistantReply {
  const q = question.toLowerCase().trim();

  const leadIds = (list: Lead[]) => list.slice(0, 8).map((l) => l._id);

  // Hot / best leads
  if (/\b(hot|best|top|priority|focus|high score|strongest)\b/.test(q)) {
    const hot = leads
      .filter((l) => !["won", "lost"].includes(l.status))
      .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
      .slice(0, 5);
    return {
      intent: "hot-leads",
      text:
        hot.length > 0
          ? `Your ${hot.length} highest-scoring open leads right now:`
          : "No open leads yet — add or import some, then ask me again.",
      bullets: hot.map(
        (l) =>
          `${l.name}${l.company ? ` (${l.company})` : ""} — score ${l.score ?? "—"}/${100}, status ${LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status}`,
      ),
      leadIds: leadIds(hot),
    };
  }

  // Due / overdue follow-ups
  if (/\b(follow.?ups?|due|overdue|today|this week|remind)\b/.test(q)) {
    const now = Date.now();
    const overdue = followUps.filter((f) => f.status === "pending" && f.dueAt < now);
    const dueSoon = followUps.filter(
      (f) => f.status === "pending" && f.dueAt >= now && f.dueAt <= now + 3 * 86400_000,
    );
    const nameOf = (leadId: string) => leads.find((l) => l._id === leadId)?.name ?? "a lead";
    return {
      intent: "followups",
      text:
        overdue.length + dueSoon.length === 0
          ? "Nothing pending in the next 3 days. The money is in the follow-up — schedule a few."
          : `${overdue.length} overdue and ${dueSoon.length} due within 3 days:`,
      bullets: [
        ...overdue.map(
          (f) => `OVERDUE: ${nameOf(f.leadId)} — ${f.note || "follow up"} (${timeAgo(f.dueAt)})`,
        ),
        ...dueSoon.map((f) => `${nameOf(f.leadId)} — ${f.note || "follow up"} (due ${timeAgo(f.dueAt)})`),
      ].slice(0, 8),
      leadIds: [...overdue, ...dueSoon]
        .map((f) => f.leadId)
        .filter((id, i, arr) => arr.indexOf(id) === i)
        .slice(0, 8),
    };
  }

  // Pipeline status summary
  if (/\b(pipeline|summary|overview|status|how many|progress)\b/.test(q)) {
    const counts = new Map<string, number>();
    for (const l of leads) counts.set(l.status, (counts.get(l.status) ?? 0) + 1);
    const lines = Array.from(counts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([status, count]) => `${LEAD_STATUS_LABELS[status as LeadStatus] ?? status}: ${count}`);
    const won = counts.get("won") ?? 0;
    const contacted = leads.filter((l) => l.lastContactedAt).length;
    return {
      intent: "pipeline",
      text: leads.length
        ? `You have ${leads.length} leads. ${contacted} contacted, ${won} closed-won. Breakdown:`
        : "Your pipeline is empty — import a CSV or add your first lead.",
      bullets: lines,
      leadIds: [],
    };
  }

  // Replies / inbox
  if (/\b(repl|inbox|unread|message|email).*/.test(q)) {
    const received = messages.filter((m) => m.direction === "received");
    const unread = received.filter((m) => !m.readAt);
    const nameOf = (leadId: string) => leads.find((l) => l._id === leadId)?.name ?? "a lead";
    return {
      intent: "replies",
      text:
        received.length === 0
          ? "No replies logged yet. When leads respond, log them from the lead page — they'll show here."
          : `${received.length} repl${received.length === 1 ? "y" : "ies"} logged, ${unread.length} unread:`,
      bullets: received
        .slice(0, 6)
        .map((m) => `${unread.includes(m) ? "● " : ""}${nameOf(m.leadId)}: "${m.body.slice(0, 80)}${m.body.length > 80 ? "…" : ""}"`),
      leadIds: received.slice(0, 6).map((m) => m.leadId),
    };
  }

  // Campaigns
  if (/\b(campaigns?|batch|blast|send out)\b/.test(q)) {
    if (campaigns.length === 0) {
      return {
        intent: "campaigns",
        text: "No campaigns yet. Create one from the Campaigns page to send a message to many leads at once.",
        bullets: [],
        leadIds: [],
      };
    }
    const active = campaigns.filter((c) => c.status === "active");
    return {
      intent: "campaigns",
      text: `${campaigns.length} campaign${campaigns.length === 1 ? "" : "s"} total, ${active.length} active:`,
      bullets: campaigns
        .slice(0, 6)
        .map((c) => `${c.name} — ${c.status}${c.status === "active" ? " (send pending recipients from the campaign page)" : ""}`),
      leadIds: [],
    };
  }

  // Stalled leads
  if (/\b(stalled?|cold|quiet|ghost|no repl(y|ies)|not responded|neglect)\b/.test(q)) {
    const now = Date.now();
    const stalled = leads
      .filter(
        (l) =>
          !["won", "lost", "new"].includes(l.status) &&
          l.lastContactedAt !== undefined &&
          now - l.lastContactedAt > 7 * 86400_000,
      )
      .sort((a, b) => (a.lastContactedAt ?? 0) - (b.lastContactedAt ?? 0))
      .slice(0, 6);
    return {
      intent: "stalled",
      text:
        stalled.length > 0
          ? `${stalled.length} lead${stalled.length === 1 ? " is" : "s are"} going cold — contacted over a week ago with no next step:`
          : "No stalled leads — everything contacted recently is either fresh or has a follow-up scheduled.",
      bullets: stalled.map(
        (l) => `${l.name}${l.company ? ` (${l.company})` : ""} — last touch ${timeAgo(l.lastContactedAt)}`,
      ),
      leadIds: leadIds(stalled),
    };
  }

  // Industry question
  const industryMatch = leads
    .map((l) => l.industry)
    .filter((i): i is string => Boolean(i))
    .find((i) => q.includes(i.toLowerCase()));
  if (industryMatch) {
    const matches = leads.filter((l) => l.industry === industryMatch);
    return {
      intent: "industry",
      text: `${matches.length} lead${matches.length === 1 ? "" : "s"} in ${industryMatch}:`,
      bullets: matches
        .slice(0, 6)
        .map((l) => `${l.name}${l.company ? ` (${l.company})` : ""} — ${LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status}`),
      leadIds: leadIds(matches),
    };
  }

  // Business copilot: "what should I work on" → today's plan (§27)
  if (/\b(work on|what should i|priorit|plan|today|next step)\b/.test(q)) {
    const now = Date.now();
    const overdue = followUps.filter((f) => f.status === "pending" && f.dueAt < now);
    const unread = messages.filter((m) => m.direction === "received" && !m.readAt);
    const proposalsOut = leads.filter((l) => l.status === "proposal").length;
    const fresh = leads.filter((l) => l.status === "new");
    const lines: string[] = [];
    if (overdue.length > 0)
      lines.push(`1. Follow up with ${leads.find((l) => l._id === overdue[0].leadId)?.name ?? "a lead"} — overdue follow-up`);
    if (unread.length > 0) lines.push(`${lines.length + 1}. Answer ${unread.length} waiting repl${unread.length === 1 ? "y" : "ies"}`);
    if (proposalsOut > 0) lines.push(`${lines.length + 1}. Check on ${proposalsOut} open proposal${proposalsOut === 1 ? "" : "s"}`);
    if (fresh.length >= 3) lines.push(`${lines.length + 1}. Send first outreach to ${Math.min(fresh.length, 3)} new leads`);
    if (lines.length === 0)
      return {
        intent: "plan",
        text: "Nothing urgent — your follow-ups are on schedule and replies are read.",
        bullets: leads.length === 0 ? ["Your workspace is empty. Import leads to get a plan."] : ["Good day to add new leads or start a campaign."],
        leadIds: [],
      };
    return {
      intent: "plan",
      text: "Today's plan, highest impact first:",
      bullets: lines,
      leadIds: overdue.slice(0, 2).map((f) => f.leadId),
    };
  }

  // Hottest opportunities by deal value (§27)
  if (/\b(opportunit|deal value|biggest deal|highest.value|worth the most)\b/.test(q)) {
    const valued = leads
      .filter((l) => !["won", "lost"].includes(l.status) && l.dealValue !== undefined)
      .sort((a, b) => (b.dealValue ?? 0) - (a.dealValue ?? 0))
      .slice(0, 5);
    if (valued.length === 0)
      return {
        intent: "deals",
        text: "No deal values set yet — add values in the Pipeline view and I can rank your opportunities.",
        bullets: [],
        leadIds: [],
      };
    return {
      intent: "deals",
      text: "Your most valuable open opportunities:",
      bullets: valued.map(
        (l) =>
          `${l.name}${l.company ? ` (${l.company})` : ""} — $${(l.dealValue ?? 0).toLocaleString()} · ${LEAD_STATUS_LABELS[l.status as LeadStatus] ?? l.status}`,
      ),
      leadIds: valued.map((l) => l._id),
    };
  }

  // Won / revenue question (§27)
  if (/\b(revenue|won|closed|earn|income)\b/.test(q)) {
    const won = leads.filter((l) => l.status === "won");
    const valued = won.filter((l) => l.dealValue !== undefined);
    const total = valued.reduce((s, l) => s + (l.dealValue ?? 0), 0);
    return {
      intent: "revenue",
      text:
        won.length === 0
          ? "No closed-won deals yet. When you move a lead to Won, the revenue shows up here."
          : valued.length === 0
            ? `${won.length} deal${won.length === 1 ? "" : "s"} won — add deal values in Pipeline to see revenue.`
            : `${won.length} deal${won.length === 1 ? "" : "s"} won, $${total.toLocaleString()} in recorded revenue:`,
      bullets: valued.map((l) => `${l.name} — $${(l.dealValue ?? 0).toLocaleString()}`),
      leadIds: valued.slice(0, 5).map((l) => l._id),
    };
  }

  // ── Business-context intents (Phase 1 §7) ─────────────────────────────

  // Goals / on-track question — grounded in derived goal progress
  if (context && /\b(goal|goals|on track|target|revenue goal|quota)\b/.test(q)) {
    if (context.goals.length === 0) {
      return {
        intent: "goals",
        text: "You haven't set any goals yet.",
        bullets: [
          "Set one on the Business page — revenue, qualified leads, or meetings — and I'll track real progress from your CRM.",
        ],
        leadIds: [],
      };
    }
    const lines = context.goals.map((g) => {
      if (g.current === null) {
        return `${g.name} — ${g.unavailableReason ?? "not measurable from CRM data"}`;
      }
      if (g.progress === null || g.targetValue === undefined) {
        return `${g.name} — currently ${g.formatted} (no target set)`;
      }
      const pct = Math.round(g.progress * 100);
      return `${g.name} — ${g.formatted} of ${g.targetValue.toLocaleString()} (${pct}%) — ${pct >= 100 ? "achieved 🎉" : pct >= 70 ? "on track" : "behind"}`;
    });
    return {
      intent: "goals",
      text: `Goal progress, computed from your CRM${context.businessName ? ` for ${context.businessName}` : ""}:`,
      bullets: lines,
      leadIds: [],
    };
  }

  // Growth blockers — evidence-based from real records + stated challenge
  if (
    context &&
    /\b(block|blocker|blockers|blocking|bottleneck|what.s stopping|what.s holding|holding me back|improve)\b/.test(
      q,
    )
  ) {
    const now = Date.now();
    const lines: string[] = [];
    const noFollowUp = leads.filter(
      (l) =>
        !["won", "lost", "new"].includes(l.status) &&
        l.nextFollowUpAt === undefined &&
        l.lastContactedAt !== undefined,
    ).length;
    const dormant = leads.filter(
      (l) =>
        !["won", "lost", "new"].includes(l.status) &&
        l.lastContactedAt !== undefined &&
        now - l.lastContactedAt > 10 * 86400_000,
    ).length;
    const noValue = leads.filter(
      (l) =>
        ["proposal", "interested", "discovery"].includes(l.status) && l.dealValue === undefined,
    ).length;
    if (context.primaryChallenge) {
      lines.push(`Your stated challenge: “${context.primaryChallenge}”.`);
    }
    if (noFollowUp > 0) lines.push(`${noFollowUp} engaged lead${noFollowUp === 1 ? " has" : "s have"} no follow-up scheduled — momentum leaks there.`);
    if (dormant > 0) lines.push(`${dormant} lead${dormant === 1 ? " has" : "s have"} gone quiet for 10+ days.`);
    if (noValue > 0) lines.push(`${noValue} deep-pipeline deal${noValue === 1 ? "" : "s"} have no value attached — forecast stays blind until they're dated and valued.`);
    if (lines.length === 0) {
      return {
        intent: "blockers",
        text: "Nothing is visibly blocking growth right now.",
        bullets: [
          leads.length < 5
            ? "With fewer than 5 leads the pipeline itself is the constraint — top of funnel needs volume first."
            : "Follow-ups are scheduled, replies are handled, and deals are valued. A campaign or new lead batch is the next lever.",
        ],
        leadIds: [],
      };
    }
    return {
      intent: "blockers",
      text: "Based on your records, these are the visible bottlenecks:",
      bullets: lines,
      leadIds: [],
    };
  }

  // Business context question
  if (context && /\b(my business|what do i sell|who do i sell|my industry|my niche|icp|target market)\b/.test(q)) {
    const parts = [
      context.businessName,
      context.industry,
      context.products,
      context.targetGeography ? `sells to ${context.targetGeography}` : undefined,
    ].filter(Boolean);
    return {
      intent: "business-context",
      text: parts.length
        ? `Here's the business context you've saved:`
        : "No business profile saved yet — set it up on the Business page so I can tailor answers.",
      bullets: parts.length ? parts.map((p) => String(p)) : [],
      leadIds: [],
    };
  }

  // Default: quick overview + hint
  const open = leads.filter((l) => !["won", "lost"].includes(l.status)).length;
  const unread = messages.filter((m) => m.direction === "received" && !m.readAt).length;
  const due = followUps.filter((f) => f.status === "pending" && f.dueAt <= Date.now() + 86400_000).length;
  return {
    intent: "fallback",
    text: "Here's where your pipeline stands right now:",
    bullets: [
      `${leads.length} leads total, ${open} still open`,
      `${unread} unread repl${unread === 1 ? "y" : "ies"}`,
      `${due} follow-up${due === 1 ? "" : "s"} due in 24h`,
      "Try asking: “my hottest leads”, “what's due today”, “any stalled leads”, “pipeline summary”",
    ],
    leadIds: [],
  };
}
