"use node";

import { getAuthUserId } from "@convex-dev/auth/server";
import { action } from "./_generated/server";
import { v } from "convex/values";

/**
 * Server-side lead analysis (OpenAI).
 *
 * The API key lives ONLY in Convex environment variables (OPENAI_API_KEY) and
 * is read here at request time — it is never compiled into the frontend
 * bundle. If the key is missing or the call fails, the action returns null
 * and the client falls back to the deterministic heuristic estimator, so the
 * product keeps working with zero external calls.
 */

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";

const leadInput = {
  name: v.string(),
  jobTitle: v.optional(v.string()),
  company: v.optional(v.string()),
  website: v.optional(v.string()),
  industry: v.optional(v.string()),
  location: v.optional(v.string()),
  notes: v.optional(v.string()),
};

export type LeadAnalysisResult = {
  summary: string;
  industry: string;
  painPoints: string[];
  signals: string[];
  approach: string;
  score: number;
  scoreBreakdown: { label: string; value: number }[];
  provider: "openai";
};

function buildPrompt(lead: {
  name: string;
  jobTitle?: string;
  company?: string;
  website?: string;
  industry?: string;
  location?: string;
  notes?: string;
}): string {
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

/** Validate + clamp the model output. Anything malformed → null. */
function parseAnalysis(raw: string): Omit<LeadAnalysisResult, "provider"> | null {
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

/**
 * Analyze one lead with GPT-4o-mini. Returns the analysis, or null when no
 * key is configured or the call fails — the client then uses its local
 * heuristic estimate. Authenticated callers only.
 */
export const analyzeLead = action({
  args: leadInput,
  handler: async (ctx, lead): Promise<LeadAnalysisResult | null> => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) {
      throw new Error("You need to sign in to do that.");
    }

    const key = process.env.OPENAI_API_KEY;
    if (!key) return null;

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
      if (!res.ok) return null;
      const data = (await res.json()) as {
        choices?: { message?: { content?: string } }[];
      };
      const parsed = parseAnalysis(data?.choices?.[0]?.message?.content ?? "");
      if (!parsed) return null;
      return { ...parsed, provider: "openai" };
    } catch {
      return null;
    }
  },
});
