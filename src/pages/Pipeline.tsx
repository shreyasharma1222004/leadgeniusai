import { AppShell } from "@/components/AppShell";
import { SPRING, SPRING_SOFT } from "@/components/spatial";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { currencySymbol, money } from "@/lib/growth";
import { dealCurrency } from "@/lib/revenue";
import { timeAgo } from "@/lib/format";
import {
  LEAD_STATUS_LABELS,
  PIPELINE_ORDER,
  canonicalStatus,
  defaultProbability,
  statusClasses,
  weightedValue,
} from "@/lib/leadStatus";
import {
  DEAL_FLAG_CLASSES,
  DEAL_FLAG_LABELS,
  dealFlags,
  isOpenDeal,
  lastActivityOf,
  stageLastAtMap,
} from "@/lib/revenue";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { CircleDollarSign, Filter, Users, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Lead = Doc<"leads">;

type HealthFilter = "all" | "at_risk" | "stalled" | "closing" | "healthy";

export default function PipelinePage() {
  const { isLoading: authLoading } = useAuth();
  const leads = useQuery(api.leads.list, {});
  const bulkSetStatus = useMutation(api.leads.bulkSetStatus);
  const updateDeal = useMutation(api.leads.updateDeal);
  const migrateStatuses = useMutation(api.leads.migrateStatuses);
  const history = useQuery(api.leads.stageHistoryForUser, {});
  const proposals = useQuery(api.proposals.list, {});
  const profile = useQuery(api.business.myProfile, {});
  const workspaceCurrency = profile?.currency ?? undefined;
  const [dragId, setDragId] = useState<Id<"leads"> | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [minValue, setMinValue] = useState("");
  const [closeWithin, setCloseWithin] = useState("");
  const [health, setHealth] = useState<HealthFilter>("all");
  const [source, setSource] = useState("");

  // One-time legacy-stage normalization (replied/meeting → discovery/proposal).
  // Idempotent: a no-op once every row is canonical. Read-time canonicalization
  // below keeps old rows visible even before this runs.
  const hasLegacy =
    leads !== undefined && leads.some((l) => canonicalStatus(l.status) !== l.status);
  useEffect(() => {
    if (hasLegacy) void migrateStatuses({});
  }, [hasLegacy, migrateStatuses]);

  // Stage history → when each deal entered its current stage (for stall rules).
  const stageLastAt = useMemo(
    () => stageLastAtMap(history ?? []),
    [history],
  );

  if (authLoading || leads === undefined) {
    return (
      <AppShell title="Pipeline">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {PIPELINE_ORDER.map((s) => (
            <Skeleton key={s} className="h-64 rounded-xl" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (leads.length === 0) {
    return (
      <AppShell title="Pipeline">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <Users className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No deals on the board.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add leads first — then drag them from New toward Won as deals progress.
          </p>
          <Button asChild className="mt-5">
            <Link to="/leads">Go to leads</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const pendingProposals = new Set(
    (proposals ?? [])
      .filter((p) => p.status === "sent" || p.status === "viewed")
      .map((p) => p.dealId),
  );

  const hasFilter =
    minValue !== "" || closeWithin !== "" || health !== "all" || source.trim() !== "";

  const matchesFilters = (lead: Lead) => {
    if (minValue !== "" && (lead.dealValue ?? 0) < Number(minValue)) return false;
    if (closeWithin !== "") {
      // Undated deals are excluded when filtering by close window.
      if (lead.expectedCloseAt === undefined) return false;
      const days = (lead.expectedCloseAt - Date.now()) / 86_400_000;
      if (days > Number(closeWithin)) return false;
    }
    if (source.trim() && (lead.source ?? "").toLowerCase() !== source.trim().toLowerCase())
      return false;
    if (health !== "all") {
      if (!isOpenDeal(lead)) return false;
      // Single source of truth: the same dealFlags the cards render.
      const kinds = dealFlags(lead, {
        lastStageAt: stageLastAt.get(lead._id as string),
        proposalPending: pendingProposals.has(lead._id),
      }).map((f) => f.kind);
      if (health === "at_risk" && !kinds.includes("closePassed")) return false;
      if (health === "stalled" && !kinds.includes("stalled")) return false;
      if (health === "closing" && !kinds.includes("closeSoon")) return false;
      if (health === "healthy" && kinds.length > 0) return false;
    }
    return true;
  };

  const handleDrop = async (status: string) => {
    setOverColumn(null);
    if (!dragId) return;
    const lead = leads.find((l) => l._id === dragId);
    setDragId(null);
    if (!lead || lead.status === status) return;
    try {
      await bulkSetStatus({ ids: [dragId], status });
      // First time a deal enters a value stage without a value, suggest one by nudging.
      if (status === "won") {
        toast.success("✓ Deal closed", {
          description: `Nice — ${lead.name} moved to Won.${lead.dealValue === undefined ? " Add its value so revenue is counted." : ""}`,
        });
      } else {
        toast(`${lead.name} → ${LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status}`);
      }
    } catch {
      toast.error("Couldn't move that card — try again.");
    }
  };

  // Group by canonical stage so legacy rows (replied/meeting/qualified/
  // negotiation) always land in a visible column.
  const byCanonicalStage = (status: string) =>
    leads.filter((l) => canonicalStatus(l.status) === status && matchesFilters(l));

  // Column totals — computed on the UNFILTERED open set so header money stays
  // true regardless of view filters (§27: one definition everywhere).
  // Currency: workspace default; per-deal overrides only apply per card.
  const colTotal = (status: string) =>
    leads
      .filter((l) => canonicalStatus(l.status) === status)
      .reduce((s, l) => s + (l.dealValue ?? 0), 0);
  const weightedTotal = leads
    .filter((l) => isOpenDeal(l))
    .reduce(
      (s, l) => s + weightedValue(l.dealValue, l.probability, canonicalStatus(l.status)),
      0,
    );
  const pipelineTotal = leads
    .filter((l) => isOpenDeal(l))
    .reduce((s, l) => s + (l.dealValue ?? 0), 0);

  return (
    <AppShell
      title="Pipeline"
      actions={
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            Open pipeline <span className="tabular font-semibold text-foreground">{money(pipelineTotal, workspaceCurrency)}</span>
          </span>
          <span className="hidden md:inline">
            Weighted <span className="tabular font-semibold text-foreground">{money(weightedTotal, workspaceCurrency)}</span>
            <span className="ml-1 text-[10px] text-muted-foreground/60">(estimate)</span>
          </span>
          <Button
            variant={hasFilter ? "default" : "outline"}
            size="sm"
            className="h-8"
            onClick={() => setFiltersOpen((o) => !o)}
          >
            <Filter className="size-3.5" /> Filters
            {hasFilter && <X className="size-3" onClick={(e) => { e.stopPropagation(); setMinValue(""); setCloseWithin(""); setHealth("all"); setSource(""); }} />}
          </Button>
        </div>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Every card is one record moving Lead → Opportunity → Deal → Won. Click the value pill on a
        card to set deal value, probability and expected close date.
      </p>

      {filtersOpen && (
        <div className="mb-4 grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-4">
          <div className="grid gap-1">
            <Label htmlFor="f-min" className="text-xs">Min value ({currencySymbol(workspaceCurrency).trim()})</Label>
            <Input id="f-min" value={minValue} onChange={(e) => setMinValue(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 5000" className="h-8 text-sm" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-close" className="text-xs">Close within (days)</Label>
            <Input id="f-close" value={closeWithin} onChange={(e) => setCloseWithin(e.target.value.replace(/[^0-9]/g, ""))} placeholder="e.g. 14" className="h-8 text-sm" />
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-health" className="text-xs">Health</Label>
            <select
              id="f-health"
              value={health}
              onChange={(e) => setHealth(e.target.value as HealthFilter)}
              className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            >
              <option value="all">All</option>
              <option value="at_risk">Close date passed</option>
              <option value="stalled">Stalled (14+ days quiet)</option>
              <option value="closing">Closing soon</option>
              <option value="healthy">Active</option>
            </select>
          </div>
          <div className="grid gap-1">
            <Label htmlFor="f-source" className="text-xs">Source</Label>
            <Input id="f-source" value={source} onChange={(e) => setSource(e.target.value)} placeholder="e.g. Referral" className="h-8 text-sm" />
          </div>
        </div>
      )}

      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_ORDER.map((status) => {
          const columnLeads = byCanonicalStage(status);
          const isOver = overColumn === status;
          const isDragging = dragId !== null;
          return (
            <div
              key={status}
              onDragOver={(e) => {
                e.preventDefault();
                setOverColumn(status);
              }}
              onDragLeave={() => setOverColumn((c) => (c === status ? null : c))}
              onDrop={() => void handleDrop(status)}
              className={cn(
                "flex w-64 shrink-0 flex-col rounded-xl border transition-all duration-200",
                isOver
                  ? "border-[#171613]/50 bg-[#e4ddcf]"
                  : isDragging
                    ? "border-border bg-sidebar/60"
                    : "border-border bg-sidebar/80",
              )}
            >
              <div className="border-b border-border/70 px-3 py-2.5">
                <div className="flex items-center justify-between">
                  <span
                    className={cn(
                      "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      statusClasses(status),
                    )}
                  >
                    {LEAD_STATUS_LABELS[status]}
                  </span>
                  <span
                    className={cn(
                      "tabular text-xs",
                      isOver ? "text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {columnLeads.length}
                  </span>
                </div>
                {colTotal(status) > 0 && (
                  <p className="tabular mt-1 text-[11px] text-muted-foreground">
                    {money(colTotal(status), workspaceCurrency)}
                  </p>
                )}
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                {columnLeads.length === 0 &&
                  (isDragging ? (
                    // Active drag: invite the drop.
                    <p
                      className={cn(
                        "px-2 py-6 text-center text-xs transition-colors",
                        isOver
                          ? "font-medium text-foreground"
                          : "text-muted-foreground/60",
                      )}
                    >
                      Drop cards here
                    </p>
                  ) : (
                    // Permanently empty column: a calm, honest empty state.
                    <p className="px-2 py-6 text-center text-xs text-muted-foreground/50">
                      {hasFilter ? "No matches here" : "No opportunities here yet."}
                    </p>
                  ))}
                {columnLeads.map((lead: Lead) => (
                  <DealCard
                    key={lead._id}
                    lead={lead}
                    dragging={dragId === lead._id}
                    onDragStart={() => setDragId(lead._id)}
                    onDragEnd={() => setDragId(null)}
                    proposalPending={pendingProposals.has(lead._id)}
                    lastStageAt={stageLastAt.get(lead._id as string)}
                    onSaveDeal={async (fields) => {
                      try {
                        await updateDeal({ id: lead._id, ...fields });
                        toast("Deal updated");
                      } catch {
                        toast.error("Couldn't save — try again.");
                      }
                    }}
                    currency={dealCurrency(lead, workspaceCurrency)}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}

/** One deal card with inline value editing (§17) and health flags (§23). */
function DealCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
  onSaveDeal,
  proposalPending,
  lastStageAt,
  currency,
}: {
  lead: Lead;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onSaveDeal: (fields: {
    dealValue?: number;
    probability?: number;
    expectedCloseAt?: number;
  }) => Promise<void>;
  proposalPending: boolean;
  lastStageAt?: number;
  currency?: string;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(lead.dealValue?.toString() ?? "");
  const [probability, setProbability] = useState(lead.probability?.toString() ?? "");
  const [closeDate, setCloseDate] = useState(
    lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toISOString().slice(0, 10) : "",
  );

  const isOpen = isOpenDeal(lead);
  // At most ONE flag on the card — avoid badge spam (§23). Priority:
  // close passed > stalled > closing soon > proposal pending.
  const flag = isOpen
    ? dealFlags(lead, { lastStageAt, proposalPending })[0]
    : undefined;
  const last = lastActivityOf(lead);

  const save = async () => {
    const parsedValue = value.trim() ? Number(value.replace(/[^0-9.]/g, "")) : undefined;
    const parsedProb = probability.trim() ? Number(probability.replace(/[^0-9.]/g, "")) : undefined;
    if (parsedProb !== undefined && (parsedProb < 0 || parsedProb > 100)) {
      toast.error("Probability must be 0–100.");
      return;
    }
    await onSaveDeal({
      dealValue: parsedValue,
      probability: parsedProb,
      expectedCloseAt: closeDate ? new Date(closeDate).getTime() : undefined,
    });
    setOpen(false);
  };

  return (
    <motion.div
      layoutId={lead._id}
      layout
      transition={SPRING_SOFT}
      draggable={!open}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      animate={dragging ? { scale: 1.03, y: -6, opacity: 0.85 } : { scale: 1, y: 0, opacity: 1 }}
      whileHover={!dragging && !open ? { y: -3 } : undefined}
      style={
        dragging
          ? { boxShadow: "0 16px 32px -12px rgba(68, 58, 38, 0.45)", zIndex: 20 }
          : undefined
      }
      className={cn(
        "relative cursor-grab rounded-lg border border-border bg-card p-3 shadow-sm transition-colors hover:border-[#b3a894] active:cursor-grabbing",
        dragging && "border-[#171613]/50",
      )}
    >
      <Link to={`/leads/${lead._id}`} className="block" draggable={false}>
        <p className="truncate text-sm font-medium">{lead.name}</p>
        <p className="truncate text-xs text-muted-foreground">{lead.company ?? "—"}</p>
      </Link>

      <div className="mt-2 flex items-center justify-between gap-1.5">
        <Popover
          open={open}
          onOpenChange={(next) => {
            setOpen(next);
            if (next) {
              setValue(lead.dealValue?.toString() ?? "");
              setProbability(lead.probability?.toString() ?? "");
              setCloseDate(
                lead.expectedCloseAt
                  ? new Date(lead.expectedCloseAt).toISOString().slice(0, 10)
                  : "",
              );
            }
          }}
        >
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="Edit deal value"
              onClick={(e) => e.stopPropagation()}
              className={cn(
                "inline-flex cursor-pointer items-center gap-1 rounded border border-border px-1.5 py-0.5 text-[11px] tabular transition-colors",
                lead.dealValue !== undefined
                  ? "bg-secondary text-foreground hover:border-[#b3a894]"
                  : "border-dashed text-muted-foreground/70 hover:text-foreground",
              )}
            >
              <CircleDollarSign className="size-3" />
              {lead.dealValue !== undefined ? money(lead.dealValue, currency) : "Value"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
            <div className="grid gap-2.5">
              <div className="grid gap-1">
                <Label htmlFor={`dv-${lead._id}`} className="text-xs">Deal value</Label>
                <Input
                  id={`dv-${lead._id}`}
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  inputMode="numeric"
                  placeholder="12,000"
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`dp-${lead._id}`} className="text-xs">
                  Probability % — default {defaultProbability(canonicalStatus(lead.status))}
                </Label>
                <Input
                  id={`dp-${lead._id}`}
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  inputMode="numeric"
                  placeholder={`${defaultProbability(canonicalStatus(lead.status))}`}
                  className="h-8 text-sm"
                />
              </div>
              <div className="grid gap-1">
                <Label htmlFor={`dc-${lead._id}`} className="text-xs">Expected close</Label>
                <Input
                  id={`dc-${lead._id}`}
                  type="date"
                  value={closeDate}
                  onChange={(e) => setCloseDate(e.target.value)}
                  className="h-8 text-sm"
                />
              </div>
              <div className="flex justify-end gap-1.5">
                <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button size="sm" className="h-7 text-xs" onClick={() => void save()}>
                  Save
                </Button>
              </div>
            </div>
          </PopoverContent>
        </Popover>
        <span className="tabular text-[11px] text-muted-foreground">
          {lead.probability !== undefined
            ? `${lead.probability}%`
            : `${defaultProbability(canonicalStatus(lead.status))}% est.`}
        </span>
      </div>

      {flag && (
        <span
          title={flag.detail}
          className={cn(
            "mt-2 inline-flex max-w-full items-center truncate rounded-full border px-1.5 py-0.5 text-[10px] font-medium",
            DEAL_FLAG_CLASSES[flag.kind],
          )}
        >
          {DEAL_FLAG_LABELS[flag.kind]} · {flag.detail}
        </span>
      )}

      {!flag && last !== undefined && (
        <p className="mt-2 text-[10px] text-muted-foreground/60">Last activity {timeAgo(last)}</p>
      )}

      {lead.score !== undefined && (
        <span className="mt-2 block h-0.5 overflow-hidden rounded-full bg-[#e4ddcf]">
          <motion.span
            className="block h-full rounded-full bg-[#171613]"
            initial={{ width: 0 }}
            animate={{ width: `${lead.score}%` }}
            transition={{ ...SPRING, delay: 0.1 }}
          />
        </span>
      )}
    </motion.div>
  );
}
