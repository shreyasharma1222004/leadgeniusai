/** Lead pipeline stages, shared between the UI and server functions. */
export const LEAD_STATUSES = [
  "new",
  "contacted",
  "replied",
  "interested",
  "meeting",
  "won",
  "lost",
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

export const LEAD_STATUS_VALUES: readonly string[] = LEAD_STATUSES;

export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: "New",
  contacted: "Contacted",
  replied: "Replied",
  interested: "Interested",
  meeting: "Meeting",
  won: "Won",
  lost: "Lost",
};

/** Status pills — warm neutrals; plum = momentum, olive = won. */
export const LEAD_STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "border border-border bg-card text-muted-foreground",
  contacted: "border border-border bg-secondary text-secondary-foreground",
  replied: "border border-[#6f4b5e]/25 bg-[#6f4b5e]/[0.07] text-[#6f4b5e]",
  interested: "border border-[#6f4b5e]/40 bg-[#6f4b5e]/[0.13] text-[#5d3e4e]",
  meeting: "border border-[#a06b3c]/35 bg-[#a06b3c]/[0.1] text-[#82552e]",
  won: "border border-[#53634a]/45 bg-[#53634a]/[0.14] text-[#42503c]",
  lost: "border border-border bg-transparent text-muted-foreground/60 line-through decoration-border",
};

export function statusLabel(status: string): string {
  return LEAD_STATUS_LABELS[status as LeadStatus] ?? status;
}

export function statusClasses(status: string): string {
  return (
    LEAD_STATUS_CLASSES[status as LeadStatus] ??
    "bg-secondary text-secondary-foreground"
  );
}
