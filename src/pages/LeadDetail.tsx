import { AppShell } from "@/components/AppShell";
import { OutreachComposer } from "@/components/OutreachComposer";
import { LeadScoreRing, SpatialPage } from "@/components/spatial";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatDateTime, initials, timeAgo } from "@/lib/format";
import { useAnalyzeLead } from "@/lib/leads-client";
import { money, nextBestAction } from "@/lib/growth";
import { defaultProbability, weightedValue } from "@/lib/leadStatus";
import { DEAL_FLAG_CLASSES, DEAL_FLAG_LABELS, dealCurrency, dealFlags, dealTitle, lastActivityOf } from "@/lib/revenue";
import { useEffect, useMemo } from "react";
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  lifecycleLabel,
  statusClasses,
  statusLabel,
} from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarPlus,
  Check,
  CircleDollarSign,
  FileText,
  History,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  MessagesSquare,
  Pencil,
  Phone,
  Send,
  Sparkles,
  Globe,
  StickyNote,
  Tag,
  Trophy,
  X,
} from "lucide-react";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { toast } from "sonner";

type Lead = Doc<"leads">;

export default function LeadDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const lead = useQuery(
    api.leads.get,
    id ? { id: id as Id<"leads"> } : "skip",
  );
  const followUps = useQuery(
    api.leads.followUpsForLead,
    id ? { leadId: id as Id<"leads"> } : "skip",
  );
  const notes = useQuery(
    api.leads.notesForLead,
    id ? { leadId: id as Id<"leads"> } : "skip",
  );

  const [analyzing, setAnalyzing] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [noteText, setNoteText] = useState("");
  const [followUpOpen, setFollowUpOpen] = useState(false);
  const [followUpAt, setFollowUpAt] = useState("");
  const [followUpNote, setFollowUpNote] = useState("");

  const setStatus = useMutation(api.leads.setStatus);
  const updateDeal = useMutation(api.leads.updateDeal);
  const addNote = useMutation(api.leads.addNote);
  const analyzeLead = useAnalyzeLead();
  const removeLead = useMutation(api.leads.remove);
  const markContacted = useMutation(api.leads.markContacted);
  const scheduleFollowUp = useMutation(api.leads.scheduleFollowUp);
  const setFollowUpStatus = useMutation(api.leads.setFollowUpStatus);
  const saveAnalysis = useMutation(api.leads.saveAnalysis);
  const markWon = useMutation(api.leads.markWon);
  const markLost = useMutation(api.leads.markLost);
  const profile = useQuery(api.business.myProfile, {});
  const workspaceCurrency = profile?.currency ?? undefined;
  const stageHistory = useQuery(
    api.leads.stageHistoryForLead,
    id ? { leadId: id as Id<"leads"> } : "skip",
  );
  const dealProposals = useQuery(
    api.proposals.listForDeal,
    id ? { dealId: id as Id<"leads"> } : "skip",
  );
  const [lostDialogOpen, setLostDialogOpen] = useState(false);
  const [lossReason, setLossReason] = useState("");

  const handleAnalyze = async () => {
    if (!lead) return;
    setAnalyzing(true);
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
        description: `Lead score: ${result.score}/100 (${result.provider === "openai" ? "GPT brief" : "estimate from your data"}).`,
      });
    } catch {
      toast.error("Something went wrong while analyzing this lead.");
    } finally {
      setAnalyzing(false);
    }
  };

  const handleAddNote = async () => {
    if (!lead || !noteText.trim()) return;
    try {
      await addNote({ leadId: lead._id, body: noteText.trim() });
      setNoteText("");
      toast("Note added");
    } catch {
      toast.error("Couldn't save that note — try again.");
    }
  };

  const handleSchedule = async () => {
    if (!lead || !followUpAt) return;
    const ts = new Date(followUpAt).getTime();
    if (Number.isNaN(ts)) {
      toast.error("Pick a valid date and time.");
      return;
    }
    try {
      await scheduleFollowUp({
        leadId: lead._id,
        dueAt: ts,
        note: followUpNote.trim() || undefined,
      });
      setFollowUpOpen(false);
      setFollowUpNote("");
      setFollowUpAt("");
      toast("Follow-up scheduled");
    } catch {
      toast.error("Couldn't schedule that follow-up — try again.");
    }
  };

  const handleDelete = async () => {
    if (!lead) return;
    if (!window.confirm(`Delete ${lead.name}? This can't be undone.`)) return;
    await removeLead({ id: lead._id });
    toast("Lead deleted");
    navigate("/leads");
  };

  if (lead === undefined) {
    return (
      <AppShell title="Lead">
        <div className="space-y-4">
          <Skeleton className="h-24 w-full rounded-lg" />
          <div className="grid gap-4 lg:grid-cols-3">
            <Skeleton className="h-72 rounded-lg lg:col-span-2" />
            <Skeleton className="h-72 rounded-lg" />
          </div>
        </div>
      </AppShell>
    );
  }

  if (lead === null) {
    return (
      <AppShell title="Lead">
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">We couldn't find that lead.</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            It may have been deleted, or it belongs to another workspace.
          </p>
          <Button asChild className="mt-5">
            <Link to="/leads">
              <ArrowLeft className="size-4" /> Back to leads
            </Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const sortedFollowUps = [...(followUps ?? [])].sort((a, b) => a.dueAt - b.dueAt);

  const handleMarkWon = async () => {
    if (!lead) return;
    try {
      await markWon({ id: lead._id });
      toast.success("Deal marked Won", {
        description:
          lead.dealValue !== undefined
            ? `${money(lead.dealValue, dealCurrency(lead, workspaceCurrency))} now counts as actual won revenue.`
            : "Add a deal value so this counts toward revenue.",
      });
    } catch {
      toast.error("Couldn't mark the deal Won — try again.");
    }
  };

  const handleMarkLost = async () => {
    if (!lead) return;
    try {
      await markLost({ id: lead._id, lossReason: lossReason.trim() || undefined });
      setLostDialogOpen(false);
      setLossReason("");
      toast("Deal marked Lost");
    } catch {
      toast.error("Couldn't mark the deal Lost — try again.");
    }
  };

  const isClosed = lead.status === "won" || lead.status === "lost";

  return (
    <AppShell
      title={
        <span className="flex items-center gap-2">
          <Link
            to="/leads"
            className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back to leads"
          >
            <ArrowLeft className="size-4" />
          </Link>
          {dealTitle(lead)}
        </span>
      }
      actions={
        <>
          {!isClosed && (
            <>
              <Button variant="outline" className="text-[#53634a] hover:text-[#42503c]" onClick={() => void handleMarkWon()}>
                <Trophy className="size-4" /> Mark Won
              </Button>
              <Button variant="outline" className="text-destructive hover:text-destructive" onClick={() => setLostDialogOpen(true)}>
                <X className="size-4" /> Mark Lost
              </Button>
            </>
          )}
          <Button variant="outline" onClick={() => setComposerOpen(true)}>
            <Mail className="size-4" /> Compose outreach
          </Button>
          <Button variant="outline" onClick={() => setFollowUpOpen(true)}>
            <CalendarPlus className="size-4" /> Follow-up
          </Button>
          <Button onClick={handleAnalyze} disabled={analyzing}>
            {analyzing ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Sparkles className="size-4" />
            )}
            {lead.summary ? "Re-analyze" : "Analyze with AI"}
          </Button>
        </>
      }
    >
      <SpatialPage className="grid gap-4 lg:grid-cols-3">
        {/* Left column: identity + contact + status */}
        <div className="flex flex-col gap-4">
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex size-11 items-center justify-center rounded-full border border-border bg-muted text-sm font-semibold text-muted-foreground"
              >
                {initials(lead.name)}
              </span>
              <div className="min-w-0">
                <p className="truncate text-base font-semibold tracking-tight">
                  {lead.name}
                </p>
                <p className="truncate text-sm text-muted-foreground">
                  {lead.jobTitle ?? "Role unknown"}
                  {lead.company ? ` @ ${lead.company}` : ""}
                </p>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span
                className={cn(
                  "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                  statusClasses(lead.status),
                )}
              >
                {statusLabel(lead.status)}
              </span>
              <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] text-muted-foreground">
                {lifecycleLabel(lead.status)}
              </span>
              {lead.score !== undefined && (
                <span className="tabular text-xs text-muted-foreground">
                  Score {lead.score}/100
                </span>
              )}
            </div>
            <dl className="mt-4 space-y-2 text-sm">
              <EditableEmailRow leadId={lead._id} email={lead.email} />
              <ContactRow icon={Phone} label="Phone" value={lead.phone} />
              <ContactRow
                icon={Globe}
                label="Website"
                value={lead.website}
              />
              <ContactRow icon={MapPin} label="Location" value={lead.location} />
              <ContactRow icon={Tag} label="Source" value={lead.source} />
              <CampaignRow campaignId={lead.campaignId} />
              <div className="flex items-start gap-2">
                <dt className="label-caps w-16 shrink-0 pt-1 text-muted-foreground/70">
                  Status
                </dt>
                <dd>
                  <select
                    aria-label="Change lead status"
                    value={lead.status}
                    onChange={async (e) => {
                      await setStatus({ id: lead._id, status: e.target.value });
                      toast(`Status set to ${statusLabel(e.target.value)}`);
                    }}
                    className="w-full rounded-md border border-input bg-background px-2 py-1.5 text-sm"
                  >
                    {LEAD_STATUSES.map((s) => (
                      <option key={s} value={s}>
                        {LEAD_STATUS_LABELS[s]}
                      </option>
                    ))}
                  </select>
                </dd>
              </div>
            </dl>
            <div className="mt-4 flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="flex-1"
                onClick={async () => {
                  await markContacted({ id: lead._id });
                  toast("Marked as contacted");
                }}
              >
                <Mail className="size-3.5" /> Mark contacted
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="text-destructive hover:text-destructive"
                onClick={handleDelete}
              >
                Delete
              </Button>
            </div>
          </section>

          {/* Notes */}
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <StickyNote className="size-4 text-muted-foreground" /> Notes
            </h2>
            <div className="mt-3 space-y-2">
              {(notes ?? []).length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No notes yet. Capture context here before outreach.
                </p>
              ) : (
                (notes ?? [])
                  .slice()
                  .reverse()
                  .map((n) => (
                    <div
                      key={n._id}
                      className="rounded-md border border-border bg-muted/40 px-3 py-2"
                    >
                      <p className="whitespace-pre-wrap text-sm">{n.body}</p>
                    </div>
                  ))
              )}
            </div>
            <Textarea
              value={noteText}
              onChange={(e) => setNoteText(e.target.value)}
              placeholder="Add a note — context you'll want before the next touchpoint."
              rows={3}
              className="mt-3"
            />
            <Button
              size="sm"
              className="mt-2"
              onClick={handleAddNote}
              disabled={!noteText.trim()}
            >
              Add note
            </Button>
          </section>
        </div>

        {/* Middle + right: intelligence and follow-ups */}
        <div className="flex flex-col gap-4 lg:col-span-2">
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <Sparkles className="size-4 text-muted-foreground" /> Lead intelligence
              </h2>
              {lead.aiGeneratedAt && (
                <span className="text-[11px] text-muted-foreground">
                  AI-generated {timeAgo(lead.aiGeneratedAt)} · verify before sending
                </span>
              )}
            </div>

            {lead.summary ? (
              <div className="mt-4">
                <div className="flex items-center gap-4">
                  {lead.score !== undefined ? (
                    <LeadScoreRing
                      score={lead.score}
                      size={88}
                      label="Estimated lead score"
                      breakdown={lead.scoreBreakdown}
                    />
                  ) : (
                    <span className="tabular text-4xl font-semibold tracking-tight">
                      {lead.score ?? "—"}
                    </span>
                  )}
                  <span className="text-xs text-muted-foreground">
                    / 100 estimated lead score
                  </span>
                </div>
                <p className="mt-4 text-sm leading-relaxed">{lead.summary}</p>

                {lead.painPoints && lead.painPoints.length > 0 && (
                  <>
                    <h3 className="label-caps mt-5 text-muted-foreground/70">
                      Potential pain points
                    </h3>
                    <ul className="mt-2 space-y-1.5">
                      {lead.painPoints.map((p) => (
                        <li key={p} className="flex gap-2 text-sm">
                          <span className="mt-2 size-1 shrink-0 rounded-full bg-foreground/50" />
                          {p}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                {lead.signals && lead.signals.length > 0 && (
                  <>
                    <h3 className="label-caps mt-5 text-muted-foreground/70">
                      Opportunity signals
                    </h3>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {lead.signals.map((s) => (
                        <Badge
                          key={s}
                          variant="outline"
                          className="font-normal text-muted-foreground"
                        >
                          {s}
                        </Badge>
                      ))}
                    </div>
                  </>
                )}

                {lead.approach && (
                  <div className="mt-5 rounded-md border border-border bg-secondary px-3 py-2.5">
                    <p className="label-caps text-muted-foreground">
                      Suggested angle
                    </p>
                    <p className="mt-1 text-sm">{lead.approach}</p>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 flex flex-col items-start rounded-md border border-dashed border-border px-4 py-8">
                <p className="text-sm font-medium">No analysis yet.</p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Run AI analysis to estimate fit, pain points and a suggested
                  angle — from the data you've captured.
                </p>
                <Button size="sm" className="mt-4" onClick={handleAnalyze} disabled={analyzing}>
                  {analyzing ? (
                    <>
                      <Loader2 className="size-4 animate-spin" /> Analyzing…
                    </>
                  ) : (
                    <>
                      <Sparkles className="size-4" /> Analyze with AI
                    </>
                  )}
                </Button>
              </div>
            )}
          </section>

          {/* Next best action — computed from measurable activity (§13) */}
          <NextBestActionCard
            lead={lead}
            onCompose={() => setComposerOpen(true)}
            onSchedule={() => setFollowUpOpen(true)}
          />

          {/* Deal block — value, probability, expected close (§17) */}
          <DealCard lead={lead} currency={dealCurrency(lead, workspaceCurrency)} onSave={async (fields) => {
            try {
              await updateDeal({ id: lead._id, ...fields });
              toast("Deal details saved");
            } catch {
              toast.error("Couldn't save deal details — try again.");
            }
          }} />

          {/* Proposals for this deal (Phase 2 §12) */}
          <DealProposalsCard dealId={lead._id} proposals={dealProposals} currency={workspaceCurrency} />

          {/* Stage history (Phase 2 §3) — recorded for new changes only */}
          <StageHistoryCard history={stageHistory} />

          {/* Message thread */}
          <MessageThread leadId={lead._id} leadName={lead.name} onCompose={() => setComposerOpen(true)} />

          {/* Follow-up timeline */}
          <section className="rounded-lg border border-border bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Follow-up timeline</h2>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFollowUpOpen(true)}
              >
                <CalendarPlus className="size-3.5" /> Schedule
              </Button>
            </div>
            {sortedFollowUps.length === 0 ? (
              <div className="mt-3 rounded-md border border-dashed border-border px-4 py-6 text-center">
                <p className="text-sm text-muted-foreground">
                  No follow-ups scheduled. The money is in the follow-up — set
                  the first one.
                </p>
              </div>
            ) : (
              <ol className="mt-4 space-y-0">
                {sortedFollowUps.map((f, i) => {
                  const overdue =
                    f.status === "pending" && f.dueAt < Date.now();
                  return (
                    <li key={f._id} className="relative flex gap-3 pb-5 last:pb-0">
                      {i < sortedFollowUps.length - 1 && (
                        <span
                          aria-hidden
                          className="absolute left-[7px] top-4 h-full w-px bg-border"
                        />
                      )}
                      <span
                        aria-hidden
                        className={cn(
                          "relative mt-1 flex size-[15px] shrink-0 items-center justify-center rounded-full border",
                          f.status === "done"
                            ? "border-[#171613] bg-[#171613]"
                            : overdue
                              ? "border-destructive/60 bg-destructive/10"
                              : "border-border bg-background",
                        )}
                      >
                        {f.status === "done" && (
                          <Check className="size-2.5 text-[#f5f0e6]" />
                        )}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <p
                            className={cn(
                              "text-sm font-medium",
                              f.status === "skipped" && "text-muted-foreground line-through",
                            )}
                          >
                            {f.note || "Follow up"}
                          </p>
                          <span
                            className={cn(
                              "text-xs",
                              overdue ? "text-destructive" : "text-muted-foreground",
                            )}
                          >
                            {f.status === "pending"
                              ? overdue
                                ? `overdue · ${timeAgo(f.dueAt)}`
                                : `due ${timeAgo(f.dueAt).replace(" from now", "")}`
                              : f.status === "done"
                                ? `done ${timeAgo(f.completedAt)}`
                                : "skipped"}
                          </span>
                        </div>
                        <div className="mt-1.5 flex gap-1.5">
                          {f.status === "pending" ? (
                            <>
                              <Button
                                variant="outline"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                onClick={async () => {
                                  await setFollowUpStatus({
                                    id: f._id,
                                    status: "done",
                                  });
                                  toast("Follow-up completed");
                                }}
                              >
                                <Check className="size-3" /> Done
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 px-2 text-[11px]"
                                onClick={() =>
                                  setFollowUpStatus({ id: f._id, status: "skipped" })
                                }
                              >
                                <X className="size-3" /> Skip
                              </Button>
                            </>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px]"
                              onClick={() =>
                                setFollowUpStatus({ id: f._id, status: "pending" })
                              }
                            >
                              Reopen
                            </Button>
                          )}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>
      </SpatialPage>

      {/* Shared outreach composer */}
      {lead && (
        <OutreachComposer
          leads={[lead]}
          open={composerOpen}
          onOpenChange={setComposerOpen}
          onSent={() => toast("Check the thread below — every send is logged.")}
        />
      )}

      {/* Mark Lost dialog — captures an honest, optional loss reason (§5) */}
      <Dialog open={lostDialogOpen} onOpenChange={setLostDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Mark deal lost</DialogTitle>
            <DialogDescription>
              Records when this deal was lost. Adding a reason helps you spot
              patterns later — it's optional.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="loss-reason">Why was it lost? (optional)</Label>
              <Textarea
                id="loss-reason"
                value={lossReason}
                onChange={(e) => setLossReason(e.target.value)}
                placeholder="Went with an in-house solution / budget frozen / chose a cheaper vendor…"
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setLostDialogOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleMarkLost()}>
              Mark Lost
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Schedule follow-up dialog */}
      <Dialog open={followUpOpen} onOpenChange={setFollowUpOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Schedule follow-up</DialogTitle>
            <DialogDescription>
              We'll surface this lead on your dashboard when it's due.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="fu-at">When</Label>
              <Input
                id="fu-at"
                type="datetime-local"
                value={followUpAt}
                onChange={(e) => setFollowUpAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="fu-note">What's the angle? (optional)</Label>
              <Input
                id="fu-note"
                value={followUpNote}
                onChange={(e) => setFollowUpNote(e.target.value)}
                placeholder="Share the 3-case-study deck"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFollowUpOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSchedule} disabled={!followUpAt}>
              Schedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

function MessageThread({
  leadId,
  leadName,
  onCompose,
}: {
  leadId: Id<"leads">;
  leadName: string;
  onCompose: () => void;
}) {
  const messages = useQuery(api.messages.threadForLead, { leadId });
  const sorted = useMemo(() => [...(messages ?? [])].sort((a, b) => a.createdAt - b.createdAt), [messages]);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <MessagesSquare className="size-4 text-muted-foreground" /> Outreach thread
        </h2>
        <Button variant="outline" size="sm" onClick={onCompose}>
          <Send className="size-3.5" /> Compose
        </Button>
      </div>
      {messages === undefined ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-5/6" />
        </div>
      ) : sorted.length === 0 ? (
        <div className="mt-3 rounded-md border border-dashed border-border px-4 py-6 text-center">
          <p className="text-sm text-muted-foreground">
            No messages yet. Every email or LinkedIn message you send or log for this lead lands here.
          </p>
        </div>
      ) : (
        <ol className="mt-4 space-y-3">
          {sorted.map((m) => {
            const outbound = m.direction === "sent";
            return (
              <li
                key={m._id}
                className={cn(
                  "max-w-[85%] rounded-lg border px-3.5 py-2.5",
                  outbound
                    ? "ml-auto border-[#171613]/25 bg-[#e4ddcf]"
                    : "border-border bg-muted/40",
                )}
              >
                <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                  <span className="font-medium text-foreground">
                    {outbound ? "You" : leadName}
                  </span>
                  <span className="capitalize">{m.channel}</span>
                  {m.subject && (
                    <span className="max-w-48 truncate">· {m.subject}</span>
                  )}
                  <span>· {timeAgo(m.createdAt)}</span>
                  {m.status === "failed" && (
                    <span className="text-destructive">· failed</span>
                  )}
                  {m.direction === "received" && !m.readAt && (
                    <span className="font-medium text-foreground/70">· new</span>
                  )}
                </div>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed">{m.body}</p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
 );
}

/** Proposals linked to this deal (§12) — real records only. */
function DealProposalsCard({
  dealId,
  proposals,
  currency,
}: {
  dealId: Id<"leads">;
  proposals: Doc<"proposals">[] | undefined;
  currency?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="size-4 text-muted-foreground" /> Proposals
        </h2>
        <Button asChild variant="outline" size="sm">
          <Link to={`/proposals?deal=${dealId}`}>
            <FileText className="size-3.5" /> Create proposal
          </Link>
        </Button>
      </div>
      {proposals === undefined ? (
        <div className="mt-3 space-y-2">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : proposals.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No proposals yet for this deal.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {proposals.map((p) => (
            <li key={p._id}>
              <Link
                to={`/proposals/${p._id}`}
                className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 transition-colors hover:border-[#b3a894]"
              >
                <span className="min-w-0 truncate text-sm font-medium">{p.title}</span>
                <span className="flex items-center gap-2 text-xs text-muted-foreground">
                  {p.value !== undefined && <span className="tabular">{money(p.value, p.currency ?? currency)}</span>}
                  <span className="rounded-full border border-border bg-card px-2 py-0.5 capitalize">{p.status}</span>
                  {p.sentAt !== undefined && <span>{timeAgo(p.sentAt)}</span>}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Stage history (§3) — only changes recorded after this feature shipped
 * appear here; older deals show an honest "no history yet" note.
 */
function StageHistoryCard({ history }: { history: Doc<"dealStageHistory">[] | undefined }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="flex items-center gap-2 text-sm font-semibold">
        <History className="size-4 text-muted-foreground" /> Stage history
      </h2>
      {history === undefined ? (
        <div className="mt-3">
          <Skeleton className="h-10 w-full" />
        </div>
      ) : history.length === 0 ? (
        <p className="mt-3 text-sm text-muted-foreground">
          No stage changes recorded yet — moves are tracked from now on.
        </p>
      ) : (
        <ol className="mt-3 space-y-1.5">
          {history.map((h) => (
            <li key={h._id} className="flex items-center gap-2 text-sm">
              <span className="tabular w-24 shrink-0 text-xs text-muted-foreground">
                {formatDateTime(h.at)}
              </span>
              <span>
                {h.from ? `${statusLabel(h.from)} → ${statusLabel(h.to)}` : `entered ${statusLabel(h.to)}`}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

/** Next Best Action — derived from measurable activity only (§13). */
function NextBestActionCard({
  lead,
  onCompose,
  onSchedule,
}: {
  lead: Lead;
  onCompose: () => void;
  onSchedule: () => void;
}) {
  const action = nextBestAction(lead);
  if (!action) return null;
  return (
    <section className="rounded-lg border border-[#6f4b5e]/30 bg-[#6f4b5e]/[0.05] p-5">
      <p className="label-caps text-[#6f4b5e]">Next best action</p>
      <p className="mt-2 text-sm leading-relaxed">{action.text}</p>
      <p className="mt-1 text-xs text-muted-foreground">Because: {action.reason}</p>
      <div className="mt-3 flex gap-2">
        {action.to === "compose" && (
          <Button size="sm" onClick={onCompose}>
            <Send className="size-3.5" /> Compose outreach
          </Button>
        )}
        {action.to === "followup" && (
          <Button size="sm" onClick={onSchedule}>
            <CalendarPlus className="size-3.5" /> Schedule follow-up
          </Button>
        )}
      </div>
    </section>
  );
}

/** Deal CRM block — value, probability, expected close (§17). */
function DealCard({
  lead,
  onSave,
  currency,
}: {
  lead: Lead;
  onSave: (fields: {
    dealValue?: number;
    probability?: number;
    expectedCloseAt?: number;
  }) => Promise<void>;
  currency?: string;
}) {
  const [value, setValue] = useState(lead.dealValue?.toString() ?? "");
  const [probability, setProbability] = useState(lead.probability?.toString() ?? "");
  const [closeDate, setCloseDate] = useState(
    lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toISOString().slice(0, 10) : "",
  );
  const [saving, setSaving] = useState(false);

  // Keep the draft in sync if the record changes underneath us.
  useEffect(() => {
    setValue(lead.dealValue?.toString() ?? "");
    setProbability(lead.probability?.toString() ?? "");
    setCloseDate(lead.expectedCloseAt ? new Date(lead.expectedCloseAt).toISOString().slice(0, 10) : "");
  }, [lead.dealValue, lead.probability, lead.expectedCloseAt]);

  const save = async () => {
    setSaving(true);
    try {
      await onSave({
        dealValue: value.trim() ? Number(value.replace(/[^0-9.]/g, "")) || undefined : undefined,
        probability: probability.trim() ? Number(probability.replace(/[^0-9.]/g, "")) || undefined : undefined,
        expectedCloseAt: closeDate ? new Date(closeDate).getTime() : undefined,
      });
    } finally {
      setSaving(false);
    }
  };

  const weighted = weightedValue(
    lead.dealValue,
    lead.probability,
    lead.status,
  );
  const flags = lead.status !== "won" && lead.status !== "lost" ? dealFlags(lead) : [];
  const last = lastActivityOf(lead);

  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold">
          <CircleDollarSign className="size-4 text-muted-foreground" /> Deal
        </h2>
        <span className="text-[11px] text-muted-foreground">
          default {defaultProbability(lead.status)}% for {statusLabel(lead.status)} stage
        </span>
      </div>
      {lead.wonAt !== undefined && (
        <p className="mt-2 rounded-md border border-[#53634a]/40 bg-[#53634a]/[0.1] px-3 py-1.5 text-xs text-[#42503c]">
          Won {formatDateTime(lead.wonAt)} — this value counts as actual won revenue.
        </p>
      )}
      {lead.lostAt !== undefined && (
        <p className="mt-2 rounded-md border border-border bg-muted/40 px-3 py-1.5 text-xs text-muted-foreground">
          Lost {formatDateTime(lead.lostAt)}
          {lead.lossReason ? ` — ${lead.lossReason}` : ""}
        </p>
      )}
      {flags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {flags.slice(0, 2).map((f) => (
            <span
              key={f.kind}
              title={f.detail}
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                DEAL_FLAG_CLASSES[f.kind],
              )}
            >
              {DEAL_FLAG_LABELS[f.kind]} · {f.detail}
            </span>
          ))}
        </div>
      )}
      <div className="mt-3 grid gap-2.5 sm:grid-cols-3">
        <div className="grid gap-1">
          <Label htmlFor="deal-value" className="text-xs">Deal value</Label>
          <Input
            id="deal-value"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            inputMode="numeric"
            placeholder="12,000"
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="deal-probability" className="text-xs">Probability %</Label>
          <Input
            id="deal-probability"
            value={probability}
            onChange={(e) => setProbability(e.target.value)}
            inputMode="numeric"
            placeholder={`${defaultProbability(lead.status)}`}
          />
        </div>
        <div className="grid gap-1">
          <Label htmlFor="deal-close" className="text-xs">Expected close</Label>
          <Input
            id="deal-close"
            type="date"
            value={closeDate}
            onChange={(e) => setCloseDate(e.target.value)}
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {lead.dealValue !== undefined
            ? `Weighted value ${money(weighted, currency)} (value × probability) — an estimate, not a forecast promise.`
            : "Set a value so this deal counts toward pipeline and revenue."}
          {last !== undefined && ` · Last activity ${timeAgo(last)}`}
        </p>
        <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving}>
          {saving ? <Loader2 className="size-3 animate-spin" /> : "Save"}
        </Button>
      </div>
    </section>
  );
}

/** Inline-editable email so leads imported without one (or sample data)
 *  can be pointed at a real inbox before outreach. */
function EditableEmailRow({
  leadId,
  email,
}: {
  leadId: Id<"leads">;
  email?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(email ?? "");
  const [saving, setSaving] = useState(false);
  const updateLead = useMutation(api.leads.update);

  const save = async () => {
    setSaving(true);
    try {
      // Empty string clears the field; anything else becomes the new address.
      await updateLead({ id: leadId, email: draft.trim() });
      toast(
        draft.trim() ? "Email updated — you can send outreach to it now" : "Email cleared",
      );
      setEditing(false);
    } catch {
      toast.error("Couldn't update the email — try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-start gap-2">
      <dt className="label-caps flex w-16 shrink-0 items-center gap-1 pt-1 text-muted-foreground/70">
        <Mail className="size-3" /> Email
      </dt>
      <dd className="min-w-0 flex-1">
        {editing ? (
          <div className="flex items-center gap-1.5">
            <Input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="you@yourmail.com"
              type="email"
              autoFocus
              className="h-7 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Enter") void save();
                if (e.key === "Escape") {
                  setEditing(false);
                  setDraft(email ?? "");
                }
              }}
            />
            <Button size="sm" className="h-7 px-2 text-xs" onClick={() => void save()} disabled={saving}>
              Save
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={() => {
                setEditing(false);
                setDraft(email ?? "");
              }}
            >
              Cancel
            </Button>
          </div>
        ) : email ? (
          <div className="flex items-center gap-1.5">
            <span className="min-w-0 flex-1 truncate text-sm">{email}</span>
            <button
              type="button"
              aria-label="Edit email"
              onClick={() => {
                setDraft(email);
                setEditing(true);
              }}
              className="rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <Pencil className="size-3" />
            </button>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1 border-dashed text-xs"
            onClick={() => {
              setDraft("");
              setEditing(true);
            }}
          >
            <Pencil className="size-3" /> Add email address
          </Button>
        )}
      </dd>
    </div>
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
      <dt className="label-caps flex w-16 shrink-0 items-center gap-1 pt-1 text-muted-foreground/70">
        <Icon className="size-3" /> {label}
      </dt>
      <dd className="min-w-0 flex-1 truncate text-sm">
        {value ? (
          value
        ) : (
          <span className="text-muted-foreground/60">—</span>
        )}
      </dd>
    </div>
  );
}

/** Campaign attribution (§8) — shown only when real attribution exists. The
 *  name resolves through an ownership-checked query; a deleted or inaccessible
 *  campaign degrades to an honest "Campaign-linked" label, never a guess. */
function CampaignRow({ campaignId }: { campaignId?: Id<"campaigns"> }) {
  const name = useQuery(
    api.campaigns.getName,
    campaignId ? { id: campaignId } : "skip",
  );
  return (
    <div className="flex items-start gap-2">
      <dt className="label-caps flex w-16 shrink-0 items-center gap-1 pt-1 text-muted-foreground/70">
        <Megaphone className="size-3" /> Campaign
      </dt>
      <dd className="min-w-0 flex-1 truncate text-sm">
        {campaignId === undefined ? (
          <span className="text-muted-foreground/60">No campaign attribution</span>
        ) : (
          name ?? "Campaign-linked"
        )}
      </dd>
    </div>
  );
}
