import type { Doc } from "@/convex/_generated/dataModel";

type Lead = Doc<"leads">;

export const OUTREACH_CHANNELS = ["email", "linkedin"] as const;
export type OutreachChannel = (typeof OUTREACH_CHANNELS)[number];

export const CHANNEL_LABELS: Record<OutreachChannel, string> = {
  email: "Email",
  linkedin: "LinkedIn",
};

/** Tokens available in templates and generated drafts. */
export function templateTokens(lead: Partial<Lead> | null): Record<string, string> {
  const name = lead?.name ?? "";
  return {
    first_name: name.split(/\s+/)[0] || "there",
    full_name: name || "there",
    company: lead?.company || "your company",
    job_title: lead?.jobTitle || "your role",
    industry: lead?.industry || "your industry",
    location: lead?.location || "your region",
    website: lead?.website || "",
    sender_name: "…",
  };
}

/** Replace {{token}} placeholders. Unknown tokens resolve to empty string. */
export function renderTemplate(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-zA-Z_]+)\s*\}\}/g, (_match, key: string) => tokens[key] ?? "");
}

const EMAIL_SUBJECTS = [
  (tokens: Record<string, string>) => `Quick idea for ${tokens.company}`,
  (tokens: Record<string, string>) => `${tokens.company} × your ${tokens.job_title.toLowerCase()} goals`,
  (tokens: Record<string, string>) => `A thought on ${tokens.company}'s growth`,
];

/** Drafts a personalized opening message from the lead's intelligence data. */
export function draftOutreach(
  lead: Partial<Lead>,
  channel: OutreachChannel,
): { subject: string; body: string } {
  const tokens = templateTokens(lead);
  const pain = lead.painPoints?.[0] ?? "";
  const signal = lead.signals?.[0] ?? "";
  const approach = lead.approach ?? "";
  const company = tokens.company;

  const subject = EMAIL_SUBJECTS[Math.floor(Math.random() * EMAIL_SUBJECTS.length)](tokens);

  if (channel === "linkedin") {
    const body = [
      `Hi ${tokens.first_name},`,
      "",
      signal
        ? `Saw ${signal.replace(/\.$/, "").toLowerCase()} — great context for what's next at ${company}.`
        : `I've been following ${company}'s work.`,
      "",
      pain
        ? `Most ${tokens.industry} teams I talk to run into exactly this: ${pain.replace(/\.$/, "").toLowerCase()}.`
        : `I help ${tokens.industry} teams ship faster without growing headcount.`,
      "",
      "Open to a short chat this week? No deck, no pitch — just a concrete idea.",
      "",
      "— Sent from DealFlow AI",
    ].join("\n");
    return { subject: "", body };
  }

  const body = [
    `Hi ${tokens.first_name},`,
    "",
    signal
      ? `I came across ${company} recently — ${signal.replace(/\.$/, "").toLowerCase()} caught my attention.`
      : `I came across ${company} recently and wanted to reach out.`,
    "",
    pain
      ? `One thing that stood out: ${pain.replace(/\.$/, "").toLowerCase()}. That's usually a sign the current setup is leaving something on the table.`
      : `Teams like ${company} usually hit a point where manual work starts capping growth.`,
    "",
    approach
      ? approach
      : `I have a specific idea for how to fix that within two weeks — worth a look?`,
    "",
    "If it resonates, I'll send over a short outline. If not, I'll leave you be.",
    "",
    `Best,`,
    `{{sender_name}}`,
  ].join("\n");
  return { subject, body };
}

/**
 * Practical habits that keep outreach out of recipients' spam folders.
 * Gmail SMTP delivers with valid SPF/DKIM, so placement is decided by
 * sender reputation + how human the message looks — these are the levers.
 */
export const DELIVERABILITY_TIPS = [
  "Warm up: start at 5–10 emails a day and ramp slowly — sudden volume is the #1 spam trigger.",
  "No links in the first email. Links (especially shortened ones) scream cold blast.",
  "No attachments or images either — plain text reads as a person, not a campaign.",
  "Make the first line about THEM — a real detail about their company — never about you.",
  "Ask for any reply, even 'not interested'. Replies are the strongest not-spam signal there is.",
  "If someone finds you in spam: ask them to tap 'Not spam' and reply once — their inbox learns and your next email lands.",
  "Stay under ~20 sends a day while your sender reputation grows; consistency beats bursts.",
  "Personalize every send — identical bodies sent in bulk get filtered as a group.",
] as const;

/** Suggested next-step copy for outreach flows. */
export const OUTREACH_TIPS = [
  "Keep it under 120 words — short messages get more replies.",
  "Reference one specific detail about their company, not a template.",
  "End with a low-friction ask (a yes/no question works best).",
  "Follow up in 3–4 days if there's no reply — most replies come after the first bump.",
] as const;

// ── CSV export ─────────────────────────────────────────────────────────────

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

/** Export leads as RFC-4180 CSV text for download. */
export function leadsToCsv(leads: Lead[]): string {
  const headers = [
    "Name",
    "Job title",
    "Company",
    "Email",
    "Phone",
    "Website",
    "Industry",
    "Location",
    "LinkedIn",
    "Status",
    "Score",
    "Last contacted",
    "Next follow-up",
  ];
  const lines = [headers.join(",")];
  for (const lead of leads) {
    lines.push(
      [
        lead.name,
        lead.jobTitle ?? "",
        lead.company ?? "",
        lead.email ?? "",
        lead.phone ?? "",
        lead.website ?? "",
        lead.industry ?? "",
        lead.location ?? "",
        lead.linkedin ?? "",
        lead.status,
        lead.score !== undefined ? String(lead.score) : "",
        lead.lastContactedAt ? new Date(lead.lastContactedAt).toISOString() : "",
        lead.nextFollowUpAt ? new Date(lead.nextFollowUpAt).toISOString() : "",
      ]
        .map(csvEscape)
        .join(","),
    );
  }
  return lines.join("\n");
}

/** Trigger a client-side download of a text file. */
export function downloadTextFile(filename: string, content: string, mime = "text/csv"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
