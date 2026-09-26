/**
 * AI service abstraction (client-side).
 *
 * Lead analysis runs server-side: `useAnalyzeLead()` wraps the Convex action
 * in src/convex/ai.ts, which reads process.env.OPENAI_API_KEY at request
 * time. No API key exists in this module — nothing AI-related is exposed to
 * the browser. When the action returns null (no key configured, provider
 * error, or unparseable output) we fall back to the built-in deterministic
 * heuristic analysis, so the product keeps working with zero external calls.
 */
import { api } from "@/convex/_generated/api";
import { useAction } from "convex/react";

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

/**
 * React hook returning an analyze function. Server-side GPT brief when
 * OPENAI_API_KEY is configured on the Convex deployment, otherwise the local
 * heuristic estimate. Never throws for provider issues — failures degrade to
 * the heuristic so the UI flow always completes.
 */
export function useAnalyzeLead() {
  const runAnalysis = useAction(api.ai.analyzeLead);

  return async (lead: AnalyzeLeadInput): Promise<LeadAnalysis> => {
    try {
      const result = await runAnalysis(lead);
      if (result) return result;
    } catch {
      // fall through to heuristic
    }
    return heuristicAnalysis(lead);
  };
}

// ── Deterministic fallback ────────────────────────────────────────────────
// Estimates a research brief from the data you entered — never invents facts.

export function heuristicAnalysis(lead: AnalyzeLeadInput): Omit<LeadAnalysis, "provider"> & { provider: "heuristic" } {
  const title = lead.jobTitle?.toLowerCase() ?? "";
  const decisionMaker =
    /founder|ceo|owner|director|vp|president|head|chief|partner/.test(title);
  const hasCompany = Boolean(lead.company?.trim());
  const hasWebsite = Boolean(lead.website?.trim());
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
    provider: "heuristic",
  };
}

function hasIndustryHint(industry: string): boolean {
  return industry.length > 2 && industry !== "unknown" && industry !== "to be confirmed";
}

// ── Lead Research: prospect suggestions ───────────────────────────────────

export interface ProspectSuggestion {
  name: string;
  jobTitle: string;
  company: string;
  industry: string;
  location: string;
  why: string;
}

const ARCHETYPES: { titles: string[]; companyNouns: string[]; industries: string[]; why: string }[] = [
  {
    titles: ["Founder", "CEO", "Managing Director"],
    companyNouns: ["Studio", "Collective", "Works", "Partners"],
    industries: ["Design", "Marketing", "Consulting", "SaaS", "E-commerce", "Recruiting"],
    why: "Owner-level contact — can say yes without a committee",
  },
  {
    titles: ["Head of Growth", "VP Sales", "Marketing Lead"],
    companyNouns: ["Labs", "Digital", "Commerce", "Systems"],
    industries: ["SaaS", "E-commerce", "Marketing", "Logistics", "Fintech", "Healthcare"],
    why: "Owns pipeline numbers — feels the pain you fix every quarter",
  },
  {
    titles: ["Operations Lead", "COO", "Delivery Manager"],
    companyNouns: ["Group", "Solutions", "Ventures", "Consulting"],
    industries: ["Consulting", "Logistics", "Professional Services", "Manufacturing", "Real Estate"],
    why: "Runs the processes that slow teams down — quick to spot the win",
  },
  {
    titles: ["Creative Director", "Managing Partner", "Principal"],
    companyNouns: ["Agency", "Practice", "Boutique", "Collective"],
    industries: ["Design", "Advertising", "Architecture", "Media", "Events"],
    why: "Small team, high project value, usually no dedicated sales ops",
  },
];

const CITIES = [
  "Austin, TX", "London, UK", "Berlin, DE", "Toronto, CA", "Amsterdam, NL",
  "Sydney, AU", "Singapore, SG", "Dubai, AE", "Lisbon, PT", "Chicago, IL",
];

const FIRST_NAMES = [
  "Ava", "Noah", "Mia", "Leo", "Isla", "Omar", "Nina", "Felix",
  "Zara", "Hugo", "Lena", "Marco", "Priya", "Jonas", "Elena", "Samir",
];

const LAST_NAMES = [
  "Carter", "Novak", "Bennett", "Okafor", "Lindqvist", "Haddad", "Moreau",
  "Tanaka", "Silva", "Kowalski", "Fischer", "Naidu", "Berg", "Costa",
];

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

/**
 * Suggest prospect archetypes for Lead Research. These are starting points to
 * verify and research — not fabricated real companies.
 */
export function generateProspectSuggestions(
  existingIndustries: string[],
  count = 6,
): ProspectSuggestion[] {
  const suggestions: ProspectSuggestion[] = [];
  const industries = [
    ...new Set([...existingIndustries.filter(Boolean), ...ARCHETYPES[0].industries]),
  ];
  for (let i = 0; i < count; i++) {
    const archetype = ARCHETYPES[i % ARCHETYPES.length];
    const industry = industries[Math.floor(i / ARCHETYPES.length) % industries.length];
    suggestions.push({
      name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`, 
      jobTitle: pick(archetype.titles),
      company: `${industry.split(/\s|-/)[0]} ${pick(archetype.companyNouns)}`,
      industry,
      location: pick(CITIES),
      why: archetype.why,
    });
  }
  return suggestions;
}
