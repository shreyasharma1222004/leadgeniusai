/**
 * Lead / deal pipeline stages, shared between the UI and server functions.
 *
 * The CRM pipeline: New → Qualified → Discovery → Proposal → Negotiation → Won/Lost.
 * Legacy statuses are valid data values surfaced under their canonical names so no
 * data migration is ever REQUIRED — but a server-side migration exists and old
 * records are normalized opportunistically (see PIPELINE_ORDER note below):
 *   contacted   → "Qualified"   (first touch made, worth pursuing)
 *   interested  → "Negotiation" (warm lead deep in conversation)
 *   replied     → "Discovery"   (pre-2025-09 inbox logs; reply = engaged)
 *   meeting     → "Proposal"    (pre-2025-09 inbox logs; meeting requested = proposal talk)
 * New records use the canonical stages below only.
 */

/** Legacy status values still present in old records → their canonical stage. */
export const LEGACY_STATUS_MAP: Record<string, LeadStatus> = {
  replied: "discovery",
  meeting: "proposal",
};

/**
 * Map any status value (canonical or legacy) to a canonical pipeline stage.
 * Shared by the UI (grouping/labels) and server mutations (writes) so Leads and
 * Pipeline can never disagree about what a lead's stage is.
 */
export function canonicalStatus(status: string): LeadStatus {
  return LEGACY_STATUS_MAP[status] ?? (status as LeadStatus);
}
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "discovery",
  "proposal",
  "interested",
  "won",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_VALUES: readonly string[] = LEAD_STATUSES;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Qualified",
  discovery: "Discovery",
  proposal: "Proposal",
  interested: "Negotiation",
  won: "Won",
  lost: "Lost",
};

/** Status pills — warm neutrals; plum = momentum, caramel = discovery, olive = won. */
export const LEAD_STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "border border-border bg-card text-muted-foreground",
  contacted: "border border-border bg-secondary text-secondary-foreground",
  discovery: "border border-[#a06b3c]/35 bg-[#a06b3c]/[0.1] text-[#82552e]",
  proposal: "border border-[#6f4b5e]/25 bg-[#6f4b5e]/[0.07] text-[#6f4b5e]",
  interested: "border border-[#6f4b5e]/40 bg-[#6f4b5e]/[0.13] text-[#5d3e4e]",
  won: "border border-[#53634a]/45 bg-[#53634a]/[0.14] text-[#42503c]",
  lost: "border border-border bg-transparent text-muted-foreground/60 line-through decoration-border",
};

/** Label for any status value — legacy values resolve to their canonical label. */
export function statusLabel(status: string): string {
  const canonical = canonicalStatus(status);
  return LEAD_STATUS_LABELS[canonical] ?? canonical;
}

export function statusClasses(status: string): string {
  return (
    LEAD_STATUS_CLASSES[canonicalStatus(status)] ??
    "bg-secondary text-secondary-foreground"
  );
}

/**
 * Canonical column order for the kanban / funnel: the 8 pipeline stages in
 * CRM order. "interested" (Negotiation) sits between Proposal and Won.
 */
export const PIPELINE_ORDER: LeadStatus[] = [
  "new",
  "contacted",
  "discovery",
  "proposal",
  "interested",
  "won",
  "lost",
];

/** Stages that count as "active opportunities" (not closed). */
export const OPEN_STATUSES: readonly string[] = [
  "new",
  "contacted",
  "discovery",
  "proposal",
  "interested",
];

/** Stages past qualification — these count as pipeline value. */
export const PIPELINE_VALUE_STATUSES: readonly string[] = [
  "discovery",
  "proposal",
  "interested",
];

/**
 * Stages that count as "replied / engaged" for reply-rate metrics: a lead that
 * has moved into Discovery or beyond without closing. Documented definition —
 * see §Metric definitions in src/lib/growth.ts.
 */
export const REPLIED_STATUSES: readonly string[] = [
  "discovery",
  "proposal",
  "interested",
  "won",
];

/**
 * Sensible default close probability per stage (0–100). Used to suggest a
 * value when none is set and to compute weighted pipeline. Estimates, not
 * facts — labelled as such wherever shown.
 */
export const DEFAULT_PROBABILITY: Record<LeadStatus, number> = {
  new: 5,
  contacted: 15,
  discovery: 35,
  proposal: 55,
  interested: 75,
  won: 100,
  lost: 0,
};

export function defaultProbability(status: string): number {
  return DEFAULT_PROBABILITY[canonicalStatus(status)] ?? 10;
}

/** Weighted deal value = value × probability. */
export function weightedValue(dealValue: number | undefined, probability: number | undefined, status: string): number {
  if (!dealValue) return 0;
  const p = probability ?? defaultProbability(status);
  return Math.round(dealValue * (p / 100));
}

/** Whether a lead counts as "qualified" for KPI purposes. */
export function isQualified(status: string): boolean {
  return ["contacted", "discovery", "proposal", "interested", "won"].includes(
    canonicalStatus(status),
  );
}
