import {
  AIButton,
  AIInsightCard,
  FloatingSidePanel,
  LeadScoreRing,
} from "@/components/spatial";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { Doc } from "@/convex/_generated/dataModel";
import { initials, timeAgo } from "@/lib/format";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  statusClasses,
  statusLabel,
} from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import {
  CalendarClock,
  ChevronDown,
  ExternalLink,
  Globe,
  Mail,
  MapPin,
  Phone,
  Send,
} from "lucide-react";
import { useRef } from "react";
import { Link } from "react-router";

type Lead = Doc<"leads">;

/**
 * Layer-4 floating panel: clicking a lead in the table opens this instead of
 * navigating away. Full deep-linkable view stays at /leads/:id.
 */
export function LeadSidePanel({
  lead,
  onClose,
  onCompose,
  onAnalyze,
  onStatus,
}: {
  lead: Lead | null;
  onClose: () => void;
  onCompose: (lead: Lead) => void;
  onAnalyze: (lead: Lead) => void;
  onStatus: (lead: Lead, status: string) => void;
}) {
  // Keep the last non-null lead mounted so the close animation isn't empty.
  const lastRef = useRef<Lead | null>(null);
  if (lead) lastRef.current = lead;
  const shown = lead ?? lastRef.current;

  return (
    <FloatingSidePanel
      open={!!lead}
      onClose={onClose}
      title={
        shown ? (
          <span className="flex items-center gap-2">
            <span
              aria-hidden
              className="flex size-6 items-center justify-center rounded-full border border-border bg-muted text-[9px] font-semibold text-muted-foreground"
            >
              {initials(shown.name)}
            </span>
            {shown.name}
          </span>
        ) : (
          ""
        )
      }
    >
      {shown && (
        <div className="stage-enter space-y-4">
          {/* Identity */}
          <div>
            <p className="truncate text-base font-semibold tracking-tight">
              {shown.jobTitle ?? "Role unknown"}
              {shown.company ? ` @ ${shown.company}` : ""}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                  statusClasses(shown.status),
                )}
              >
                {statusLabel(shown.status)}
              </span>
              {shown.nextFollowUpAt && (
                <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                  <CalendarClock className="size-3" />
                  follow-up {timeAgo(shown.nextFollowUpAt)}
                </span>
              )}
            </div>
          </div>

          {/* Score */}
          {shown.score !== undefined ? (
            <div className="rounded-xl border border-border bg-white/[0.02] p-4">
              <LeadScoreRing
                score={shown.score}
                size={76}
                label={
                  shown.score >= 70
                    ? "High potential"
                    : shown.score >= 40
                      ? "Worth pursuing"
                      : "Needs nurturing"
                }
                breakdown={shown.scoreBreakdown}
              />
            </div>
          ) : (
            <AIButton onClick={() => onAnalyze(shown)}>Analyze this lead</AIButton>
          )}

          {/* AI insights */}
          {shown.summary && (
            <AIInsightCard title="Company Overview">
              <p className="text-sm leading-relaxed">{shown.summary}</p>
            </AIInsightCard>
          )}
          {shown.painPoints && shown.painPoints.length > 0 && (
            <AIInsightCard title="Potential Pain Points">
              <ul className="space-y-1.5">
                {shown.painPoints.map((p) => (
                  <li key={p} className="flex gap-2 text-sm">
                    <span className="mt-2 size-1 shrink-0 rounded-full bg-[#8B5CF6]" />
                    {p}
                  </li>
                ))}
              </ul>
            </AIInsightCard>
          )}
          {shown.signals && shown.signals.length > 0 && (
            <AIInsightCard title="Opportunity Signals">
              <div className="flex flex-wrap gap-1.5">
                {shown.signals.map((s) => (
                  <span
                    key={s}
                    className="rounded-full border border-[#67E8F9]/25 bg-[#67E8F9]/[0.06] px-2 py-0.5 text-[11px] text-[#a5f3fc]"
                  >
                    {s}
                  </span>
                ))}
              </div>
            </AIInsightCard>
          )}
          {shown.approach && (
            <AIInsightCard title="Suggested Sales Angle">
              <p className="text-sm leading-relaxed">{shown.approach}</p>
            </AIInsightCard>
          )}

          {/* Contact */}
          <div className="space-y-2 rounded-xl border border-border bg-white/[0.02] p-4 text-sm">
            <ContactRow icon={Mail} label="Email" value={shown.email} />
            <ContactRow icon={Phone} label="Phone" value={shown.phone} />
            <ContactRow icon={Globe} label="Website" value={shown.website} />
            <ContactRow icon={MapPin} label="Location" value={shown.location} />
            {shown.notes && (
              <p className="whitespace-pre-wrap border-t border-border pt-2 text-xs text-muted-foreground">
                {shown.notes}
              </p>
            )}
          </div>

          {/* Actions */}
          <div className="sticky bottom-0 flex flex-wrap gap-2 bg-gradient-to-t from-card via-card to-transparent pt-2">
            <AIButton onClick={() => onCompose(shown)}>
              <Send className="size-3.5" /> Compose outreach
            </AIButton>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" size="sm" className="h-9 gap-1.5">
                  Move to <ChevronDown className="size-3 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="depth-pop">
                <DropdownMenuLabel className="text-xs">Set stage</DropdownMenuLabel>
                <DropdownMenuSeparator />
                {LEAD_STATUSES.map((s) => (
                  <DropdownMenuItem key={s} onClick={() => onStatus(shown, s)}>
                    {LEAD_STATUS_LABELS[s]}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <Button asChild variant="outline" size="sm" className="h-9 gap-1.5">
              <Link to={`/leads/${shown._id}`}>
                <ExternalLink className="size-3.5" /> Full view
              </Link>
            </Button>
          </div>
        </div>
      )}
    </FloatingSidePanel>
  );
}

function ContactRow({
  icon: Icon,
  label,
  value,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value?: string;
}) {
  return (
    <div className="flex items-start gap-2">
      <dt className="label-caps flex w-16 shrink-0 items-center gap-1 pt-0.5 text-muted-foreground/70">
        <Icon className="size-3" /> {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate">
        {value ? (
          value
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </dd>
    </div>
  );
}
