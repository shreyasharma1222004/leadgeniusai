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

/** Spatial status pills — muted neutrals, violet reserved for momentum & wins. */
export const LEAD_STATUS_CLASSES: Record<LeadStatus, string> = {
  new: "border border-white/10 bg-white/[0.04] text-muted-foreground",
  contacted: "border border-[#67E8F9]/25 bg-[#67E8F9]/[0.08] text-[#a5f3fc]",
  replied: "border border-[#8B5CF6]/30 bg-[#8B5CF6]/[0.10] text-[#c4b5fd]",
  interested: "border border-[#A855F7]/35 bg-[#A855F7]/[0.12] text-[#d8b4fe]",
  meeting: "border border-[#FCD34D]/25 bg-[#FCD34D]/[0.08] text-[#fde68a]",
  won: "border border-[#8B5CF6]/60 bg-gradient-to-r from-[#8B5CF6]/30 to-[#A855F7]/30 text-[#e9d5ff] shadow-[0_0_14px_rgba(139,92,246,0.25)]",
  lost: "border border-white/[0.06] bg-white/[0.02] text-muted-foreground/70",
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
