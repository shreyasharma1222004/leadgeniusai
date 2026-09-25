import type { Doc } from "@/convex/_generated/dataModel";
import { LEAD_STATUSES, LEAD_STATUS_LABELS } from "@/lib/leadStatus";

type Lead = Doc<"leads">;
type Message = Doc<"messages">;

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
  const contacted = leads.filter((l) => l.lastContactedAt !== undefined).length;
  const replied = leads.filter((l) =>
    ["replied", "interested", "meeting", "won"].includes(l.status),
  ).length;
  const meetings = leads.filter((l) => ["meeting", "won"].includes(l.status)).length;
  const won = leads.filter((l) => l.status === "won").length;
  const lost = leads.filter((l) => l.status === "lost").length;

  const scored = leads.filter((l) => l.score !== undefined);
  const avgScore =
    scored.length > 0
      ? Math.round(scored.reduce((sum, l) => sum + (l.score ?? 0), 0) / scored.length)
      : null;

  const funnel: FunnelStage[] = LEAD_STATUSES.map((s) => ({
    key: s,
    label: LEAD_STATUS_LABELS[s],
    count: leads.filter((l) => l.status === s).length,
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
