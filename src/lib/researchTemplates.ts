/**
 * Lead Research content — production hardening §2.
 *
 * Everything here is DESCRIPTIVE: buyer archetypes, ICP examples, market-research
 * templates and research prompts. No fictional people, no fictional companies, no
 * invented contact data. Nothing here creates CRM records or claims external
 * prospect discovery — that requires a real data-source integration (e.g. a B2B
 * contact-data provider), which is not connected today.
 *
 * archetypes:      reusable buyer patterns (roles + why they buy) — not people
 * icpExamples:     example industry/segment profiles to aim research at
 * researchTemplates: copy-ready checklists for verifying a real company
 * researchPrompts: questions/prompts for digging into a segment or company
 */

export interface ProspectArchetype {
  id: string;
  title: string;
  /** The buyer pattern — a role and buying situation, never a named person. */
  rolePattern: string;
  industries: string[];
  why: string;
  whatToLookFor: string[];
}

export interface IcpExample {
  id: string;
  segment: string;
  description: string;
  sizeHints: string[];
  buyingTriggers: string[];
}

export interface ResearchTemplate {
  id: string;
  title: string;
  steps: string[];
}

export interface ResearchPrompt {
  id: string;
  title: string;
  prompt: string;
  useFor: string;
}

export const PROSPECT_ARCHETYPES: ProspectArchetype[] = [
  {
    id: "owner-operator",
    title: "Owner-operator",
    rolePattern: "Founder / CEO / Managing Director at a small services business",
    industries: ["Design", "Marketing", "Consulting", "Recruiting"],
    why: "Can say yes without a committee — short sales cycles when the fit is right",
    whatToLookFor: [
      "A services business with 2–20 people and no dedicated sales hire",
      "Recent wins they're publishing (case studies, launches, awards)",
      "Signs of referral-dependence: little outbound activity on their site",
    ],
  },
  {
    id: "growth-owner",
    title: "Growth / pipeline owner",
    rolePattern: "Head of Growth / VP Sales / Marketing Lead at a scaling company",
    industries: ["SaaS", "E-commerce", "Fintech", "Healthcare"],
    why: "Owns pipeline numbers personally — feels the problem you fix every quarter",
    whatToLookFor: [
      "Open roles in sales/marketing (signals scaling pressure)",
      "New funding, new markets, or new product lines announced",
      "Content about conversion, CAC, or pipeline problems on their blog/LinkedIn",
    ],
  },
  {
    id: "operations-owner",
    title: "Operations owner",
    rolePattern: "Operations Lead / COO / Delivery Manager at a process-heavy company",
    industries: ["Logistics", "Professional Services", "Manufacturing", "Real Estate"],
    why: "Runs the processes that slow teams down — quick to spot the win",
    whatToLookFor: [
      "Public complaints about tooling gaps or manual handoffs",
      "Hiring for coordinator/ops roles (bandwidth problems)",
      "Multiple locations or teams (coordination complexity)",
    ],
  },
  {
    id: "studio-lead",
    title: "Boutique studio / practice lead",
    rolePattern: "Creative Director / Managing Partner / Principal at a boutique practice",
    industries: ["Design", "Advertising", "Architecture", "Media"],
    why: "Small team, high project value, usually no dedicated sales ops",
    whatToLookFor: [
      "Portfolio work for brands larger than their own team size",
      "Seasonal hiring spikes (delivery crunch)",
      "Retainer or long-project language on their services page",
    ],
  },
];

export const ICP_EXAMPLES: IcpExample[] = [
  {
    id: "b2b-services",
    segment: "Small B2B services firms",
    description:
      "Independent agencies and consultancies that sell expertise and depend on a steady flow of qualified conversations.",
    sizeHints: ["2–20 employees", "$250k–$3M annual revenue", "Founder-led sales"],
    buyingTriggers: [
      "Just lost a major client or ended a big project",
      "Hiring their first sales/marketing role",
      "Launching a new service line or vertical",
    ],
  },
  {
    id: "scaling-ecommerce",
    segment: "Scaling e-commerce brands",
    description:
      "D2C or marketplace brands moving from one channel to multi-channel, where conversion and retention become the bottleneck.",
    sizeHints: ["$1M–$10M revenue", "Paid acquisition on 2+ channels", "Small internal marketing team"],
    buyingTriggers: [
      "Storefront migration or replatforming underway",
      "Rising acquisition costs mentioned publicly",
      "Expansion into new markets or marketplaces",
    ],
  },
  {
    id: "b2b-saas",
    segment: "Early/mid-stage B2B SaaS",
    description:
      "Software companies between first revenue and repeatable sales, where outbound motions are still untested.",
    sizeHints: ["5–50 employees", "Seed to Series A/B", "Founder-led or first-hire sales"],
    buyingTriggers: [
      "New fundraise announced",
      "First sales/marketing hires posted",
      "Pricing or packaging changes shipping",
    ],
  },
];

export const RESEARCH_TEMPLATES: ResearchTemplate[] = [
  {
    id: "company-verify",
    title: "Verify a company (10 minutes)",
    steps: [
      "Open their website — confirm the industry, size signal (team page, careers), and service scope.",
      "Check their latest news: launches, funding, hires, new markets. Note the date of each.",
      "Find 1–2 real people in the buying role (site team page or LinkedIn) — add them to your CRM with real details only.",
      "Write one sentence: what are they plausibly trying to improve this quarter?",
      "Save the source links in the lead notes so future-you can re-verify.",
    ],
  },
  {
    id: "segment-scan",
    title: "Scan a segment (30 minutes)",
    steps: [
      "Pick one segment from your ICP and list 5 real companies in it (directories, associations, conference speaker lists).",
      "For each, record: size estimate, likely buyer role, one recent trigger event.",
      "Rank them by how recently the trigger happened — recency beats fit.",
      "Add the top 2 as leads; archive the rest as notes for the next cycle.",
    ],
  },
  {
    id: "qualify-check",
    title: "Qualify before first contact",
    steps: [
      "Do they have the problem your work solves? What's the evidence (not an assumption)?",
      "Can the person you found plausibly own the buying decision?",
      "Is there a budget signal: funding, revenue growth, open relevant roles?",
      "Is there a timing signal: a trigger event in the last 90 days?",
      "If 3 of 4 are yes, it's a real lead — if not, keep researching.",
    ],
  },
];

export const RESEARCH_PROMPTS: ResearchPrompt[] = [
  {
    id: "segment-prompt",
    title: "Segment research prompt",
    prompt:
      "List the industries represented in my current pipeline. For each: typical buyer roles, one public signal that a company there is actively buying (hiring, funding, launches), and where to find real companies (directories, associations, event lists).",
    useFor: "Deciding which segment to research next",
  },
  {
    id: "company-prompt",
    title: "Company research prompt",
    prompt:
      "For [real company], summarize from public sources only: what they sell, team size signals, recent trigger events with dates, likely buyer role, and one specific way my offer maps to something they've said publicly. Flag anything I could not verify.",
    useFor: "Preparing a verified first-touch",
  },
  {
    id: "icp-prompt",
    title: "ICP refinement prompt",
    prompt:
      "Compare my won and lost deals. Which segment, size, and trigger patterns show up in wins but not losses? Suggest one adjustment to my ICP and two things to verify in future research.",
    useFor: "Sharpening who counts as a good-fit lead",
  },
];
