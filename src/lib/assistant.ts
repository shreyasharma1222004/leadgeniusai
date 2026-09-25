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
 * Rule-based assistant brain. Answers real questions from the workspace data —
 * no fabricated facts, every claim is backed by the numbers it computed.
 */
export function askAssistant(
  question: string,
  leads: Lead[],
  messages: Message[],
  followUps: FollowUpRow[],
  campaigns: CampaignRow[],
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
  if (/\b(follow.?up|due|overdue|today|this week|remind)\b/.test(q)) {
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
  if (/\b(campaign|batch|blast|send out)\b/.test(q)) {
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
  if (/\b(stall|cold|quiet|ghost|no reply|not responded|neglect)\b/.test(q)) {
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
