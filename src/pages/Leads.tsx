import { AddLeadDialog } from "@/components/AddLeadDialog";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { AppShell } from "@/components/AppShell";
import { LeadSidePanel } from "@/components/LeadSidePanel";
import { OutreachComposer } from "@/components/OutreachComposer";
import { AIButton, SPRING_SOFT, TiltCard } from "@/components/spatial";
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
import { motion } from "framer-motion";
import {
  CalendarCheck,
  ChevronDown,
  ListFilter,
  MoreHorizontal,
  Reply,
  Search,
  Send,
  Sparkles,
  Trash2,
  Trophy,
  Users,
} from "lucide-react";
import { useMemo, useState } from "react";
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
  const [composeOpen, setComposeOpen] = useState(false);
  const [composeTargets, setComposeTargets] = useState<Doc2[]>([]);
  const [panelLead, setPanelLead] = useState<Doc2 | null>(null);

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

  const selectedLeads = useMemo(
    () => (leads ?? []).filter((l) => selected.has(l._id)),
    [leads, selected],
  );

  const openCompose = (targets: Doc2[]) => {
    if (targets.length === 0) return;
    setComposeTargets(targets);
    setComposeOpen(true);
  };

  const openPanelCompose = (lead: Doc2) => {
    setPanelLead(null);
    openCompose([lead]);
  };

  const setPanelStatus = (lead: Doc2, status: string) => {
    void runBulk(
      () => mutationHelpers.bulkSetStatus({ ids: [lead._id], status }),
      "Status updated",
    );
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
      {/* Floating metric hero */}
      {leads && leads.length > 0 && (
        <MetricsHero leads={leads} followUpDue={followUpDue} />
      )}

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

          <div className="flex items-center rounded-md border border-border bg-white/[0.03] p-0.5">
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
                  "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                  quickFilter === t.key
                    ? "bg-[#8B5CF6]/20 text-[#c4b5fd] shadow-[inset_0_0_0_1px_rgba(139,92,246,0.35)]"
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
            <DropdownMenuContent align="end" className="depth-pop w-44">
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

        {/* Bulk bar — violet action surface */}
        {selected.size > 0 && (
          <div className="stage-enter flex flex-wrap items-center gap-2 rounded-lg border border-[#8B5CF6]/40 bg-[#8B5CF6]/[0.08] px-3 py-2 shadow-[0_0_24px_rgba(139,92,246,0.12)]">
            <span className="text-xs font-medium text-[#c4b5fd]">
              {selected.size} selected
            </span>
            <div className="ml-auto flex flex-wrap items-center gap-1.5">
              <AIButton
                size="sm"
                onClick={() => openCompose(selectedLeads)}
              >
                Compose outreach
              </AIButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="sm" variant="outline" className="h-7 gap-1 text-xs">
                    Change status <ChevronDown className="size-3 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="depth-pop">
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
          {/* Desktop table — spatial data workspace */}
          <div className="depth-card hidden overflow-hidden rounded-xl md:block">
            <Table>
              <TableHeader>
                <TableRow className="border-border/70 hover:bg-transparent">
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
                  <TableRow
                    key={lead._id}
                    onClick={() => setPanelLead(lead)}
                    className="group cursor-pointer border-border/60 transition-colors hover:bg-white/[0.035]"
                  >
                    <TableCell className="pl-4" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={selected.has(lead._id)}
                        onCheckedChange={() => toggleOne(lead._id)}
                        aria-label={`Select ${lead.name}`}
                      />
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-2.5">
                        <span
                          aria-hidden
                          className="flex size-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-semibold text-muted-foreground transition-all duration-200 group-hover:border-[#8B5CF6]/50 group-hover:text-[#c4b5fd] group-hover:shadow-[0_0_12px_rgba(139,92,246,0.35)]"
                        >
                          {initials(lead.name)}
                        </span>
                        <span className="flex flex-col">
                          <span className="text-sm font-medium">
                            {lead.name}
                          </span>
                          <span className="text-xs text-muted-foreground lg:hidden">
                            {lead.company ?? "—"}
                          </span>
                        </span>
                      </span>
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
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={cn(
                              "tabular text-sm font-medium",
                              lead.score >= 70
                                ? "text-[#c4b5fd]"
                                : lead.score >= 40
                                  ? "text-foreground"
                                  : "text-muted-foreground",
                            )}
                          >
                            {lead.score}
                          </span>
                          <span className="h-0.5 w-10 overflow-hidden rounded-full bg-white/[0.08]">
                            <span
                              className={cn(
                                "block h-full rounded-full",
                                lead.score >= 70
                                  ? "bg-[#8B5CF6]"
                                  : lead.score >= 40
                                    ? "bg-white/30"
                                    : "bg-white/15",
                              )}
                              style={{ width: `${lead.score}%` }}
                            />
                          </span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            mutationHelpers.analyze(lead);
                          }}
                          className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs text-[#c4b5fd] underline-offset-2 transition-colors hover:bg-[#8B5CF6]/10 hover:underline"
                        >
                          <Sparkles className="size-3" /> Analyze
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
                    <TableCell className="pr-4" onClick={(e) => e.stopPropagation()}>
                      <div className="opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                        <LeadRowMenu
                          lead={lead}
                          onAnalyze={() => mutationHelpers.analyze(lead)}
                          onCompose={() => openCompose([lead])}
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
                      </div>
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
                onClick={() => setPanelLead(lead)}
                className="depth-card cursor-pointer rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{lead.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {lead.jobTitle ? `${lead.jobTitle} · ` : ""}
                      {lead.company ?? "—"}
                    </p>
                  </div>
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
                <div className="mt-3 flex gap-2" onClick={(e) => e.stopPropagation()}>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1"
                    onClick={() => setPanelLead(lead)}
                  >
                    Open
                  </Button>
                  <AIButton
                    size="sm"
                    className="flex-1"
                    onClick={() => mutationHelpers.analyze(lead)}
                  >
                    Analyze
                  </AIButton>
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
      {/* Floating lead detail panel (Layer 4) */}
      <LeadSidePanel
        lead={panelLead}
        onClose={() => setPanelLead(null)}
        onCompose={openPanelCompose}
        onAnalyze={(l) => mutationHelpers.analyze(l)}
        onStatus={setPanelStatus}
      />
      {/* Shared outreach composer */}
      <OutreachComposer
        leads={composeTargets}
        open={composeOpen}
        onOpenChange={setComposeOpen}
      />
    </AppShell>
  );
}

/* ── Floating metric hero — Layer-2 cards with real counts ───────────────── */

function MetricsHero({ leads, followUpDue }: { leads: Doc2[]; followUpDue: number }) {
  const cards = useMemo(() => {
    const total = leads.length;
    const contacted = leads.filter(
      (l) =>
        l.lastContactedAt !== undefined ||
        ["contacted", "replied", "interested", "meeting", "won"].includes(l.status),
    ).length;
    const replies = leads.filter((l) =>
      ["replied", "interested", "meeting", "won"].includes(l.status),
    ).length;
    const meetings = leads.filter((l) => l.status === "meeting" || l.status === "won").length;
    const won = leads.filter((l) => l.status === "won").length;

    const pct = (v: number) => (total === 0 ? 0 : Math.round((v / total) * 100));

    return [
      { label: "Leads", value: total, pct: 100, icon: Users, tint: "text-[#c4b5fd]", sub: followUpDue === 0 ? "All caught up" : `${followUpDue} follow-up${followUpDue === 1 ? "" : "s"} due soon` },
      { label: "Contacted", value: contacted, pct: pct(contacted), icon: Send, tint: "text-[#67E8F9]", sub: `${pct(contacted)}% of pipeline` },
      { label: "Replies", value: replies, pct: pct(replies), icon: Reply, tint: "text-[#c084fc]", sub: `${pct(replies)}% of pipeline` },
      { label: "Meetings", value: meetings, pct: pct(meetings), icon: CalendarCheck, tint: "text-[#FCD34D]", sub: `${pct(meetings)}% of pipeline` },
      { label: "Won", value: won, pct: pct(won), icon: Trophy, tint: "text-[#8B5CF6]", sub: `${pct(won)}% of pipeline` },
    ];
  }, [leads, followUpDue]);

  return (
    <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5">
      {cards.map((card, i) => (
        <TiltCard key={card.label} className="p-4">
          <div className="flex items-center justify-between gap-2">
            <span className="label-caps text-[10px] text-muted-foreground">
              {card.label}
            </span>
            <span
              className={cn(
                "flex size-7 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04]",
                card.tint,
              )}
            >
              <card.icon className="size-3.5" />
            </span>
          </div>
          <p className="tabular mt-3 text-2xl font-semibold tracking-tight">
            {card.value}
          </p>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#A855F7]"
              initial={{ width: 0 }}
              animate={{ width: `${card.pct}%` }}
              transition={{ ...SPRING_SOFT, delay: 0.1 + i * 0.06 }}
            />
          </div>
          <p className="mt-1.5 truncate text-[11px] text-muted-foreground">
            {card.sub}
          </p>
        </TiltCard>
      ))}
    </div>
  );
}

function LeadRowMenu({
  lead,
  onAnalyze,
  onCompose,
  onStatus,
  onDelete,
}: {
  lead: Doc2;
  onAnalyze: () => void;
  onCompose: () => void;
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
      <DropdownMenuContent align="end" className="depth-pop w-48">
        <DropdownMenuItem onClick={onCompose}>
          <Send className="mr-2 size-3.5" /> Compose outreach
        </DropdownMenuItem>
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
    <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
      <div className="flex size-11 items-center justify-center rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/15 text-[#c4b5fd] shadow-[0_0_20px_rgba(139,92,246,0.25)]">
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
    <div className="rounded-xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
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
          className="flex items-center gap-4 rounded-xl border border-border bg-card px-4 py-3"
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
