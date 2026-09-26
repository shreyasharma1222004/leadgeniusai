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

/** Status pills — warm neutrals, ink reserved for momentum & wins. */
export const LEAD_STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "border border-border bg-card text-muted-foreground",
  contacted: "border border-border bg-[#ece6d8] text-[#443f36]",
  replied: "border border-border bg-[#e9e2d2] text-[#3d382f]",
  interested: "border border-[#c9bfa6] bg-[#e2d9c4] text-[#332f27]",
  meeting: "border border-[#191713]/30 bg-[#191713]/85 text-[#f7f3ea]",
  won: "border border-[#191713] bg-[#191713] text-[#f7f3ea] shadow-[0_2px_8px_-3px_rgba(25,23,19,0.5)]",
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
