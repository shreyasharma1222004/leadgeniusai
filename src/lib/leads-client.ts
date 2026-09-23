"use client";

/**
 * AI service abstraction (client-side).
 *
 * The whole app talks to `analyzeLead` through this one interface, so the
 * provider can be swapped without touching product code. If OPENAI_API_KEY
 * is configured in the environment, we call the OpenAI Chat Completions API
 * directly from the browser; otherwise we return `ok: false` and the UI
 * falls back to the built-in deterministic heuristic analysis.
 */

export interface AnalyzeLeadInput {
  name: string;
  jobTitle?: string;
  company?: string;
  website?: string;
  industry?: string;
  location?: string;
  notes?: string;
}

export interface LeadAnalysis {
  summary: string;
  industry: string;
  painPoints: string[];
  signals: string[];
  approach: string;
  score: number;
  scoreBreakdown: { label: string; value: number }[];
  /** Where this analysis came from. */
  provider: "openai" | "heuristic";
}

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

function buildPrompt(lead: AnalyzeLeadInput): string {
  const parts = [
    lead.name,
    lead.jobTitle,
    lead.company,
    lead.website,
    lead.industry,
    lead.location,
    lead.notes,
  ]
    .filter(Boolean)
    .join(" | ");
  return [
    "You are a B2B sales research analyst. Based ONLY on the information provided,",
    "produce a short research brief a freelancer could use before outreach.",
    "Never fabricate facts — if information is missing, say what is unknown.",
    "Respond with strict JSON matching this shape:",
    '{"summary": string, "industry": string, "painPoints": string[3], "signals": string[3], "approach": string,',
    ' "score": number(0-100), "scoreBreakdown": [{"label": "Company fit", "value": number}, {"label": "Industry fit", "value": number}, {"label": "Engagement", "value": number}, {"label": "Opportunity signals", "value": number}]}',
    "",
    `Lead: ${parts}`,
  ].join("\n");
}

export async function analyzeLead(lead: AnalyzeLeadInput): Promise<LeadAnalysis> {
  const key = import.meta.env.VITE_OPENAI_API_KEY;
  if (key) {
    try {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          response_format: { type: "json_object" },
          messages: [{ role: "user", content: buildPrompt(lead) }],
          temperature: 0.4,
          max_tokens: 700,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        const parsed = parseAnalysis(data?.choices?.[0]?.message?.content ?? "");
        if (parsed) return { ...parsed, provider: "openai" };
      }
    } catch {
      // fall through to heuristic
    }
  }
  return { ...heuristicAnalysis(lead), provider: "heuristic" };
}

function parseAnalysis(raw: string): Omit<LeadAnalysis, "provider"> | null {
  try {
    const obj = JSON.parse(raw) as Record<string, unknown>;
    const asStringArray = (value: unknown, fallback: string[]): string[] =>
      Array.isArray(value) && value.every((v) => typeof v === "string")
        ? (value as string[])
        : fallback;
    const summary = typeof obj.summary === "string" ? obj.summary : "";
    if (!summary) return null;
    const scoreRaw = typeof obj.score === "number" ? obj.score : 60;
    return {
      summary: summary.slice(0, 400),
      industry: typeof obj.industry === "string" ? obj.industry : "",
      painPoints: asStringArray(obj.painPoints, []).slice(0, 5),
      signals: asStringArray(obj.signals, []).slice(0, 5),
      approach: typeof obj.approach === "string" ? obj.approach : "",
      score: Math.max(0, Math.min(100, Math.round(scoreRaw))),
      scoreBreakdown: Array.isArray(obj.scoreBreakdown)
        ? (obj.scoreBreakdown as { label: string; value: number }[])
            .filter(
              (d) => typeof d?.label === "string" && typeof d?.value === "number",
            )
            .slice(0, 4)
        : [],
    };
  } catch {
    return null;
  }
}

// ── Deterministic fallback ────────────────────────────────────────────────
// Estimates a research brief from the data you entered — never invents facts.

export function heuristicAnalysis(lead: AnalyzeLeadInput): Omit<LeadAnalysis, "provider"> {
  const title = lead.jobTitle?.toLowerCase() ?? "";
  const decisionMaker =
    /founder|ceo|owner|director|vp|president|head|chief|partner/.test(title);
  const hasCompany = Boolean(lead.company?.trim());
  const hasWebsite = Boolean(lead.website?.trim());
  const hasEmail = false; // not part of analysis input
  const hasNotes = Boolean(lead.notes?.trim());
  const industry =
    lead.industry?.trim() || (hasCompany ? "to be confirmed" : "unknown");

  const dataDepth =
    (hasCompany ? 1 : 0) + (hasWebsite ? 1 : 0) + (hasNotes ? 1 : 0) + (lead.jobTitle ? 1 : 0);

  const companyFit = Math.min(95, 40 + dataDepth * 12 + (decisionMaker ? 10 : 0));
  const industryFit = hasIndustryHint(industry) ? 80 : 55;
  const engagement = hasNotes ? 75 : 50;
  const signalsScore = Math.min(90, 35 + dataDepth * 14);

  const score = Math.round(
    companyFit * 0.3 + industryFit * 0.25 + engagement * 0.25 + signalsScore * 0.2,
  );

  const unknownCompany = !hasCompany;

  return {
    summary: unknownCompany
      ? `${lead.name} — role${lead.jobTitle ? ` (${lead.jobTitle})` : " unknown"}. Company details were not provided, so firmographics are unknown.`
      : `${lead.name}${lead.jobTitle ? `, ${lead.jobTitle}` : ""} at ${lead.company}. ${hasWebsite ? `Web presence listed (${lead.website}).` : "No website on file."} ${hasNotes ? `Notes: ${lead.notes}` : ""}`,
    industry,
    painPoints: [
      hasNotes
        ? "Pain points are estimated from your notes — verify before outreach"
        : "No notes yet — add context for sharper pain-point estimates",
      hasWebsite
        ? "Public web presence on file — review it before first contact"
        : "No website on file — research their web presence manually",
      decisionMaker
        ? "Decision-maker level contact — likely focused on outcomes over process"
        : "Role suggests they may not own the buying decision — confirm authority",
    ],
    signals: [
      decisionMaker
        ? "Senior role captured — good entry point for first conversation"
        : "Contact captured without a decision-maker title",
      hasWebsite ? "Website available for review" : "No website captured yet",
      hasNotes ? "Manual context added by you" : "No manual context yet",
    ],
    approach: decisionMaker
      ? `Open with a short, specific observation about ${lead.company ?? "their company"} and one measurable outcome you can own.`
      : `Confirm their role in purchasing, then tailor the pitch — keep the first message short.`,
    score,
    scoreBreakdown: [
      { label: "Company fit", value: companyFit },
      { label: "Industry fit", value: industryFit },
      { label: "Engagement", value: engagement },
      { label: "Opportunity signals", value: signalsScore },
    ],
  };
}

function hasIndustryHint(industry: string): boolean {
  return industry.length > 2 && industry !== "unknown" && industry !== "to be confirmed";
}
