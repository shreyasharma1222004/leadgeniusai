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
import { money } from "@/lib/growth";
import {
  LEAD_STATUS_LABELS,
  PIPELINE_ORDER,
  defaultProbability,
  statusClasses,
  weightedValue,
} from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { CircleDollarSign, Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Lead = Doc<"leads">;

export default function PipelinePage() {
  const { isLoading: authLoading } = useAuth();
  const leads = useQuery(api.leads.list, {});
  const bulkSetStatus = useMutation(api.leads.bulkSetStatus);
  const updateDeal = useMutation(api.leads.updateDeal);
  const [dragId, setDragId] = useState<Id<"leads"> | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

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

  // Column totals
  const colTotal = (status: string) =>
    leads
      .filter((l) => l.status === status)
      .reduce((s, l) => s + (l.dealValue ?? 0), 0);
  const weightedTotal = leads
    .filter((l) => !["won", "lost"].includes(l.status))
    .reduce((s, l) => s + weightedValue(l.dealValue, l.probability, l.status), 0);
  const pipelineTotal = leads
    .filter((l) => !["won", "lost"].includes(l.status))
    .reduce((s, l) => s + (l.dealValue ?? 0), 0);

  return (
    <AppShell
      title="Pipeline"
      actions={
        <div className="flex items-center gap-4 text-xs text-muted-foreground">
          <span className="hidden sm:inline">
            Open pipeline <span className="tabular font-semibold text-foreground">{money(pipelineTotal)}</span>
          </span>
          <span className="hidden md:inline">
            Weighted <span className="tabular font-semibold text-foreground">{money(weightedTotal)}</span>
          </span>
          <span className="text-[10px] text-muted-foreground/60">weighted = value × estimated probability</span>
        </div>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Drag cards between stages. Click the value pill on a card to set deal value, probability and
        expected close date.
      </p>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {PIPELINE_ORDER.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);
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
                    {money(colTotal(status))}
                  </p>
                )}
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                {columnLeads.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">
                    Drop cards here
                  </p>
                )}
                {columnLeads.map((lead: Lead) => (
                  <DealCard
                    key={lead._id}
                    lead={lead}
                    dragging={dragId === lead._id}
                    onDragStart={() => setDragId(lead._id)}
                    onDragEnd={() => setDragId(null)}
                    onSaveDeal={async (fields) => {
                      try {
                        await updateDeal({ id: lead._id, ...fields });
                        toast("Deal updated");
                      } catch {
                        toast.error("Couldn't save — try again.");
                      }
                    }}
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

/** One deal card with inline value editing (§17). */
function DealCard({
  lead,
  dragging,
  onDragStart,
  onDragEnd,
  onSaveDeal,
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
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(lead.dealValue?.toString() ?? "");
  const [probability, setProbability] = useState(lead.probability?.toString() ?? "");
  const [closeDate, setCloseDate] = useState(
    lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toISOString().slice(0, 10) : "",
  );

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
              {lead.dealValue !== undefined ? money(lead.dealValue) : "Value"}
            </button>
          </PopoverTrigger>
          <PopoverContent className="w-64 p-3" onClick={(e) => e.stopPropagation()}>
            <div className="grid gap-2.5">
              <div className="grid gap-1">
                <Label htmlFor={`dv-${lead._id}`} className="text-xs">Deal value ($)</Label>
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
                  Probability % — default {defaultProbability(lead.status)}
                </Label>
                <Input
                  id={`dp-${lead._id}`}
                  value={probability}
                  onChange={(e) => setProbability(e.target.value)}
                  inputMode="numeric"
                  placeholder={`${defaultProbability(lead.status)}`}
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
          {lead.probability !== undefined ? `${lead.probability}%` : `${defaultProbability(lead.status)}% est.`}
        </span>
      </div>

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
