import { authTables } from "@convex-dev/auth/server";
import { defineSchema, defineTable } from "convex/server";
import { Infer, v } from "convex/values";

// default user roles. can add / remove based on the project as needed
export const ROLES = {
  ADMIN: "admin",
  USER: "user",
  MEMBER: "member",
} as const;

export const roleValidator = v.union(
  v.literal(ROLES.ADMIN),
  v.literal(ROLES.USER),
  v.literal(ROLES.MEMBER),
);
export type Role = Infer<typeof roleValidator>;

const schema = defineSchema(
  {
    // default auth tables using convex auth.
    ...authTables, // do not remove or modify

    // the users table is the default users table that is brought in by the authTables
    users: defineTable({
      name: v.optional(v.string()), // name of the user. do not remove
      image: v.optional(v.string()), // image of the user. do not remove
      email: v.optional(v.string()), // email of the user. do not remove
      emailVerificationTime: v.optional(v.number()), // email verification time. do not remove
      isAnonymous: v.optional(v.boolean()), // is the user anonymous. do not remove

      role: v.optional(roleValidator), // role of the user. do not remove

      // onboarding
      onboardedAt: v.optional(v.number()),
      company: v.optional(v.string()),

      // business profile captured during onboarding (§51)
      businessType: v.optional(v.string()),
      sells: v.optional(v.string()),
      audience: v.optional(v.string()),
      growthGoal: v.optional(v.string()),
      revenueGoal: v.optional(v.number()),
      teamSize: v.optional(v.string()),
    }).index("email", ["email"]), // index for the email. do not remove or modify

    leads: defineTable({
      userId: v.id("users"),
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
      // pipeline stages (canonical): new | contacted | discovery | proposal |
      // interested | won | lost. Legacy values replied/meeting map to
      // discovery/proposal — see LEGACY_STATUS_MAP in src/lib/leadStatus.ts.
      status: v.string(),
      // AI-generated lead intelligence (null until analyzed)
      score: v.optional(v.number()),
      summary: v.optional(v.string()),
      painPoints: v.optional(v.array(v.string())),
      signals: v.optional(v.array(v.string())),
      approach: v.optional(v.string()),
      scoreBreakdown: v.optional(
        v.array(
          v.object({
            label: v.string(),
            value: v.number(),
          }),
        ),
      ),
      aiGeneratedAt: v.optional(v.number()),
      lastContactedAt: v.optional(v.number()),
      nextFollowUpAt: v.optional(v.number()),
      source: v.optional(v.string()),

      // deal CRM fields (§17) — the lead IS the deal; one record per opportunity
      dealValue: v.optional(v.number()),
      probability: v.optional(v.number()), // 0–100, manual or AI-suggested
      expectedCloseAt: v.optional(v.number()),
      // lead intelligence (§11)
      companySize: v.optional(v.string()),
      revenue: v.optional(v.string()),
      intent: v.optional(v.string()), // high | medium | low (free text preserved)

      // ── Phase 2: proper Deal entity (§3) — extends the existing record ──
      // Optional display name for the deal; falls back to "name @ company".
      dealName: v.optional(v.string()),
      currency: v.optional(v.string()), // ISO code, e.g. "USD"; optional
      // Campaign attribution when the deal originated from a campaign send.
      campaignId: v.optional(v.id("campaigns")),
      // Closure timestamps — written ONLY by markWon/markLost (§5). Never
      // fabricated for historical rows: existing won/lost records keep these
      // undefined and revenue math falls back to documented behavior.
      wonAt: v.optional(v.number()),
      lostAt: v.optional(v.number()),
      lossReason: v.optional(v.string()),
      updatedAt: v.optional(v.number()),
      // General "anything happened" timestamp (notes, messages, stage moves,
      // follow-ups). Older records only have lastContactedAt; health logic
      // reads both and never invents a value for rows that lack them.
      lastActivityAt: v.optional(v.number()),
      // nextActivityAt is intentionally NOT a separate column: the existing
      // nextFollowUpAt field already stores the next scheduled activity time
      // and is maintained by scheduleFollowUp/setFollowUpStatus.
    })
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"])
      .index("by_user_followup", ["userId", "nextFollowUpAt"]),

    /**
     * Phase 2 (§3): persisted stage transitions for deals. Recorded ONLY for
     * changes made after this feature shipped — no backfill, no fabricated
     * history for pre-existing records. `from` is undefined when the change
     * is the first one recorded for a deal.
     */
    dealStageHistory: defineTable({
      userId: v.id("users"),
      leadId: v.id("leads"),
      from: v.optional(v.string()), // canonical stage before the move
      to: v.string(), // canonical stage after the move
      at: v.number(),
    })
      .index("by_lead", ["leadId", "at"])
      .index("by_user", ["userId", "at"]),

    /**
     * Phase 2 (§12): persisted proposals linked to a deal. Status lifecycle:
     * draft → sent → viewed → accepted/rejected. `viewedAt` exists for the
     * day real view tracking is added — it is NEVER written automatically
     * (no fake tracking), so viewed proposals won't appear until then.
     */
    proposals: defineTable({
      userId: v.id("users"),
      dealId: v.id("leads"),
      title: v.string(),
      // draft | sent | viewed | accepted | rejected
      status: v.string(),
      value: v.optional(v.number()),
      currency: v.optional(v.string()),
      summary: v.optional(v.string()), // Executive summary
      problem: v.optional(v.string()),
      solution: v.optional(v.string()),
      deliverables: v.optional(v.array(v.string())),
      timeline: v.optional(v.string()),
      pricing: v.optional(v.string()),
      outcomes: v.optional(v.string()), // Expected outcomes
      nextSteps: v.optional(v.string()),
      createdAt: v.number(),
      updatedAt: v.number(),
      sentAt: v.optional(v.number()),
      viewedAt: v.optional(v.number()), // reserved — never auto-written
      acceptedAt: v.optional(v.number()),
      rejectedAt: v.optional(v.number()),
      rejectedReason: v.optional(v.string()),
    })
      .index("by_user", ["userId"])
      .index("by_deal", ["dealId"]),

    followUps: defineTable({
      userId: v.id("users"),
      leadId: v.id("leads"),
      dueAt: v.number(),
      note: v.optional(v.string()),
      // pending | done | skipped
      status: v.string(),
      completedAt: v.optional(v.number()),
    })
      .index("by_lead", ["leadId"])
      .index("by_user_due", ["userId", "dueAt"]),

    notes: defineTable({
      userId: v.id("users"),
      leadId: v.id("leads"),
      body: v.string(),
      author: v.optional(v.string()),
    }).index("by_lead", ["leadId"]),

    templates: defineTable({
      userId: v.id("users"),
      name: v.string(),
      subject: v.optional(v.string()),
      body: v.string(),
      channel: v.optional(v.string()), // email | linkedin
      tags: v.optional(v.array(v.string())),
      lastUsedAt: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    messages: defineTable({
      userId: v.id("users"),
      leadId: v.id("leads"),
      campaignId: v.optional(v.id("campaigns")),
      channel: v.string(), // email | linkedin
      direction: v.string(), // sent | received | logged
      subject: v.optional(v.string()),
      body: v.string(),
      // draft | queued | sent | failed (outbound); unread/read (inbound)
      status: v.string(),
      readAt: v.optional(v.number()),
      error: v.optional(v.string()),
      provider: v.optional(v.string()),
      createdAt: v.number(),
      sentAt: v.optional(v.number()),
    })
      .index("by_lead", ["leadId"])
      .index("by_user_created", ["userId", "createdAt"])
      .index("by_campaign", ["campaignId"]),

    campaigns: defineTable({
      userId: v.id("users"),
      name: v.string(),
      description: v.optional(v.string()),
      channel: v.string(), // email | linkedin
      subject: v.optional(v.string()),
      templateId: v.optional(v.id("templates")),
      body: v.string(),
      // draft | active | completed
      status: v.string(),
      createdAt: v.number(),
      // Timestamp while a send action is running — guards against concurrent
      // double-sends. Cleared when the send finishes; stale locks (>2 min) are
      // ignored so a crashed send can't block the campaign forever.
      sendInProgressAt: v.optional(v.number()),
    }).index("by_user", ["userId"]),

    campaignLeads: defineTable({
      userId: v.id("users"),
      campaignId: v.id("campaigns"),
      leadId: v.id("leads"),
      // pending | sent | replied | failed
      status: v.string(),
      sentAt: v.optional(v.number()),
      error: v.optional(v.string()),
    })
      .index("by_campaign", ["campaignId"])
      .index("by_lead", ["leadId"]),

    // ── Phase 1: Business Intelligence ──────────────────────────────────

    /**
     * Business Profile (Phase 1 §1) — one per authenticated user. All fields
     * optional except name; owned by userId per the existing pattern. Created
     * lazily on first save; the onboarding flow also populates it.
     */
    businessProfiles: defineTable({
      userId: v.id("users"),
      businessName: v.string(),
      website: v.optional(v.string()),
      industry: v.optional(v.string()),
      businessType: v.optional(v.string()),
      businessModel: v.optional(v.string()),
      products: v.optional(v.string()),
      description: v.optional(v.string()),
      targetGeography: v.optional(v.string()),
      currency: v.optional(v.string()),
      teamSize: v.optional(v.string()),
      currentMonthlyRevenue: v.optional(v.number()),
      targetMonthlyRevenue: v.optional(v.number()),
      acquisitionChannels: v.optional(v.array(v.string())),
      avgSalesCycle: v.optional(v.string()),
      primaryChallenge: v.optional(v.string()),
    }).index("by_user", ["userId"]),

    /**
     * Business Goals (Phase 1 §2) — many per user. `currentValue` is NEVER
     * stored: it is always derived from real CRM records by goalEngine.ts at
     * read time. `manualCurrentValue` exists only for kinds that cannot be
     * derived (retention/custom) — guarded server-side so measurable kinds
     * always use derived data.
     */
    businessGoals: defineTable({
      userId: v.id("users"),
      name: v.string(),
      kind: v.string(), // GoalKind from src/lib/goalEngine.ts
      targetValue: v.optional(v.number()),
      period: v.string(), // GoalPeriod from src/lib/goalEngine.ts
      status: v.string(), // active | achieved | paused
      deadline: v.optional(v.number()),
      manualCurrentValue: v.optional(v.number()),
      createdAt: v.number(),
    }).index("by_user", ["userId"]),

    /**
     * Phase 3 (§2a): Copilot conversations — persistence ONLY. No AI calls
     * anywhere in this flow; answers come from the deterministic engine in
     * src/lib/assistant.ts. Titles are user-derivable strings (default
     * "New conversation" or derived locally from the first user message).
     * Owned by userId like every other table.
     */
    conversations: defineTable({
      userId: v.id("users"),
      title: v.string(),
      createdAt: v.number(),
      updatedAt: v.number(), // bumped on every appended message
    }).index("by_user", ["userId"]),

    /**
     * Phase 3 (§2a): one Copilot chat turn. `role` is constrained to
     * user|assistant at the validator level. `userId` is stored on every row
     * so a guessed conversationId can never grant access — every read/write
     * re-verifies ownership through the parent conversation AND the rows stay
     * user-stamped for defense in depth.
     */
    conversationMessages: defineTable({
      conversationId: v.id("conversations"),
      userId: v.id("users"),
      // "user" | "assistant" (validator-enforced union)
      role: v.union(v.literal("user"), v.literal("assistant")),
      content: v.string(),
      createdAt: v.number(),
    }).index("by_conversation", ["conversationId", "createdAt"]),
  },
  {
    schemaValidation: false,
  },
);

export default schema;
