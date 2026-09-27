// NOTE: this module is imported by both the browser AND Convex server
// functions. The Convex bundler does not resolve the "@/" alias, so every
// import here must be relative, and nothing may be imported from modules
// that themselves use "@/" imports (leadStatus.ts is alias-free and safe).
import type { Doc } from "../convex/_generated/dataModel";
import { canonicalStatus, isQualified } from "./leadStatus";

/**
 * Goal engine — production Phase 1 §2. Single source of truth for goal kinds,
 * period boundaries, and how a goal's CURRENT value is computed from real CRM
 * records. Used by the Convex `business.goalProgress` query and by the UI, so
 * a goal can never show a different number in two places.
 *
 * Rules:
 *  • Current values are only ever DERIVED from actual records — never stored,
 *    never manually entered.
 *  • If a metric can't be reliably derived (retention, qualitative custom
 *    goals), `current` is null and the UI labels it "unavailable" instead of
 *    inventing a number.
 *  • Period-scoped revenue/customers are dated by wonAt where the timestamp
 *    exists (Phase 2 §7). Won records that predate the timestamp keep the
 *    documented Phase 1 approximation (dated by lead creation), and the basis
 *    string says which is in effect — never silently mixed.
 */

export const GOAL_KINDS = [
  "revenue",
  "customers",
  "qualified_leads",
  "meetings",
  "conversion",
  "retention",
  "custom",
] as const;

export type GoalKind = (typeof GOAL_KINDS)[number];

export const GOAL_KIND_LABELS: Record<GoalKind, string> = {
  revenue: "Revenue",
  customers: "New customers",
  qualified_leads: "Qualified leads",
  meetings: "Meetings booked",
  conversion: "Conversion rate",
  retention: "Retention",
  custom: "Custom growth goal",
};

export const GOAL_PERIODS = ["month", "quarter", "year", "all_time"] as const;
export type GoalPeriod = (typeof GOAL_PERIODS)[number];

export const GOAL_PERIOD_LABELS: Record<GoalPeriod, string> = {
  month: "This month",
  quarter: "This quarter",
  year: "This year",
  all_time: "All time",
};

export const GOAL_STATUSES = ["active", "achieved", "paused"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** Start-of-period timestamp (UTC-safe calendar boundary), or null for all-time. */
export function periodStart(period: GoalPeriod, now = Date.now()): number | null {
  const d = new Date(now);
  switch (period) {
    case "month":
      return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).getTime();
    case "quarter":
      return new Date(
        Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1),
      ).getTime();
    case "year":
      return new Date(Date.UTC(d.getUTCFullYear(), 0, 1)).getTime();
    case "all_time":
      return null;
  }
}

export type GoalUnit = "money" | "count" | "percent";

export function goalUnit(kind: GoalKind): GoalUnit {
  switch (kind) {
    case "revenue":
      return "money";
    case "conversion":
      return "percent";
    default:
      return "count";
  }
}

export interface GoalCurrentResult {
  /** Derived current value, or null when not reliably measurable. */
  current: number | null;
  unit: GoalUnit;
  /** How this number was derived — shown in the UI for transparency. */
  basis: string;
  /** Present when the value is unavailable (why, in plain language). */
  unavailableReason?: string;
}

type LeadRow = Pick<
  Doc<"leads">,
  "status" | "dealValue" | "_creationTime" | "score" | "wonAt"
>;

/**
 * Whether a lead counts toward a period-scoped metric.
 *
 * Phase 2 (§7): deals closed AFTER wonAt existed are dated by their wonAt
 * timestamp (the honest, correct basis — "closed in this period"). Older
 * won/lost rows without a wonAt keep the documented Phase 1 approximation:
 * they count in the period their lead was created, and the UI says so.
 * Deals with neither (open deals) are excluded by the callers' status filters.
 */
function inPeriod(lead: LeadRow, start: number | null): boolean {
  if (start === null) return true;
  const closedAt =
    canonicalStatus(lead.status) === "won" && lead.wonAt !== undefined
      ? lead.wonAt
      : undefined;
  return (closedAt ?? lead._creationTime) >= start;
}

/**
 * Compute a goal's current value from real records. `leads` must be the
 * authenticated user's own leads — callers enforce ownership.
 */
export function computeGoalCurrent(
  kind: GoalKind,
  period: GoalPeriod,
  leads: LeadRow[],
  now = Date.now(),
): GoalCurrentResult {
  const start = periodStart(period, now);
  const created = leads.filter((l) => inPeriod(l, start));

  switch (kind) {
    case "revenue": {
      const won = created.filter((l) => canonicalStatus(l.status) === "won");
      const valued = won.filter((l) => l.dealValue !== undefined);
      const dated = won.filter((l) => l.wonAt !== undefined).length;
      return {
        current: won.reduce((s, l) => s + (l.dealValue ?? 0), 0),
        unit: "money",
        basis:
          period === "all_time"
            ? "sum of deal value on won deals"
            : dated === won.length && won.length > 0
              ? "deal value on deals closed (won) this period"
              : "deal value on won deals created this period — older records predate won-at timestamps, so they're dated by lead creation",
        unavailableReason:
          won.length > 0 && valued.length === 0
            ? "Won deals exist but none have a deal value set — add values in Pipeline to track revenue."
            : undefined,
      };
    }    case "customers": {
      const won = created.filter((l) => canonicalStatus(l.status) === "won");
      const dated = won.filter((l) => l.wonAt !== undefined).length;
      return {
        current: won.length,
        unit: "count",
        basis:
          period === "all_time"
            ? "leads marked Won"
            : dated === won.length && won.length > 0
              ? "deals closed (won) this period"
              : "leads created this period now marked Won",
      };
    }
    case "qualified_leads": {
      const qualified = created.filter((l) => isQualified(l.status));
      return {
        current: qualified.length,
        unit: "count",
        basis:
          period === "all_time"
            ? "leads at Qualified stage or beyond"
            : "leads created this period now at Qualified or beyond",
      };
    }
    case "meetings": {
      const meetings = created.filter((l) =>
        ["proposal", "interested", "won"].includes(canonicalStatus(l.status)),
      );
      return {
        current: meetings.length,
        unit: "count",
        basis:
          period === "all_time"
            ? "leads at Proposal stage or beyond"
            : "leads created this period now at Proposal or beyond",
      };
    }
    case "conversion": {
      const won = created.filter((l) => canonicalStatus(l.status) === "won").length;
      return {
        current: created.length ? Math.round((won / created.length) * 100) : 0,
        unit: "percent",
        basis:
          period === "all_time"
            ? "won ÷ total leads, all time"
            : "won ÷ leads created this period",
      };
    }
    case "retention":
      return {
        current: null,
        unit: "count",
        basis: "",
        unavailableReason:
          "Retention can't be derived yet — the CRM doesn't track repeat purchases or churn.",
      };
    case "custom":
      return {
        current: null,
        unit: "count",
        basis: "",
        unavailableReason:
          "Custom goals aren't auto-measured — track this one manually or pick a measurable kind.",
      };
  }
}

/**
 * Compact currency formatting for goal values. Kept local (rather than
 * importing from growth.ts) because goalEngine is bundled server-side too —
 * mirrors money() in growth.ts exactly, including the Phase 2 currency
 * parameter and the neutral "¤" fallback for an unset workspace currency.
 */
const NEUTRAL_CURRENCY = "¤";
const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "€",
  GBP: "£",
  INR: "₹",
  CAD: "CA$",
  AUD: "A$",
  JPY: "¥",
};

function moneyCompact(n: number, currency?: string | null): string {
  let sym = NEUTRAL_CURRENCY;
  if (currency) {
    const code = currency.trim().toUpperCase();
    if (code) sym = CURRENCY_SYMBOLS[code] ?? `${code} `;
  }
  if (Math.abs(n) >= 1_000_000) return `${sym}${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `${sym}${Math.round(n / 1_000)}k`;
  return `${sym}${n.toLocaleString()}`;
}

/** Format a goal value per its unit (money/percent/count). */
export function formatGoalValue(
  value: number,
  unit: GoalUnit,
  currency?: string | null,
): string {
  if (unit === "money") return moneyCompact(value, currency);
  if (unit === "percent") return `${value}%`;
  return value.toLocaleString();
}

/** Progress fraction 0–1 (clamped) for a measurable goal. */
export function goalProgressFraction(
  current: number | null,
  target: number | undefined,
): number | null {
  if (current === null || target === undefined || target <= 0) return null;
  return Math.max(0, Math.min(1, current / target));
}
