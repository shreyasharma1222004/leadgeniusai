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
      // pipeline: new | contacted | replied | interested | meeting | won | lost
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
    })
      .index("by_user", ["userId"])
      .index("by_user_status", ["userId", "status"])
      .index("by_user_followup", ["userId", "nextFollowUpAt"]),

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
  },
  {
    schemaValidation: false,
  },
);

export default schema;
