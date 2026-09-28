// NOTE: alias-free (relative imports only) so this can be shared with Convex
// server functions if needed later — same convention as goalEngine.ts.
import type { Doc } from "../convex/_generated/dataModel";
import { canonicalStatus } from "./leadStatus";
import {
  REVENUE_THRESHOLDS,
  dealTitle,
  isOpenDeal,
  isWonDeal,
  lastActivityOf,
} from "./revenue";

/**
 * ── Clients (Phase 2 §15–§18) ──────────────────────────────────────────────
 *
 * A client is NOT a new entity. Per §15 ("do not duplicate the underlying
 * contact/company data"), a client is DERIVED at read time: every company
 * (or contact, when no company is set) with at least one won deal is a
 * client. All underlying data stays in the existing leads/notes/followUps/
 * messages/proposals tables, which the client pages already filter by
 * membership in the group.
 *
 * The lifecycle Lead → Opportunity → Deal → Client is therefore:
 *   lead created → moves through stages → marked Won → its company/contact
 *   becomes (or joins) a client here.
 */

type Lead = Doc<"leads">;
type FollowUp = { _id: string; leadId: string; dueAt: number; status: string; note?: string };
type MessageRow = { _id: string; leadId: string; direction: string; createdAt: number; readAt?: number };

const DAY = 24 * 60 * 60 * 1000;

/** Grouping key for a client: company when present, else the contact name. */
export function clientKeyOf(lead: Lead): string {
  return lead.company?.trim() || lead.name.trim();
}

export interface ClientDeal {
  lead: Lead;
  role: "active" | "won" | "lost";
}

export interface ClientHealth {
  /** Healthy | Needs attention | Quiet — with the transparent reason (§17). */
  state: "healthy" | "attention" | "quiet";
  detail: string;
}

export interface ClientNoteRow {
  _id: string;
  body: string;
  _creationTime: number;
}

export interface Client {
  /** Stable grouping key (company or contact name). */
  key: string;
  /** Display name: company, else contact. */
  name: string;
  /** The primary contact (most recent deal) for this client. */
  primaryLead: Lead;
  deals: ClientDeal[];
  activeDeals: ClientDeal[];
  wonDeals: ClientDeal[];
  /** Σ dealValue over won deals — total revenue actually recorded. */
  totalRevenue: number;
  /** Σ dealValue over open deals with this client. */
  openValue: number;
  /** Client of the most recent deal activity, or undefined when silent. */
  lastActivityAt: number | undefined;
  nextActivityAt: number | undefined;
  /** Transparent, evidence-based health (§17). */
  health: ClientHealth;
  /** Retention signal (§18) — evidence-backed only. */
  retention: {
    state: "at_risk" | "healthy" | "expansion" | "insufficient";
    evidence: string[];
  };
  industry?: string;
  website?: string;
}

type ClientBase = Omit<Client, "retention">;

/**
 * Whether the user's business profile lists more than one product/service —
 * an input to expansion detection (§18). Computed once, passed in.
 */
type ClientBaseWithExpansion = ClientBase & { hasMultipleProducts: boolean };

function clientHealth(
  leads: Lead[],
  followUps: FollowUp[],
  messages: MessageRow[],
): ClientHealth {
  const now = Date.now();
  const activities = leads
    .map(lastActivityOf)
    .filter((t): t is number => t !== undefined);
  const last = activities.length > 0 ? Math.max(...activities) : undefined;
  const hasUpcoming = leads.some(
    (l) => l.nextFollowUpAt !== undefined && l.nextFollowUpAt > now,
  );
  const leadIds = new Set(leads.map((l) => l._id as string));
  const recentMsg = messages.some(
    (m) => leadIds.has(m.leadId) && now - m.createdAt < REVENUE_THRESHOLDS.clientHealthyDays * DAY,
  );

  if (last !== undefined && now - last < REVENUE_THRESHOLDS.clientHealthyDays * DAY) {
    return { state: "healthy", detail: `Activity ${Math.max(1, Math.floor((now - last) / DAY))}d ago${hasUpcoming ? " · follow-up scheduled" : ""}` };
  }
  if (hasUpcoming) {
    return { state: "healthy", detail: "Upcoming follow-up scheduled" };
  }
  if (recentMsg) {
    return { state: "healthy", detail: `Messages within the last ${REVENUE_THRESHOLDS.clientHealthyDays} days` };
  }
  if (last !== undefined) {
    const days = Math.floor((now - last) / DAY);
    const overdue = followUps.filter((f) => leadIds.has(f.leadId) && f.status === "pending" && f.dueAt < now).length;
    if (days >= REVENUE_THRESHOLDS.clientInactiveDays) {
      return {
        state: "quiet",
        detail: `No recorded activity for ${days} days${overdue ? ` · ${overdue} overdue follow-up${overdue === 1 ? "" : "s"}` : ""}`,
      };
    }
    return { state: "attention", detail: `No activity in ${days} days and nothing scheduled` };
  }
  return { state: "quiet", detail: "No recorded activity on any deal" };
}

function retentionOf(client: ClientBaseWithExpansion): Client["retention"] {
  const evidence: string[] = [];
  const now = Date.now();

  // Expansion requires EVIDENCE (§18): a business profile with multiple
  // products/services AND a healthy relationship. Never invented.
  const expansionPossible = client.health.state === "healthy" && client.hasMultipleProducts === true && client.wonDeals.length > 0;
  if (expansionPossible) {
    evidence.push(
      `Relationship is active and your business profile lists multiple products/services — a natural moment to discuss the rest of the portfolio`,
    );
  }

  const wonCount = client.wonDeals.length;
  if (wonCount > 0) {
    evidence.push(
      `${wonCount} won deal${wonCount === 1 ? "" : "s"} worth ${client.totalRevenue.toLocaleString()} recorded`,
    );
  }

  const last = client.lastActivityAt;
  const quietDays = last !== undefined ? Math.floor((now - last) / DAY) : undefined;

  if (quietDays !== undefined && quietDays >= REVENUE_THRESHOLDS.clientInactiveDays) {
    return {
      state: "at_risk",
      // Careful wording: inactivity is a measurable signal worth acting on —
      // NOT a churn prediction. The UI explains this distinction (§17/§18).
      evidence: [
        `No recorded activity for ${quietDays} days — worth reaching out, though this is an inactivity signal, not a churn prediction`,
        ...evidence,
      ],
    };
  }
  if (client.activeDeals.length > 0) {
    evidence.push(
      `${client.activeDeals.length} active deal${client.activeDeals.length === 1 ? "" : "s"} in progress`,
    );
  }
  if (quietDays === undefined) {
    return { state: "insufficient", evidence: ["No activity recorded on any deal yet"] };
  }
  if (expansionPossible) {
    return { state: "expansion", evidence };
  }
  if (quietDays < REVENUE_THRESHOLDS.clientHealthyDays) {
    return { state: "healthy", evidence };
  }
  return { state: "insufficient", evidence };
}

/**
 * Derive clients from won deals, grouped by company (or contact when no
 * company). Pure function over the caller's own records.
 *
 * The optional context (follow-ups, messages) enriches health evidence; when
 * omitted, health degrades to touch-based signals only.
 */
export function computeClients(
  leads: Lead[],
  profileProducts: string | undefined,
  context: {
    followUps?: FollowUp[];
    messages?: MessageRow[];
  } = {},
): Client[] {
  const groups = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (!isWonDeal(lead)) continue;
    const key = clientKeyOf(lead);
    const group = groups.get(key);
    if (group) group.push(lead);
    else groups.set(key, [lead]);
  }

  const hasMultipleProducts =
    profileProducts !== undefined &&
    profileProducts
      .split(/[,;\n·|]/)
      .map((s) => s.trim())
      .filter(Boolean).length > 1;

  return [...groups.entries()].map(([key, wonLeads]) => {
    const wonIds = new Set(wonLeads.map((l) => l._id));
    // Deals for this client = the won group + any open/lost deals sharing the key.
    const related = leads.filter(
      (l) => !wonIds.has(l._id) && clientKeyOf(l) === key,
    );
    const all = [...wonLeads, ...related];
    const deals: ClientDeal[] = all.map((lead) => ({
      lead,
      role: isWonDeal(lead)
        ? ("won" as const)
        : isOpenDeal(lead)
          ? ("active" as const)
          : ("lost" as const),
    }));

    const primaryLead = [...wonLeads].sort(
      (a, b) => (b.wonAt ?? b._creationTime) - (a.wonAt ?? a._creationTime),
    )[0];

    const activities = all
      .map(lastActivityOf)
      .filter((t): t is number => t !== undefined);
    const next = all
      .map((l) => l.nextFollowUpAt)
      .filter((t): t is number => t !== undefined && t > Date.now())
      .sort((a, b) => a - b)[0];

    const activeDeals = deals.filter((d) => d.role === "active");
    const wonDeals = deals.filter((d) => d.role === "won");

    const base: ClientBaseWithExpansion = {
      key,
      name: key,
      primaryLead,
      deals,
      activeDeals,
      wonDeals,
      totalRevenue: wonLeads.reduce((s, l) => s + (l.dealValue ?? 0), 0),
      openValue: activeDeals.reduce((s, d) => s + (d.lead.dealValue ?? 0), 0),
      lastActivityAt: activities.length ? Math.max(...activities) : undefined,
      nextActivityAt: next,
      health: clientHealth(all, context.followUps ?? [], context.messages ?? []),
      industry: primaryLead.industry,
      website: primaryLead.website,
      hasMultipleProducts,
    };

    const retention = retentionOf(base);
    const { hasMultipleProducts: _drop, ...client } = base;
    return { ...client, retention };
  });
}

/** Sort helpers shared by the Clients page. */
export function sortClients(clients: Client[], by: "revenue" | "activity" | "name"): Client[] {
  const copy = [...clients];
  if (by === "revenue") return copy.sort((a, b) => b.totalRevenue - a.totalRevenue);
  if (by === "activity") {
    return copy.sort(
      (a, b) => (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0),
    );
  }
  return copy.sort((a, b) => a.name.localeCompare(b.name));
}

export type ClientFilterState = {
  health: "all" | "healthy" | "attention" | "quiet";
  minRevenue: "" | "gt0";
  active: "all" | "hasActive";
  q: string;
};

export function filterClients(clients: Client[], f: ClientFilterState): Client[] {
  return clients.filter((c) => {
    if (f.health !== "all" && c.health.state !== f.health) return false;
    if (f.minRevenue === "gt0" && c.totalRevenue <= 0) return false;
    if (f.active === "hasActive" && c.activeDeals.length === 0) return false;
    if (f.q.trim()) {
      const q = f.q.trim().toLowerCase();
      if (
        !c.name.toLowerCase().includes(q) &&
        !(c.primaryLead.name ?? "").toLowerCase().includes(q)
      )
        return false;
    }
    return true;
  });
}
