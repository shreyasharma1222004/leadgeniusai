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

/** Studio status pill classes — monochrome first, lime reserved for win states. */
export const LEAD_STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "bg-secondary text-secondary-foreground",
  contacted: "bg-secondary text-secondary-foreground",
  replied: "bg-[#EFEAD9] text-[#4A4636]",
  interested: "bg-[#E9F5C8] text-[#42521A]",
  meeting: "bg-[#F0F9C8] text-[#3F4E15]",
  won: "bg-[#D4FF4F] text-[#191918]",
  lost: "bg-[#EFEDE8] text-[#8A867B]",
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
