import { getAuthUserId } from "@convex-dev/auth/server";
import { mutation, query, type MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  LEAD_STATUS_VALUES,
  canonicalStatus,
} from "../lib/leadStatus";
import { buildExistingKeys, leadDedupKeys } from "../lib/csv";

const LEAD_FIELDS = {
  name: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  jobTitle: v.optional(v.string()),
  company: v.optional(v.string()),
  website: v.optional(v.string()),
  industry: v.optional(v.string()),
  location: v.optional(v.string()),
  linkedin: v.optional(v.string()),
  notes: v.optional(v.string()),
  tags: v.optional(v.array(v.string())),
  source: v.optional(v.string()),
  // deal CRM + lead intelligence fields (§11, §17)
  companySize: v.optional(v.string()),
  revenue: v.optional(v.string()),
  intent: v.optional(v.string()),
  dealValue: v.optional(v.number()),
  probability: v.optional(v.number()),
  expectedCloseAt: v.optional(v.number()),
};

async function requireUserId(ctx: MutationCtx) {
  const userId = await getAuthUserId(ctx);
  if (userId === null) {
    throw new Error("You need to sign in to do that.");
  }
  return userId;
}

// ── Queries ────────────────────────────────────────────────────────────────

export const list = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .collect();
  },
});

export const get = query({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) return null;
    return lead;
  },
});

export const followUpsForLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return [];
    return await ctx.db
      .query("followUps")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect();
  },
});

export const notesForLead = query({
  args: { leadId: v.id("leads") },
  handler: async (ctx, { leadId }) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) return [];
    return await ctx.db
      .query("notes")
      .withIndex("by_lead", (q) => q.eq("leadId", leadId))
      .collect();
  },
});

// ── Mutations ──────────────────────────────────────────────────────────────

export const create = mutation({
  args: LEAD_FIELDS,
  handler: async (ctx, args) => {
    const userId = await requireUserId(ctx);
    return await ctx.db.insert("leads", {
      userId,
      ...args,
      status: "new",
    });
  },
});

const { name: _name, ...OPTIONAL_LEAD_FIELDS } = LEAD_FIELDS;

export const update = mutation({
  // Partial update: every field optional. The handler strips undefined values,
  // so a request touching only one field never erases the others.
  args: { id: v.id("leads"), name: v.optional(v.string()), ...OPTIONAL_LEAD_FIELDS },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    await ctx.db.patch(id, clean);
  },
});

export const bulkImport = mutation({
  args: { leads: v.array(v.object(LEAD_FIELDS)) },
  handler: async (ctx, { leads }) => {
    const userId = await requireUserId(ctx);
    // Server-side dedup re-check (production hardening §5): the client preview
    // already filtered duplicates, but the server enforces the same keys so a
    // stale page or racing tab can never silently create duplicate records.
    // Duplicate = matching email, phone, or company+name of an existing lead
    // or an earlier row in this batch. First occurrence wins; nothing is
    // updated or deleted — duplicates are skipped entirely.
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const keys = buildExistingKeys(existing);
    const ids: Id<"leads">[] = [];
    let duplicates = 0;
    for (const lead of leads) {
      const k = leadDedupKeys(lead);
      if (
        (k.email && keys.emails.has(k.email)) ||
        (k.phone && keys.phones.has(k.phone)) ||
        (k.companyName && keys.companyNames.has(k.companyName))
      ) {
        duplicates++;
        continue;
      }
      if (k.email) keys.emails.add(k.email);
      if (k.phone) keys.phones.add(k.phone);
      if (k.companyName) keys.companyNames.add(k.companyName);
      ids.push(await ctx.db.insert("leads", { userId, ...lead, status: "new" }));
    }
    return { ids, imported: ids.length, duplicates };
  },
});

export const setStatus = mutation({
  args: { id: v.id("leads"), status: v.string() },
  handler: async (ctx, { id, status }) => {
    const userId = await requireUserId(ctx);
    const canonical = canonicalStatus(status);
    if (!LEAD_STATUS_VALUES.includes(canonical)) {
      throw new Error("Unknown status.");
    }
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    await ctx.db.patch(id, { status: canonical });
  },
});

export const bulkSetStatus = mutation({
  args: { ids: v.array(v.id("leads")), status: v.string() },
  handler: async (ctx, { ids, status }) => {
    const userId = await requireUserId(ctx);
    const canonical = canonicalStatus(status);
    if (!LEAD_STATUS_VALUES.includes(canonical)) {
      throw new Error("Unknown status.");
    }
    for (const id of ids) {
      const lead = await ctx.db.get(id);
      if (lead && lead.userId === userId) await ctx.db.patch(id, { status: canonical });
    }
  },
});

/**
 * One-time (idempotent) migration: rewrite legacy stage values ('replied' →
 * 'discovery', 'meeting' → 'proposal') into canonical pipeline stages. Reads
 * the shared LEGACY_STATUS_MAP so the server can never disagree with the UI.
 * No rows are deleted; only the status field is patched.
 */
export const migrateStatuses = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const legacy = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    let migrated = 0;
    for (const lead of legacy) {
      const canonical = canonicalStatus(lead.status);
      if (canonical !== lead.status) {
        await ctx.db.patch(lead._id, { status: canonical });
        migrated++;
      }
    }
    return { migrated };
  },
});

/** Update the deal-CRM fields of one lead (§17). Partial — strips undefined. */
export const updateDeal = mutation({
  args: {
    id: v.id("leads"),
    dealValue: v.optional(v.number()),
    probability: v.optional(v.number()),
    expectedCloseAt: v.optional(v.number()),
    companySize: v.optional(v.string()),
    revenue: v.optional(v.string()),
    intent: v.optional(v.string()),
  },
  handler: async (ctx, { id, ...fields }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    const clean = Object.fromEntries(
      Object.entries(fields).filter(([, value]) => value !== undefined),
    );
    if (clean.probability !== undefined) {
      const p = clean.probability as number;
      if (p < 0 || p > 100) throw new Error("Probability must be between 0 and 100.");
    }
    if (clean.dealValue !== undefined && (clean.dealValue as number) < 0) {
      throw new Error("Deal value can't be negative.");
    }
    await ctx.db.patch(id, clean);
  },
});

export const bulkDelete = mutation({
  args: { ids: v.array(v.id("leads")) },
  handler: async (ctx, { ids }) => {
    const userId = await requireUserId(ctx);
    for (const id of ids) {
      const lead = await ctx.db.get(id);
      if (lead && lead.userId === userId) await deleteLeadWithChildren(ctx, id);
    }
  },
});

export const remove = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    await deleteLeadWithChildren(ctx, id);
  },
});

async function deleteLeadWithChildren(ctx: MutationCtx, id: Id<"leads">) {
  const followUps = await ctx.db
    .query("followUps")
    .withIndex("by_lead", (q) => q.eq("leadId", id))
    .collect();
  for (const f of followUps) await ctx.db.delete(f._id);
  const notes = await ctx.db
    .query("notes")
    .withIndex("by_lead", (q) => q.eq("leadId", id))
    .collect();
  for (const n of notes) await ctx.db.delete(n._id);
  await ctx.db.delete(id);
}

export const addNote = mutation({
  args: { leadId: v.id("leads"), body: v.string() },
  handler: async (ctx, { leadId, body }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    return await ctx.db.insert("notes", {
      userId,
      leadId,
      body,
      author: "You",
    });
  },
});

export const markContacted = mutation({
  args: { id: v.id("leads") },
  handler: async (ctx, { id }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    await ctx.db.patch(id, {
      status: lead.status === "new" ? "contacted" : lead.status,
      lastContactedAt: Date.now(),
    });
  },
});

export const scheduleFollowUp = mutation({
  args: {
    leadId: v.id("leads"),
    dueAt: v.number(),
    note: v.optional(v.string()),
  },
  handler: async (ctx, { leadId, dueAt, note }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(leadId);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    const id = await ctx.db.insert("followUps", {
      userId,
      leadId,
      dueAt,
      note,
      status: "pending",
    });
    const current = lead.nextFollowUpAt ?? Number.MAX_SAFE_INTEGER;
    if (dueAt < current) await ctx.db.patch(leadId, { nextFollowUpAt: dueAt });
    return id;
  },
});

export const setFollowUpStatus = mutation({
  args: {
    id: v.id("followUps"),
    status: v.union(
      v.literal("pending"),
      v.literal("done"),
      v.literal("skipped"),
    ),
  },
  handler: async (ctx, { id, status }) => {
    const userId = await requireUserId(ctx);
    const followUp = await ctx.db.get(id);
    if (!followUp || followUp.userId !== userId) {
      throw new Error("Follow-up not found.");
    }
    await ctx.db.patch(id, {
      status,
      completedAt: status === "pending" ? undefined : Date.now(),
    });
    const remaining = await ctx.db
      .query("followUps")
      .withIndex("by_lead", (q) => q.eq("leadId", followUp.leadId))
      .collect();
    const pending = remaining
      .filter((f) => f.status === "pending")
      .map((f) => f.dueAt)
      .sort((a, b) => a - b);
    await ctx.db.patch(followUp.leadId, { nextFollowUpAt: pending[0] });
  },
});

// ── Save AI analysis onto a lead (client calls the AI provider, then this) ─

export const saveAnalysis = mutation({
  args: {
    id: v.id("leads"),
    score: v.number(),
    summary: v.string(),
    painPoints: v.array(v.string()),
    signals: v.array(v.string()),
    approach: v.string(),
    industry: v.optional(v.string()),
    scoreBreakdown: v.array(v.object({ label: v.string(), value: v.number() })),
  },
  handler: async (ctx, { id, ...analysis }) => {
    const userId = await requireUserId(ctx);
    const lead = await ctx.db.get(id);
    if (!lead || lead.userId !== userId) throw new Error("Lead not found.");
    await ctx.db.patch(id, { ...analysis, aiGeneratedAt: Date.now() });
  },
});

// ── Sample data (demo workspace) ───────────────────────────────────────────

type SampleLead = {
  name: string;
  jobTitle?: string;
  company?: string;
  industry?: string;
  location?: string;
  email?: string;
  website?: string;
  status?: string;
  score?: number;
  summary?: string;
  painPoints?: string[];
  signals?: string[];
  approach?: string;
  tags?: string[];
  lastContactedAt?: number;
  nextFollowUpAt?: number;
  source?: string;
  dealValue?: number;
};

export const loadSampleData = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const existing = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    if (existing.length > 0) {
      return { seeded: false, count: existing.length };
    }

    const now = Date.now();
    const hour = 60 * 60 * 1000;
    const day = 24 * hour;

    const samples: SampleLead[] = [
      {
        name: "Sarah Mitchell",
        jobTitle: "Founder",
        company: "Nova Studio",
        industry: "Design",
        location: "Austin, TX",
        email: "sarah@novastudio.example",
        website: "novastudio.example",
        status: "interested",
        score: 87,
        summary:
          "Nova Studio is an independent design practice expanding its client portfolio and recently launched a new e-commerce offering for retail clients.",
        painPoints: [
          "Current website experience may limit conversion from paid traffic",
          "New e-commerce line increases demand for conversion-focused landing pages",
          "Small team — no dedicated growth marketer iterating on funnels",
        ],
        signals: [
          "Recently launched a new e-commerce service",
          "Posted openings for freelance CRO specialists",
          "Case studies highlight redesign work for retail brands",
        ],
        approach:
          "Lead with a conversion-focused redesign angle rather than a generic web-dev pitch; reference their new e-commerce offering.",
        tags: ["design", "warm"],
        lastContactedAt: now - 2 * day,
        nextFollowUpAt: now + 2 * hour,
        source: "Sample data",
      },
      {
        name: "Daniel Osei",
        jobTitle: "Managing Director",
        company: "Northstar Digital",
        industry: "Marketing",
        location: "London, UK",
        email: "daniel@northstardigital.example",
        website: "northstardigital.example",
        status: "discovery",
        score: 81,
        summary:
          "Northstar Digital runs performance campaigns for mid-market e-commerce brands and recently picked up three new retail accounts.",
        painPoints: [
          "Scaling reporting across three new accounts with a small delivery team",
          "Landing page production is a bottleneck between paid and web teams",
          "Clients increasingly ask for conversion guarantees",
        ],
        signals: [
          "Onboarded three new retail accounts this quarter",
          "Hiring two paid media roles",
          "Active on LinkedIn discussing CRO for e-commerce",
        ],
        approach:
          "Position as landing-page production support that lifts campaign ROI; mention the CRO angle for retail clients.",
        tags: ["agency"],
        lastContactedAt: now - 4 * day,
        nextFollowUpAt: now + day,
        source: "Sample data",
      },
      {
        name: "Priya Raman",
        jobTitle: "Head of Growth",
        company: "Elevate Commerce",
        industry: "E-commerce",
        location: "Bengaluru, IN",
        email: "priya@elevatecommerce.example",
        website: "elevatecommerce.example",
        status: "proposal",
        score: 92,
        summary:
          "Elevate Commerce is a D2C marketplace scaling from marketplace listings to its own storefront, with a growing paid-acquisition program.",
        painPoints: [
          "Storefront migration risks losing paid traffic conversion",
          "Checkout abandonment above category benchmark",
          "No in-house experimentation capability",
        ],
        signals: [
          "Launching own storefront next month",
          "Running paid ads on four channels",
          "Posted about checkout optimization experiments",
        ],
        approach:
          "Offer a post-migration CRO sprint tied to checkout metrics; reference their storefront launch timeline.",
        tags: ["ecommerce", "hot"],
        lastContactedAt: now - day,
        nextFollowUpAt: now + 3 * day,
        source: "Sample data",
      },
      {
        name: "Marcus Bell",
        jobTitle: "Operations Lead",
        company: "Brightline Consulting",
        industry: "Consulting",
        location: "Chicago, IL",
        email: "marcus@brightline.example",
        website: "brightline.example",
        status: "contacted",
        score: 64,
        summary:
          "Brightline Consulting delivers operations engagements for mid-market firms and relies mostly on referrals for new business.",
        painPoints: [
          "Lead flow depends on referrals, which is unpredictable",
          "Website doesn't communicate measurable outcomes clearly",
          "No structured outbound motion",
        ],
        signals: [
          "Won two enterprise contracts this quarter",
          "Website copy is outcome-light",
          "Partners active in local business associations",
        ],
        approach:
          "Suggest a positioning refresh with outcome-led case studies, then a light outbound cadence.",
        tags: ["consulting"],
        lastContactedAt: now - 6 * day,
        source: "Sample data",
      },
      {
        name: "Elena Vasquez",
        jobTitle: "CEO",
        company: "Orbit Labs",
        industry: "SaaS",
        location: "Lisbon, PT",
        email: "elena@orbitlabs.example",
        website: "orbitlabs.example",
        status: "new",
        score: 78,
        summary:
          "Orbit Labs builds workflow automation for logistics teams and is preparing its Series A with strong ARR growth.",
        painPoints: [
          "Marketing site undersells product depth to mid-market buyers",
          "Outbound is untested — mostly product-led so far",
          "Pricing page confusion shows up in support tickets",
        ],
        signals: [
          "Preparing Series A fundraise",
          "Hiring first marketing hire",
          "Product blog posts about logistics automation",
        ],
        approach:
          "Offer a website conversion audit timed to the fundraise narrative; keep the pitch metrics-first.",
        tags: ["saas"],
        source: "Sample data",
      },
      {
        name: "Tom Alvarez",
        jobTitle: "Creative Director",
        company: "PixelCraft",
        industry: "Design",
        location: "Toronto, CA",
        email: "tom@pixelcraft.example",
        website: "pixelcraft.example",
        status: "new",
        score: 71,
        summary:
          "PixelCraft is a boutique creative studio producing brand systems and campaign sites for hospitality clients.",
        painPoints: [
          "Campaign sites are hand-built, so iteration is slow",
          "Portfolio doesn't show measurable results",
          "Seasonal workload peaks strain delivery",
        ],
        signals: [
          "Recently published hospitality rebrand case studies",
          "Hiring freelance web developers",
          "Expanding into retainer work",
        ],
        approach:
          "Pitch faster campaign-site production with a results-metrics angle; offer overflow delivery support.",
        tags: ["design"],
        source: "Sample data",
      },
      {
        name: "Aisha Khan",
        jobTitle: "VP Sales",
        company: "Atlas SaaS",
        industry: "SaaS",
        location: "Dubai, AE",
        email: "aisha@atlassaas.example",
        website: "atlassaas.example",
        status: "won",
        score: 88,
        summary:
          "Atlas SaaS sells customer-success tooling to mid-market B2B teams and just expanded its UAE enterprise segment.",
        painPoints: [
          "Outbound messaging doesn't differentiate from competitors",
          "Sales cycle stalled at proposal stage for two quarters",
          "Limited case studies for enterprise buyers",
        ],
        signals: [
          "Expanded enterprise segment this year",
          "New VP of Sales hired",
          "Published customer story with metrics",
        ],
        approach:
          "Closed: repositioned outbound messaging and a case-study program lifted enterprise replies.",
        dealValue: 18000,
        tags: ["closed-won"],
        lastContactedAt: now - 12 * day,
        source: "Sample data",
      },
      {
        name: "Jonas Weber",
        jobTitle: "Founder",
        company: "Mono Creative",
        industry: "Design",
        location: "Berlin, DE",
        email: "jonas@monocreative.example",
        website: "monocreative.example",
        status: "new",
        score: 69,
        summary:
          "Mono Creative is a two-person studio doing brand and web for indie SaaS founders, mostly via Twitter referrals.",
        painPoints: [
          "Inconsistent pipeline between referral bursts",
          "No follow-up system after initial quotes",
          "Quotes go out without structured proposals",
        ],
        signals: [
          "Active posting about SaaS rebrands",
          "Quoted projects without follow-up cadence",
          "Small team, high per-project value",
        ],
        approach:
          "Pitch a simple follow-up system plus proposal templates; quantify the referral-gap weeks.",
        tags: ["studio"],
        source: "Sample data",
      },
    ];

    for (const s of samples) {
      const { status, ...rest } = s;
      await ctx.db.insert("leads", {
        userId,
        ...rest,
        status: status ?? "new",
        source: s.source ?? "Sample data",
      });
    }
    return { seeded: true, count: samples.length };
  },
});

export const clearAll = mutation({
  args: {},
  handler: async (ctx) => {
    const userId = await requireUserId(ctx);
    const leads = await ctx.db
      .query("leads")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    for (const lead of leads) await deleteLeadWithChildren(ctx, lead._id);
    return { deleted: leads.length };
  },
});
