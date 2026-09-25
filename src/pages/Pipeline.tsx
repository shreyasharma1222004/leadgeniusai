import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, statusClasses } from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { Users } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Lead = Doc<"leads">;

export default function PipelinePage() {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const leads = useQuery(api.leads.list, {});
  const bulkSetStatus = useMutation(api.leads.bulkSetStatus);
  const [dragId, setDragId] = useState<Id<"leads"> | null>(null);
  const [overColumn, setOverColumn] = useState<string | null>(null);

  if (authLoading || leads === undefined) {
    return (
      <AppShell title="Pipeline">
        <div className="grid gap-3 md:grid-cols-4 xl:grid-cols-7">
          {LEAD_STATUSES.map((s) => (
            <Skeleton key={s} className="h-64 rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (leads.length === 0) {
    return (
      <AppShell title="Pipeline">
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background">
            <Users className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No leads on the board.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add leads first — then drag them from New to Won as deals progress.
          </p>
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
      toast(`${lead.name} → ${LEAD_STATUS_LABELS[status as keyof typeof LEAD_STATUS_LABELS] ?? status}`);
    } catch {
      toast.error("Couldn't move that card — try again.");
    }
  };

  return (
    <AppShell title="Pipeline">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Drag cards between stages — the same data as the Leads table, organized by where each deal
        actually is.
      </p>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {LEAD_STATUSES.map((status) => {
          const columnLeads = leads.filter((l) => l.status === status);
          const isOver = overColumn === status;
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
                "flex w-64 shrink-0 flex-col rounded-lg border bg-sidebar/60 transition-colors",
                isOver ? "border-[#A9E813]/70 bg-[#D4FF4F]/5" : "border-border",
              )}
            >
              <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
                <span
                  className={cn(
                    "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                    statusClasses(status),
                  )}
                >
                  {LEAD_STATUS_LABELS[status]}
                </span>
                <span className="tabular text-xs text-muted-foreground">{columnLeads.length}</span>
              </div>
              <div className="flex min-h-[120px] flex-1 flex-col gap-2 p-2">
                {columnLeads.length === 0 && (
                  <p className="px-2 py-6 text-center text-xs text-muted-foreground/60">
                    Drop cards here
                  </p>
                )}
                {columnLeads.map((lead: Lead) => (
                  <div
                    key={lead._id}
                    draggable
                    onDragStart={() => setDragId(lead._id)}
                    onDragEnd={() => setDragId(null)}
                    className={cn(
                      "cursor-grab rounded-md border border-border bg-card p-3 shadow-sm transition-shadow hover:shadow-md active:cursor-grabbing",
                      dragId === lead._id && "opacity-50",
                    )}
                  >
                    <Link to={`/leads/${lead._id}`} className="block">
                      <p className="truncate text-sm font-medium">{lead.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {lead.company ?? "—"}
                      </p>
                      <div className="mt-2 flex items-center justify-between">
                        <span className="tabular text-xs text-muted-foreground">
                          {lead.score !== undefined ? `Score ${lead.score}` : "Unscored"}
                        </span>
                        {lead.nextFollowUpAt && (
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            follow-up set
                          </span>
                        )}
                      </div>
                    </Link>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </AppShell>
  );
}
