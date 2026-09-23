import { AddLeadDialog } from "@/components/AddLeadDialog";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import { initials, timeAgo } from "@/lib/format";
import { LEAD_STATUSES, LEAD_STATUS_LABELS, statusClasses, statusLabel } from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ChevronDown,
  ListFilter,
  MoreHorizontal,
  Search,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Doc2 = Doc<"leads">;
type QuickFilter = "all" | "followup";

export default function LeadsPage() {
  const { isLoading: authLoading, isAuthenticated } = useAuth();
  const leads = useQueryWithAuth(authLoading, isAuthenticated);
  const mutationHelpers = useLeadMutations();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [quickFilter, setQuickFilter] = useState<QuickFilter>("all");
  const [selected, setSelected] = useState<Set<Id<"leads">>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    return leads.filter((lead) => {
      if (statusFilter !== "all" && lead.status !== statusFilter) return false;
      if (quickFilter === "followup" && !lead.nextFollowUpAt) return false;
      if (!q) return true;
      return (
        lead.name.toLowerCase().includes(q) ||
        lead.company?.toLowerCase().includes(q) ||
        lead.jobTitle?.toLowerCase().includes(q) ||
        lead.industry?.toLowerCase().includes(q)
      );
    });
  }, [leads, search, statusFilter, quickFilter]);

  const followUpDue = useMemo(
    () => (leads ?? []).filter((l) => l.nextFollowUpAt && l.nextFollowUpAt <= Date.now() + 24 * 3600_000).length,
    [leads],
  );

  const allChecked =
    filtered.length > 0 && filtered.every((l) => selected.has(l._id));
  const someChecked = filtered.some((l) => selected.has(l._id));

  const toggleAll = () => {
    setSelected((prev) => {
      if (allChecked) {
        const next = new Set(prev);
        filtered.forEach((l) => next.delete(l._id));
        return next;
      }
      return new Set([...prev, ...filtered.map((l) => l._id)]);
    });
  };

  const toggleOne = (id: Id<"leads">) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const runBulk = async (fn: () => Promise<unknown>, message: string) => {
    setBulkBusy(true);
    try {
      await fn();
      toast(message);
      setSelected(new Set());
    } catch {
      toast.error("That bulk action failed — try again.");
    } finally {
      setBulkBusy(false);
    }
  };

  return (
    <AppShell
      title="Leads"
      actions={
        <>
          <ImportCsvDialog />
          <AddLeadDialog />
        </>
      }
    >
      {/* Toolbar */}
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[220px] flex-1">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search name, company, title, industry…"
              className="pl-9"
              aria-label="Search leads"
            />
          </div>

          <div className="flex items-center rounded-md border border-border p-0.5">
            {(
              [
                { key: "all", label: `All` },
                { key: "followup", label: `Follow-up due (${followUpDue})` },
              ] as const
            ).map((t) => (
              <button
                key={t.key}
                onClick={() => setQuickFilter(t.key)}
                aria-pressed={quickFilter === t.key}
                className={cn(
                  "rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                  quickFilter === t.key
                    ? "bg-foreground text-background"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {t.label}
              </button>
            ))}
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="gap-1.5">
                <ListFilter className="size-3.5" />
                {statusFilter === "all"
                  ? "Status"
                  : statusLabel(statusFilter)}
                <ChevronDown className="size-3.5 opacity-50" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-44">
              <DropdownMenuLabel>Filter by status</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setStatusFilter("all")}>
                All statuses
              </DropdownMenuItem>
              {LEAD_STATUSES.map((s) => (
                <DropdownMenuItem key={s} onClick={() => setStatusFilter(s)}>
                  {LEAD_STATUS_LABELS[s]}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        {/* Bulk bar */}
        {selected.size > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#D4FF4F]/60 bg-[#D4FF4F]/10 px-3 py-2">
            <span className="text-xs font-medium">
              {selected.size} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    <Sparkles className="size-3" /> Generate outreach
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() =>
                    toast("Outreach generation ships in the next release", {
                      description: "V1 covers adding, researching and tracking leads.",
                    })
                  }>
                    Email draft (soon)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() =>
                    toast("Outreach generation ships in the next release", {
                      description: "V1 covers adding, researching and tracking leads.",
                    })
                  }>
                    LinkedIn message (soon)
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    Change status <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {LEAD_STATUSES.map((s) => (
                    <DropdownMenuItem
                      key={s}
                      disabled={bulkBusy}
                      onClick={() =>
                        runBulk(
                          () =>
                            mutationHelpers.bulkSetStatus({
                              ids: [...selected],
                              status: s,
                            }),
                          `Status updated for ${selected.size} leads`,
                        )
                      }
                    >
                      {LEAD_STATUS_LABELS[s]}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 gap-1 text-xs text-destructive hover:text-destructive"
                disabled={bulkBusy}
                onClick={() => {
                  if (
                    window.confirm(
                      `Delete ${selected.size} lead${selected.size === 1 ? "" : "s"}? This can't be undone.`,
                    )
                  ) {
                    void runBulk(
                      () => mutationHelpers.bulkDelete({ ids: [...selected] }),
                      `Deleted ${selected.size} leads`,
                    );
                  }
                }}
              >
                <Trash2 className="size-3" /> Delete
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Body */}
      {authLoading || leads === undefined ? (
        <LeadsSkeleton />
      ) : leads.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <NoMatch onClear={() => {
          setSearch("");
          setStatusFilter("all");
          setQuickFilter("all");
        }} />
      ) : (
        <>
          {/* Desktop table */}
          <div className="hidden rounded-lg border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead className="w-10 pl-4">
                    <Checkbox
                      checked={allChecked ? true : someChecked ? "indeterminate" : false}
                      onCheckedChange={toggleAll}
                      aria-label="Select all leads"
                    />
                  </TableHead>
                  <TableHead>Name</TableHead>
                  <TableHead className="hidden lg:table-cell">Company</TableHead>
                  <TableHead className="hidden xl:table-cell">Industry</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Score</TableHead>
                  <TableHead className="hidden xl:table-cell">Last contact</TableHead>
                  <TableHead className="hidden lg:table-cell">Next follow-up</TableHead>
                  <TableHead className="w-10 pr-4" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map((lead) => (
                  <TableRow key={lead._id} className="group">
                    <TableCell className="pl-4">
                      <Checkbox
                        checked={selected.has(lead._id)}
                        onCheckedChange={() => toggleOne(lead._id)}
                        aria-label={`Select ${lead.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <Link
                        to={`/leads/${lead._id}`}
                        className="flex items-center gap-2.5"
                      >
                        <span
                          aria-hidden
                          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-muted-foreground"
                        >
                          {initials(lead.name)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-medium underline-offset-4 group-hover:underline">
                            {lead.name}
                          </span>
                          <span className="text-xs text-muted-foreground lg:hidden">
                            {lead.company ?? "—"}
                          </span>
                        </span>
                      </Link>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-sm text-muted-foreground">
                        {lead.company ?? "—"}
                        {lead.jobTitle ? (
                          <span className="text-xs"> · {lead.jobTitle}</span>
                        ) : null}
                      </span>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {lead.industry ?? "—"}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                          statusClasses(lead.status),
                        )}
                      >
                        {statusLabel(lead.status)}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {lead.score !== undefined ? (
                        <span className="tabular text-sm font-medium">
                          {lead.score}
                        </span>
                      ) : (
                        <button
                          onClick={() => mutationHelpers.analyze(lead)}
                          className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
                        >
                          analyze
                        </button>
                      )}
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {timeAgo(lead.lastContactedAt)}
                      </span>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground">
                        {lead.nextFollowUpAt ? timeAgo(lead.nextFollowUpAt) : "—"}
                      </span>
                    </TableCell>
                    <TableCell className="pr-4">
                      <LeadRowMenu
                        lead={lead}
                        onAnalyze={() => mutationHelpers.analyze(lead)}
                        onStatus={(s) =>
                          runBulk(
                            () =>
                              mutationHelpers.bulkSetStatus({ ids: [lead._id], status: s }),
                            "Status updated",
                          )
                        }
                        onDelete={() =>
                          runBulk(
                            () => mutationHelpers.bulkDelete({ ids: [lead._id] }),
                            "Lead deleted",
                          )
                        }
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile cards */}
          <div className="flex flex-col gap-2 md:hidden">
            {filtered.map((lead) => (
              <div
                key={lead._id}
                className="rounded-lg border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <Link to={`/leads/${lead._id}`} className="min-w-0">
                    <p className="truncate text-sm font-medium">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.jobTitle ? `${lead.jobTitle} · ` : ""}
                      {lead.company ?? "—"}
                    </p>
                  </Link>
                  <span
                    className={cn(
                      "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                      statusClasses(lead.status),
                    )}
                  >
                    {statusLabel(lead.status)}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                  <span>Score {lead.score ?? "—"}</span>
                  <span>·</span>
                  <span>
                    Follow-up{" "}
                    {lead.nextFollowUpAt ? timeAgo(lead.nextFollowUpAt) : "—"}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button asChild variant="outline" size="sm" className="flex-1">
                    <Link to={`/leads/${lead._id}`}>Open</Link>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => mutationHelpers.analyze(lead)}
                  >
                    <Sparkles className="size-3.5" /> Analyze
                  </Button>
                </div>
                <Checkbox
                  className="sr-only"
                  checked={selected.has(lead._id)}
                  onCheckedChange={() => toggleOne(lead._id)}
                  aria-label={`Select ${lead.name}`}
                />
              </div>
            ))}
          </div>

          <p className="mt-3 text-xs text-muted-foreground">
            {filtered.length} of {leads.length} leads
          </p>
        </>
      )}
    </AppShell>
  );
}

function LeadRowMenu({
  lead,
  onAnalyze,
  onStatus,
  onDelete,
}: {
  lead: Doc2;
  onAnalyze: () => void;
  onStatus: (s: string) => void;
  onDelete: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="size-7 text-muted-foreground"
          aria-label={`Actions for ${lead.name}`}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem onClick={onAnalyze}>
          <Sparkles className="mr-2 size-3.5" /> Analyze with AI
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-xs">Move to</DropdownMenuLabel>
        {LEAD_STATUSES.map((s) => (
          <DropdownMenuItem key={s} onClick={() => onStatus(s)}>
            {LEAD_STATUS_LABELS[s]}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem
          className="text-destructive focus:text-destructive"
          onClick={() => {
            if (window.confirm(`Delete ${lead.name}? This can't be undone.`)) {
              onDelete();
            }
          }}
        >
          <Trash2 className="mr-2 size-3.5" /> Delete
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background">
        <Users className="size-5" />
      </div>
      <h2 className="mt-4 text-lg font-semibold tracking-tight">
        Your pipeline is empty.
      </h2>
      <p className="mt-1 max-w-sm text-sm text-muted-foreground">
        Import your existing leads or add your first prospect — DealFlow AI will
        research them and draft the opening message.
      </p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        <ImportCsvDialog className="border border-border" />
        <AddLeadDialog variant="default" />
      </div>
      <SampleDataLoader />
    </div>
  );
}

function SampleDataLoader() {
  const load = useMutation(api.leads.loadSampleData);
  return (
    <Button
      variant="link"
      size="sm"
      className="mt-4 text-xs text-muted-foreground"
      onClick={async () => {
        const result = await load({});
        toast(
          result.seeded
            ? `Loaded ${result.count} sample leads`
            : "Workspace already has leads",
        );
      }}
    >
      Or load 8 sample leads to explore
    </Button>
  );
}

function NoMatch({ onClear }: { onClear: () => void }) {
  return (
    <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-14 text-center">
      <p className="text-sm font-medium">No leads match these filters.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Try a different search term or clear the filters.
      </p>
      <Button variant="outline" size="sm" className="mt-4" onClick={onClear}>
        Clear filters
      </Button>
    </div>
  );
}

function LeadsSkeleton() {
  return (
    <div className="space-y-2">
      {Array.from({ length: 6 }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3"
        >
          <Skeleton className="size-7 rounded-full" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-3.5 w-10" />
        </div>
      ))}
    </div>
  );
}

// ── hooks ──────────────────────────────────────────────────────────────────

function useQueryWithAuth(
  authLoading: boolean,
  isAuthenticated: boolean,
): Doc2[] | undefined {
  const data = useQuery(api.leads.list, {});
  if (authLoading || !isAuthenticated) return undefined;
  return data;
}

function useLeadMutations() {
  const bulkSetStatus = useMutation(api.leads.bulkSetStatus);
  const bulkDelete = useMutation(api.leads.bulkDelete);
  const saveAnalysis = useMutation(api.leads.saveAnalysis);

  const analyze = async (lead: Doc2) => {
    const { analyzeLead } = await import("@/lib/leads-client");
    toast("Analyzing lead…", { description: "Reading context and scoring." });
    try {
      const result = await analyzeLead({
        name: lead.name,
        jobTitle: lead.jobTitle,
        company: lead.company,
        website: lead.website,
        industry: lead.industry,
        location: lead.location,
        notes: lead.notes,
      });
      await saveAnalysis({
        id: lead._id,
        score: result.score,
        summary: result.summary,
        painPoints: result.painPoints,
        signals: result.signals,
        approach: result.approach,
        industry: result.industry || undefined,
        scoreBreakdown: result.scoreBreakdown,
      });
      toast(`Analyzed ${lead.name}`, {
        description: `Lead score: ${result.score}/100.`,
      });
    } catch {
      toast.error("Something went wrong while analyzing this lead.");
    }
  };

  return { bulkSetStatus, bulkDelete, analyze };
}
