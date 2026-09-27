// NOTE: kept alias-free (relative imports only) like goalEngine.ts so this
// module can be imported by Convex server functions as well as the browser.
import type { Doc } from "../convex/_generated/dataModel";
import {
  OPEN_STATUSES,
  PIPELINE_VALUE_STATUSES,
  canonicalStatus,
  weightedValue,
} from "./leadStatus";

/**
 * ── Revenue intelligence (Phase 2 §6–§11) ──────────────────────────────────
 *
 * ONE source of truth for every revenue/deal metric. All functions are pure
 * computations over real persisted records — nothing here invents data:
 *
 *   pipelineValue      MONEY: Σ dealValue over OPEN deals (canonical stage
 *                      not won/lost). Raw, unweighted. Matches the Pipeline
 *                      board total exactly.
 *   weightedPipeline   MONEY ESTIMATE: Σ dealValue × probability over open
 *                      deals. ALWAYS labeled an estimate in the UI.
 *   wonRevenue         MONEY: Σ dealValue on won deals. Actual closed revenue.
 *   period won revenue Dated by wonAt (§7). Deals without wonAt (closed
 *                      before the timestamp existed) are EXCLUDED from
 *                      period-scoped numbers rather than guessed at — they
 *                      still count in all-time totals.
 *   winRate            RATE: won ÷ (won + lost) — closed deals only.
 *   conversionRate     RATE: won ÷ all leads. DIFFERENT metric, different
 *                      label — never mixed with winRate.
 *   avgDealSize        MONEY: wonRevenue ÷ won deals that have a value.
 *   salesCycle         DAYS: wonAt − _creationTime, only for deals where both
 *                      timestamps exist.
 *
 * Stall/aging thresholds live in REVENUE_THRESHOLDS so no component hardcodes
 * its own numbers. Every flagged state carries a transparent, human-readable
 * reason — never an opaque AI judgment.
 */

type Lead = Doc<"leads">;
type Proposal = Doc<"proposals">;

export type StageEvent = {
  _id: string;
  leadId: string;
  from?: string;
  to: string;
  at: number;
};

const DAY = 24 * 60 * 60 * 1000;

/**
 * Centralized thresholds (§10) — the single place these numbers live.
 * Tuning here changes every page at once.
 */
export const REVENUE_THRESHOLDS = {
  /** Open deal with no recorded activity for this many days → stalled. */
  stallDaysNoActivity: 14,
  /** Days in the current stage (where stage history exists) before stalled. */
  stallDaysInStage: 21,
  /** Expected close within this many days → "close approaching". */
  closeSoonDays: 14,
  /** Expected close in the past → "close date passed". */
  closePassedDays: 0,
  /** Client with no activity for this many days → needs attention (§17/§18). */
  clientInactiveDays: 21,
  /** Client activity within this many days → healthy signal. */
  clientHealthyDays: 10,
  /** Proposal sent this many days ago with no recorded movement → nudge. */
  proposalQuietDays: 4,
} as const;

// ── Open / closed predicates (shared everywhere) ────────────────────────────

export function isOpenDeal(lead: Lead): boolean {
  return OPEN_STATUSES.includes(canonicalStatus(lead.status));
}

export function isWonDeal(lead: Lead): boolean {
  return canonicalStatus(lead.status) === "won";
}

export function isLostDeal(lead: Lead): boolean {
  return canonicalStatus(lead.status) === "lost";
}

/** Display name for a deal: explicit dealName, else contact + company. */
export function dealTitle(lead: Lead): string {
  if (lead.dealName) return lead.dealName;
  return lead.company ? `${lead.company} — ${lead.name}` : lead.name;
}

/**
 * Effective currency for one deal (Phase 2 cleanup item 2): the deal's own
 * persisted currency when set, else the workspace currency from the business
 * profile, else undefined (which money() renders with the documented neutral
 * marker rather than an invented default).
 */
export function dealCurrency(
  lead: { currency?: string },
  workspaceCurrency?: string | null,
): string | undefined {
  return lead.currency ?? workspaceCurrency ?? undefined;
}

/** Last known activity timestamp for a deal, from any recorded signal. */
export function lastActivityOf(lead: Lead): number | undefined {
  return lead.lastActivityAt ?? lead.lastContactedAt;
}

// ── Deal flags (§10/§23) — transparent reasons, centralized thresholds ──────

export type DealFlagKind =
  | "stalled"
  | "closePassed"
  | "closeSoon"
  | "proposalPending";

export interface DealFlag {
  kind: DealFlagKind;
  detail: string;
}

/**
 * Compute the health flags for one open deal. Order matters: the first flag
 * is the "primary" signal a card should show when space is tight. Flags are
 * capped by the caller — avoid badge spam (§23).
 */
export function dealFlags(
  lead: Lead,
  context: { now?: number; lastStageAt?: number; proposalPending?: boolean } = {},
): DealFlag[] {
  const now = context.now ?? Date.now();
  const flags: DealFlag[] = [];

  const last = lastActivityOf(lead);
  const daysQuiet =
    last !== undefined ? Math.floor((now - last) / DAY) : undefined;

  // 1. Expected close passed — the clearest at-risk signal.
  if (lead.expectedCloseAt !== undefined && now > lead.expectedCloseAt) {
    const days = Math.floor((now - lead.expectedCloseAt) / DAY);
    flags.push({
      kind: "closePassed",
      detail: `Close date passed ${days > 0 ? `${days}d ago` : "today"} — expected ${new Date(lead.expectedCloseAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}`,
    });
  }

  // 2. Stalled: no activity for N days. If stage history exists for this
  //    deal, a long time in the current stage also counts.
  if (
    daysQuiet !== undefined &&
    daysQuiet >= REVENUE_THRESHOLDS.stallDaysNoActivity
  ) {
    flags.push({
      kind: "stalled",
      detail: `No activity for ${daysQuiet} days`,
    });
  } else if (
    context.lastStageAt !== undefined &&
    now - context.lastStageAt >= REVENUE_THRESHOLDS.stallDaysInStage * DAY
  ) {
    const days = Math.floor((now - context.lastStageAt) / DAY);
    flags.push({
      kind: "stalled",
      detail: `In this stage for ${days} days`,
    });
  }

  // 3. Close approaching — an opportunity, not a problem.
  if (
    lead.expectedCloseAt !== undefined &&
    lead.expectedCloseAt >= now &&
    lead.expectedCloseAt <= now + REVENUE_THRESHOLDS.closeSoonDays * DAY
  ) {
    const days = Math.ceil((lead.expectedCloseAt - now) / DAY);
    flags.push({
      kind: "closeSoon",
      detail: days <= 0 ? "Expected to close today" : `Expected close in ${days} day${days === 1 ? "" : "s"}`,
    });
  }

  // 4. A sent proposal is waiting on this deal.
  if (context.proposalPending) {
    flags.push({
      kind: "proposalPending",
      detail: "Proposal sent — awaiting response",
    });
  }

  return flags;
}

/** Tone classes per flag kind — shared by cards, tables and lists. */
export const DEAL_FLAG_CLASSES: Record<DealFlagKind, string> = {
  stalled: "border-[#a8442f]/40 bg-[#a8442f]/[0.08] text-[#a8442f]",
  closePassed: "border-[#a8442f]/50 bg-[#a8442f]/[0.12] text-[#a8442f]",
  closeSoon: "border-[#a06b3c]/40 bg-[#a06b3c]/[0.1] text-[#82552e]",
  proposalPending: "border-[#6f4b5e]/35 bg-[#6f4b5e]/[0.08] text-[#6f4b5e]",
};

export const DEAL_FLAG_LABELS: Record<DealFlagKind, string> = {
  stalled: "Stalled",
  closePassed: "Close date passed",
  closeSoon: "Closing soon",
  proposalPending: "Proposal pending",
};

// ── Closed revenue (§7/§8) — wonAt/lostAt-based, honest about gaps ─────────

export interface ClosedStats {
  wonRevenue: number;
  lostValue: number;
  wonCount: number;
  lostCount: number;
  /** Won deals that actually carry a value — the avg-deal-size denominator. */
  valuedWonCount: number;
  avgDealSize: number | null;
  /**
   * Won deals closed BEFORE wonAt existed (no timestamp). They count toward
   * all-time totals but are excluded from period-scoped revenue.
   */
  undatedWonCount: number;
  /** won ÷ (won + lost). null when nothing has closed yet ("Not enough data yet"). */
  winRate: number | null;
  /** Average sales cycle in days (wonAt − creation), where both exist. */
  avgSalesCycleDays: number | null;
  medianSalesCycleDays: number | null;
  /** Deals the sales-cycle numbers are computed from. */
  salesCycleSample: number;
}

export function computeClosedStats(leads: Lead[]): ClosedStats {
  const won = leads.filter(isWonDeal);
  const lost = leads.filter(isLostDeal);
  const valued = won.filter((l) => l.dealValue !== undefined);
  const wonRevenue = won.reduce((s, l) => s + (l.dealValue ?? 0), 0);

  const cycles = won
    .filter((l) => l.wonAt !== undefined)
    .map((l) => ((l.wonAt ?? 0) - l._creationTime) / DAY)
    .filter((d) => d >= 0)
    .sort((a, b) => a - b);

  const avg =
    cycles.length > 0
      ? Math.round(cycles.reduce((s, d) => s + d, 0) / cycles.length)
      : null;
  const median =
    cycles.length > 0
      ? Math.round(
          cycles.length % 2 === 1
            ? cycles[(cycles.length - 1) / 2]
            : (cycles[cycles.length / 2 - 1] + cycles[cycles.length / 2]) / 2,
        )
      : null;

  return {
    wonRevenue,
    lostValue: lost.reduce((s, l) => s + (l.dealValue ?? 0), 0),
    wonCount: won.length,
    lostCount: lost.length,
    valuedWonCount: valued.length,
    avgDealSize: valued.length ? Math.round(wonRevenue / valued.length) : null,
    undatedWonCount: won.filter((l) => l.wonAt === undefined).length,
    winRate: won.length + lost.length > 0 ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
    avgSalesCycleDays: avg,
    medianSalesCycleDays: median,
    salesCycleSample: cycles.length,
  };
}

/**
 * Won revenue closed within a period, dated by wonAt. `start === null` means
 * all time. Undated legacy wins are NOT silently folded in — the count of
 * excluded deals is returned so the UI can disclose the limitation.
 */
export function wonRevenueInPeriod(
  leads: Lead[],
  start: number | null,
  now = Date.now(),
): { revenue: number; deals: number; undatedExcluded: number } {
  const won = leads.filter(isWonDeal);
  if (start === null) {
    return {
      revenue: won.reduce((s, l) => s + (l.dealValue ?? 0), 0),
      deals: won.length,
      undatedExcluded: 0,
    };
  }
  const dated = won.filter((l) => l.wonAt !== undefined && l.wonAt >= start);
  const undated = won.filter((l) => l.wonAt === undefined);
  return {
    revenue: dated.reduce((s, l) => s + (l.dealValue ?? 0), 0),
    deals: dated.length,
    undatedExcluded: undated.length,
  };
}

// ── Pipeline (§6) ───────────────────────────────────────────────────────────

export interface PipelineStats {
  /** Σ dealValue over open deals. */
  pipelineValue: number;
  /** Σ value × probability over open deals. ESTIMATE — label it. */
  weightedPipeline: number;
  /** All open deals (any open stage). */
  openDeals: number;
  /** Open deals past qualification — the "active opportunities" count. */
  openOpportunities: number;
  /** Open deals with an expected close date. */
  datedDeals: number;
}

export function computePipelineStats(leads: Lead[]): PipelineStats {
  const open = leads.filter(isOpenDeal);
  return {
    pipelineValue: open.reduce((s, l) => s + (l.dealValue ?? 0), 0),
    weightedPipeline: open.reduce(
      (s, l) => s + weightedValue(l.dealValue, l.probability, l.status),
      0,
    ),
    openDeals: open.length,
    openOpportunities: open.filter((l) =>
      PIPELINE_VALUE_STATUSES.includes(canonicalStatus(l.status)),
    ).length,
    datedDeals: open.filter((l) => l.expectedCloseAt !== undefined).length,
  };
}

// ── Forecast (§11) — transparent arithmetic, no invented future revenue ─────

export interface Forecast {
  /** Closed won revenue only — an actual, not a prediction. */
  conservative: number;
  /** Won revenue + weighted open pipeline. An estimate. */
  weighted: number;
}

export function computeForecast(closed: ClosedStats, pipeline: PipelineStats): Forecast {
  return {
    conservative: closed.wonRevenue,
    weighted: closed.wonRevenue + pipeline.weightedPipeline,
  };
}

// ── Breakdowns (§9) — only real attribution, "No attribution data yet" ──────

export type BreakdownDimension =
  | "source"
  | "campaign"
  | "industry"
  | "company"
  | "stage";

export interface BreakdownRow {
  /** null = unattributed records ("No attribution data yet" bucket). */
  key: string | null;
  label: string;
  count: number;
  pipeline: number;
  won: number;
  lost: number;
}

/**
 * Group deals by a dimension. Records missing that dimension land in a null
 * key row — the UI renders them as "No attribution data yet" rather than
 * assigning a default source (§9).
 */
export function revenueBreakdown(
  leads: Lead[],
  dimension: BreakdownDimension,
  campaignNames: Map<string, string> = new Map(),
): BreakdownRow[] {
  const buckets = new Map<string | null, BreakdownRow>();
  const add = (key: string | null, label: string, lead: Lead, money: "pipeline" | "won" | "lost") => {
    let row = buckets.get(key);
    if (!row) {
      row = { key, label, count: 0, pipeline: 0, won: 0, lost: 0 };
      buckets.set(key, row);
    }
    row.count++;
    const v = lead.dealValue ?? 0;
    if (money === "pipeline") row.pipeline += v;
    else if (money === "won") row.won += v;
    else row.lost += v;
  };

  for (const lead of leads) {
    const won = isWonDeal(lead) && lead.dealValue !== undefined;
    const lost = isLostDeal(lead) && lead.dealValue !== undefined;
    if (!won && !lost && !isOpenDeal(lead)) continue;
    const bucket = won ? "won" : lost ? "lost" : "pipeline";
    switch (dimension) {
      case "source":
        add(lead.source?.trim() || null, lead.source?.trim() || "No source set", lead, bucket);
        break;
      case "campaign":
        if (lead.campaignId) {
          const name = campaignNames.get(lead.campaignId) ?? "Campaign";
          add(lead.campaignId, name, lead, bucket);
        } else {
          add(null, "No campaign attribution", lead, bucket);
        }
        break;
      case "industry":
        add(lead.industry?.trim() || null, lead.industry?.trim() || "No industry set", lead, bucket);
        break;
      case "company":
        add(lead.company?.trim() || null, lead.company?.trim() || "No company set", lead, bucket);
        break;
      case "stage": {
        const s = canonicalStatus(lead.status);
        add(s, s, lead, bucket);
        break;
      }
    }
  }
  return [...buckets.values()].sort(
    (a, b) => b.won + b.pipeline - (a.won + a.pipeline),
  );
}

// ── Pipeline aging (§10) ────────────────────────────────────────────────────

export interface AgingBucket {
  key: "fresh" | "under2w" | "under1m" | "under3m" | "older";
  label: string;
  count: number;
  value: number;
}

/** Open deals bucketed by days since creation (real timestamps only). */
export function pipelineAging(leads: Lead[], now = Date.now()): AgingBucket[] {
  const buckets: AgingBucket[] = [
    { key: "fresh", label: "Under 1 week", count: 0, value: 0 },
    { key: "under2w", label: "1–2 weeks", count: 0, value: 0 },
    { key: "under1m", label: "2–4 weeks", count: 0, value: 0 },
    { key: "under3m", label: "1–3 months", count: 0, value: 0 },
    { key: "older", label: "3+ months", count: 0, value: 0 },
  ];
  for (const lead of leads.filter(isOpenDeal)) {
    const days = (now - lead._creationTime) / DAY;
    const b =
      days < 7
        ? buckets[0]
        : days < 14
          ? buckets[1]
          : days < 30
            ? buckets[2]
            : days < 90
              ? buckets[3]
              : buckets[4];
    b.count++;
    b.value += lead.dealValue ?? 0;
  }
  return buckets;
}

// ── Stalled deals (§10) — every row carries its reason ──────────────────────

export interface FlaggedDeal {
  lead: Lead;
  flags: DealFlag[];
}

/**
 * All open deals with their health flags, worst first. `stageLastAt` maps a
 * leadId to when it entered its CURRENT stage (from dealStageHistory) — deals
 * without history simply skip the stage-duration rule instead of guessing.
 */
export function flaggedOpenDeals(
  leads: Lead[],
  stageLastAt: Map<string, number>,
  proposals: Proposal[] = [],
  now = Date.now(),
): FlaggedDeal[] {
  const pendingByDeal = new Map<string, boolean>();
  for (const p of proposals) {
    if (p.status === "sent" || p.status === "viewed") {
      pendingByDeal.set(p.dealId, true);
    }
  }
  const out: FlaggedDeal[] = [];
  for (const lead of leads.filter(isOpenDeal)) {
    const flags = dealFlags(lead, {
      now,
      lastStageAt: stageLastAt.get(lead._id),
      proposalPending: pendingByDeal.get(lead._id),
    });
    if (flags.length > 0) out.push({ lead, flags });
  }
  // Most at-risk first: close passed > stalled > close soon > proposal pending.
  const rank = (f: DealFlag) =>
    f.kind === "closePassed" ? 0 : f.kind === "stalled" ? 1 : f.kind === "closeSoon" ? 2 : 3;
  return out.sort(
    (a, b) =>
      rank(a.flags[0]) - rank(b.flags[0]) ||
      (b.lead.dealValue ?? 0) - (a.lead.dealValue ?? 0),
  );
}

/** Map leadId → when it most recently entered its current stage. */
export function stageLastAtMap(events: StageEvent[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const e of events) {
    const prev = m.get(e.leadId);
    if (prev === undefined || e.at > prev) m.set(e.leadId, e.at);
  }
  return m;
}
