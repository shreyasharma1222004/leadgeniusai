import { AppShell } from "@/components/AppShell";
import { AIButton } from "@/components/spatial";
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
import { formatDateTime, timeAgo } from "@/lib/format";
import { currencySymbol, money } from "@/lib/growth";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import {
  ArrowLeft,
  Check,
  CircleDollarSign,
  Eye,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { toast } from "sonner";

type Proposal = Doc<"proposals">;
type Lead = Doc<"leads">;

const STATUS_CLASSES: Record<string, string> = {
  draft: "border-border bg-secondary text-secondary-foreground",
  sent: "border-[#a06b3c]/40 bg-[#a06b3c]/[0.1] text-[#82552e]",
  viewed: "border-[#6f4b5e]/35 bg-[#6f4b5e]/[0.08] text-[#6f4b5e]",
  accepted: "border-[#53634a]/45 bg-[#53634a]/[0.14] text-[#42503c]",
  rejected: "border-border bg-transparent text-muted-foreground/70 line-through",
};

const SECTIONS = [
  { key: "summary", label: "Executive summary", placeholder: "What the client needs and what you propose.", rows: 4 },
  { key: "problem", label: "Problem", placeholder: "The client's documented problem.", rows: 4 },
  { key: "solution", label: "Solution", placeholder: "Your proposed approach.", rows: 4 },
  { key: "deliverables", label: "Deliverables", placeholder: "One deliverable per line.", rows: 5 },
  { key: "timeline", label: "Timeline", placeholder: "Expected project timeline.", rows: 3 },
  { key: "pricing", label: "Pricing", placeholder: "Clear pricing structure.", rows: 3 },
  { key: "outcomes", label: "Expected outcomes", placeholder: "Concrete outcomes — no guarantees you can't back.", rows: 3 },
  { key: "nextSteps", label: "Next steps", placeholder: "What the client needs to do next.", rows: 3 },
] as const;

type SectionKey = (typeof SECTIONS)[number]["key"];

function emptyDraft(): Record<SectionKey, string> {
  return { summary: "", problem: "", solution: "", deliverables: "", timeline: "", pricing: "", outcomes: "", nextSteps: "" };
}

export default function ProposalsPage() {
  const { id } = useParams<{ id: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();

  const proposals = useQuery(api.proposals.list, {});
  const leads = useQuery(api.leads.list, {});
  const create = useMutation(api.proposals.create);
  const update = useMutation(api.proposals.update);
  const markSent = useMutation(api.proposals.markSent);
  const markAccepted = useMutation(api.proposals.markAccepted);
  const markRejected = useMutation(api.proposals.markRejected);
  const revertToDraft = useMutation(api.proposals.revertToDraft);
  const remove = useMutation(api.proposals.remove);
  const proposalAssist = useAction(api.ai.proposalAssist);
  const profile = useQuery(api.business.myProfile, {});
  // Workspace currency default; the proposal's own currency wins when set.
  const workspaceCurrency = profile?.currency ?? undefined;
  const proposalCurrency = (p: { currency?: string }) => p.currency ?? workspaceCurrency;

  const [building, setBuilding] = useState(false);
  const [editId, setEditId] = useState<Id<"proposals"> | null>(null);
  const [dealId, setDealId] = useState<string>("");
  const [title, setTitle] = useState("");
  const [value, setValue] = useState("");
  const [sections, setSections] = useState<Record<SectionKey, string>>(emptyDraft());
  const [saving, setSaving] = useState(false);
  const [previewId, setPreviewId] = useState<Id<"proposals"> | null>(null);
  // Explicit confirmation for "Mark sent" (Phase 2 cleanup item 3): the dialog
  // states plainly that Dealflow did NOT send anything — the user is recording
  // their own real-world action. No delivery or view tracking is claimed.
  const [sentDialogOpen, setSentDialogOpen] = useState(false);
  const [assistLoading, setAssistLoading] = useState(false);
  const [assistError, setAssistError] = useState<string | null>(null);

  // Deep link: /proposals?deal=<id> opens the builder pre-attached to a deal.
  useEffect(() => {
    const deal = searchParams.get("deal");
    if (deal && proposals !== undefined && leads !== undefined && !building && !editId) {
      if (leads.some((l) => l._id === deal)) {
        setDealId(deal);
        setBuilding(true);
      }
      setSearchParams({}, { replace: true });
    }
  }, [searchParams, proposals, leads, building, editId, setSearchParams]);

  const openProposal = id ? (proposals ?? []).find((p) => p._id === id) : undefined;

  const dealById = useMemo(() => new Map((leads ?? []).map((l) => [l._id, l])), [leads]);
  const openDeals = (leads ?? []).filter(
    (l) => l.status !== "won" && l.status !== "lost",
  );

  const resetForm = () => {
    setBuilding(false);
    setEditId(null);
    setDealId("");
    setTitle("");
    setValue("");
    setSections(emptyDraft());
    setAssistError(null);
  };

  const startEdit = (p: Proposal) => {
    setEditId(p._id);
    setDealId(p.dealId);
    setTitle(p.title);
    setValue(p.value?.toString() ?? "");
    setSections({
      summary: p.summary ?? "",
      problem: p.problem ?? "",
      solution: p.solution ?? "",
      deliverables: (p.deliverables ?? []).join("\n"),
      timeline: p.timeline ?? "",
      pricing: p.pricing ?? "",
      outcomes: p.outcomes ?? "",
      nextSteps: p.nextSteps ?? "",
    });
    setBuilding(true);
  };

  const saveDraft = async () => {
    if (!title.trim()) {
      toast.error("Give the proposal a title.");
      return;
    }
    if (!editId && !dealId) {
      toast.error("Pick the deal this proposal belongs to.");
      return;
    }
    setSaving(true);
    try {
      const fields = {
        title: title.trim(),
        value: value.trim() ? Number(value.replace(/[^0-9.]/g, "")) : undefined,
        summary: sections.summary.trim() || undefined,
        problem: sections.problem.trim() || undefined,
        solution: sections.solution.trim() || undefined,
        deliverables: sections.deliverables.trim()
          ? sections.deliverables.split("\n").map((s) => s.trim()).filter(Boolean)
          : undefined,
        timeline: sections.timeline.trim() || undefined,
        pricing: sections.pricing.trim() || undefined,
        outcomes: sections.outcomes.trim() || undefined,
        nextSteps: sections.nextSteps.trim() || undefined,
      };
      if (editId) {
        await update({ id: editId, ...fields });
        toast("Proposal saved");
      } else {
        await create({ dealId: dealId as Id<"leads">, ...fields });
        toast("Draft saved");
      }
      resetForm();
    } catch {
      toast.error("Couldn't save the proposal — try again.");
    } finally {
      setSaving(false);
    }
  };

  const runAssist = async () => {
    const deal = dealId ? dealById.get(dealId as Id<"leads">) : undefined;
    if (!deal) {
      toast.error("Pick a deal first — the AI drafts from the deal and client context.");
      return;
    }
    setAssistLoading(true);
    setAssistError(null);
    try {
      const result = await proposalAssist({
        profile: profile
          ? {
              businessName: profile.businessName,
              industry: profile.industry,
              products: profile.products,
              businessModel: profile.businessModel,
              description: profile.description,
            }
          : undefined,
        lead: {
          name: deal.name,
          company: deal.company,
          jobTitle: deal.jobTitle,
          industry: deal.industry,
          notes: deal.notes,
          painPoints: deal.painPoints,
          summary: deal.summary,
        },
        deal: {
          dealValue: deal.dealValue,
          expectedCloseAt: deal.expectedCloseAt,
          stage: deal.status,
          source: deal.source,
        },
        proposal: { title: title.trim() || undefined },
      });
      if (!result) {
        setAssistError(
          "AI assistance isn't available right now (no OPENAI_API_KEY configured, or the provider couldn't be reached). You can still write the proposal by hand — it saves either way.",
        );
        return;
      }
      setSections((prev) => ({
        ...prev,
        summary: result.summary || prev.summary,
        problem: result.problem || prev.problem,
        solution: result.solution || prev.solution,
        deliverables: result.deliverables.length ? result.deliverables.join("\n") : prev.deliverables,
        timeline: result.timeline || prev.timeline,
        outcomes: result.outcomes || prev.outcomes,
        nextSteps: result.nextSteps || prev.nextSteps,
      }));
      if (result.missingInfo.length > 0) {
        toast("Drafted — with gaps", {
          description: `More client information is needed to personalize: ${result.missingInfo.join("; ")}`,
        });
      } else {
        toast("Sections drafted from your workspace data — review before saving.");
      }
    } catch {
      setAssistError("Generating the draft failed — try again in a moment.");
    } finally {
      setAssistLoading(false);
    }
  };

  const exportProposal = (p: Proposal) => {
    const deal = dealById.get(p.dealId);
    const L: string[] = [];
    L.push(`# ${p.title}`);
    if (deal) L.push(`\n**Client:** ${deal.company ?? deal.name}${deal.company ? ` (${deal.name})` : ""}`);
    if (p.value !== undefined) L.push(`**Value:** ${money(p.value, proposalCurrency(p))}`);
    const section = (label: string, body?: string | string[]) => {
      if (!body || (Array.isArray(body) && body.length === 0)) return;
      L.push(`\n## ${label}`);
      if (Array.isArray(body)) body.forEach((d) => L.push(`- ${d}`));
      else L.push(body);
    };
    section("Executive Summary", p.summary);
    section("Problem", p.problem);
    section("Solution", p.solution);
    section("Deliverables", p.deliverables);
    section("Timeline", p.timeline);
    section("Pricing", p.pricing ?? (p.value !== undefined ? money(p.value, proposalCurrency(p)) : undefined));
    section("Expected Outcomes", p.outcomes);
    section("Next Steps", p.nextSteps);
    L.push(`\n---\nGenerated from Dealflow AI on ${new Date().toLocaleDateString()} — all content from your saved proposal data.`);
    const blob = new Blob([L.join("\n")], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${p.title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast("Exported as Markdown — generated from the actual proposal data");
  };

  const statusPill = (status: string) => (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium capitalize",
        STATUS_CLASSES[status] ?? STATUS_CLASSES.draft,
      )}
    >
      {status}
    </span>
  );

  // ── Detail view: /proposals/:id ─────────────────────────────────────────
  if (id && openProposal) {
    const p = openProposal;
    const deal = dealById.get(p.dealId);
    const canDecide = p.status === "sent" || p.status === "viewed" || p.status === "draft";
    return (
      <AppShell
        title={
          <span className="flex items-center gap-2">
            <Link
              to="/proposals"
              className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Back to proposals"
            >
              <ArrowLeft className="size-4" />
            </Link>
            {p.title}
          </span>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {statusPill(p.status)}
            {p.status === "draft" && (
              <Button size="sm" onClick={() => setSentDialogOpen(true)}>
                <Send className="size-3.5" /> Mark sent
              </Button>
            )}
            {(p.status === "sent" || p.status === "viewed") && (
              <>
                <Button size="sm" variant="outline" className="text-[#53634a]" onClick={() => void markAccepted({ id: p._id }).then(() => toast.success("Proposal accepted"))}>
                  <Check className="size-3.5" /> Accepted
                </Button>
                <Button size="sm" variant="outline" className="text-destructive" onClick={() => void markRejected({ id: p._id }).then(() => toast("Proposal marked rejected"))}>
                  <X className="size-3.5" /> Rejected
                </Button>
              </>
            )}
            {canDecide && p.status !== "draft" && (
              <Button size="sm" variant="ghost" onClick={() => void revertToDraft({ id: p._id })}>
                Back to draft
              </Button>
            )}
            <Button size="sm" variant="outline" onClick={() => startEdit(p)}>
              <Pencil className="size-3.5" /> Edit
            </Button>
            <Button size="sm" variant="outline" onClick={() => exportProposal(p)}>
              Export
            </Button>
          </div>
        }
      >
        <p className="-mt-3 mb-4 text-sm text-muted-foreground">
          {deal ? (
            <>For deal <Link className="underline underline-offset-4 hover:text-foreground" to={`/leads/${deal._id}`}>{deal.company ?? deal.name}</Link></>
          ) : (
            "The linked deal no longer exists."
          )}
          {p.sentAt !== undefined && ` · sent ${timeAgo(p.sentAt)}`}
          {p.acceptedAt !== undefined && ` · accepted ${timeAgo(p.acceptedAt)}`}
          {p.rejectedAt !== undefined && ` · rejected ${timeAgo(p.rejectedAt)}`}
        </p>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-4 lg:col-span-2">
            {SECTIONS.map((s) => {
              const body = p[s.key as keyof Proposal] as string | string[] | undefined;
              const empty = !body || (Array.isArray(body) && body.length === 0);
              return (
                <section key={s.key} className="rounded-lg border border-border bg-card p-5">
                  <h2 className="label-caps text-muted-foreground">{s.label}</h2>
                  {empty ? (
                    <p className="mt-2 text-sm italic text-muted-foreground/60">Not written yet.</p>
                  ) : Array.isArray(body) ? (
                    <ul className="mt-2 space-y-1">
                      {body.map((d, i) => (
                        <li key={i} className="flex gap-2 text-sm">
                          <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/50" />
                          {d}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{body}</p>
                  )}
                </section>
              );
            })}
          </div>
          <div className="space-y-4">
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Value</h2>
              <p className="tabular mt-2 text-2xl font-semibold">{p.value !== undefined ? money(p.value, proposalCurrency(p)) : "—"}</p>
            </section>
            <section className="rounded-lg border border-border bg-muted/30 p-5">
              <h2 className="text-sm font-semibold">Timestamps</h2>
              <dl className="mt-3 space-y-2 text-sm">
                <Row label="Created" value={formatDateTime(p.createdAt)} />
                <Row label="Sent" value={p.sentAt !== undefined ? formatDateTime(p.sentAt) : "Not sent"} />
                <Row
                  label="Viewed"
                  value={
                    p.viewedAt !== undefined
                      ? formatDateTime(p.viewedAt)
                      : "Not tracked — view tracking isn't built yet, so this stays empty rather than pretending."
                  }
                />
                <Row label="Accepted" value={p.acceptedAt !== undefined ? formatDateTime(p.acceptedAt) : "—"} />
                <Row label="Rejected" value={p.rejectedAt !== undefined ? formatDateTime(p.rejectedAt) : "—"} />
                {p.rejectedReason && <Row label="Reason" value={p.rejectedReason} />}
              </dl>
              <p className="mt-4 rounded-md border border-border bg-background px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
                “Sent” is recorded by you after delivering the proposal yourself — Dealflow does not
                send proposals, and no delivery or view tracking exists. The viewed timestamp is
                reserved for a future real tracking mechanism and stays empty for now.
              </p>
            </section>
          </div>
        </div>

        {/* Mark-sent confirmation — honest about what actually happens */}
        <Dialog open={sentDialogOpen} onOpenChange={setSentDialogOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Mark proposal as sent?</DialogTitle>
              <DialogDescription>
                This records that YOU sent the proposal externally (email, meeting, or however you
                deliver it). Dealflow itself did not send this proposal, and no delivery or view
                tracking is claimed — the “viewed” timestamp stays empty until real tracking exists.
              </DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" onClick={() => setSentDialogOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={() => {
                  setSentDialogOpen(false);
                  void markSent({ id: p._id }).then(() =>
                    toast("Marked as sent manually — Dealflow did not send this proposal."),
                  );
                }}
              >
                <Send className="size-3.5" /> Record as sent
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </AppShell>
    );
  }

  if (id && !openProposal && proposals !== undefined) {
    return (
      <AppShell title="Proposals">
        <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <h2 className="text-lg font-semibold">Proposal not found.</h2>
          <p className="mt-1 text-sm text-muted-foreground">It may have been deleted, or belongs to another workspace.</p>
          <Button asChild className="mt-5">
            <Link to="/proposals">Back to proposals</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  // ── List view ────────────────────────────────────────────────────────────
  const ready = proposals !== undefined && leads !== undefined;
  const statusFilter = searchParams.get("status");
  const filtered = (proposals ?? []).filter((p) => !statusFilter || p.status === statusFilter);

  return (
    <AppShell
      title="Proposals"
      actions={
        <Button onClick={() => { resetForm(); setBuilding(true); }}>
          <Plus className="size-4" /> New proposal
        </Button>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Persisted proposals linked to your deals. Status changes are recorded with real timestamps —
        nothing is faked: “viewed” can't be tracked yet, so no proposal is ever auto-marked viewed.
      </p>

      {!ready ? (
        <div className="grid gap-3 sm:grid-cols-2">
          <Skeleton className="h-28 rounded-lg" />
          <Skeleton className="h-28 rounded-lg" />
        </div>
      ) : filtered.length === 0 && !building ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <FileText className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">
            {proposals.length === 0 ? "No proposals yet." : `No ${statusFilter} proposals.`}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {proposals.length === 0
              ? "Create one from an active deal — the deal page has a “Create proposal” action."
              : "Try a different status filter."}
          </p>
          {proposals.length === 0 && (
            <Button className="mt-5" onClick={() => setBuilding(true)}>
              <Plus className="size-4" /> Create a proposal
            </Button>
          )}
        </div>
      ) : (
        <>
          {building && (
            <section className="mb-6 rounded-xl border border-[#6f4b5e]/30 bg-[#6f4b5e]/[0.04] p-5">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-semibold">{editId ? "Edit proposal" : "New proposal"}</h2>
                <Button variant="ghost" size="sm" onClick={resetForm}>Cancel</Button>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                <div className="grid gap-1.5 sm:col-span-2">
                  <Label htmlFor="p-title">Title</Label>
                  <Input id="p-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Website conversion sprint — Acme" />
                </div>
                {!editId && (
                  <div className="grid gap-1.5">
                    <Label htmlFor="p-deal">Deal</Label>
                    <select
                      id="p-deal"
                      value={dealId}
                      onChange={(e) => setDealId(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="">Pick a deal…</option>
                      {openDeals.map((d) => (
                        <option key={d._id} value={d._id}>
                          {d.company ?? d.name} — {d.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
                <div className="grid gap-1.5">
                  <Label htmlFor="p-value">Value ({currencySymbol(workspaceCurrency)}, optional)</Label>
                  <Input id="p-value" value={value} onChange={(e) => setValue(e.target.value)} inputMode="numeric" placeholder="12000" />
                </div>
              </div>

              <div className="mt-4 flex flex-wrap items-center justify-between gap-2">
                <p className="text-xs text-muted-foreground">
                  AI drafts from your business profile, the linked lead's recorded context, and the deal — never invented client facts.
                </p>
                <AIButton size="sm" onClick={() => void runAssist()} disabled={assistLoading || (!dealId && !editId)}>
                  {assistLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                  Draft with AI
                </AIButton>
              </div>
              {assistError && (
                <p className="mt-2 rounded-md border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-3 py-2 text-xs text-[#82552e]">
                  {assistError}
                </p>
              )}

              <div className="mt-4 grid gap-3">
                {SECTIONS.map((s) => (
                  <div key={s.key} className="grid gap-1.5">
                    <Label htmlFor={`p-${s.key}`}>{s.label}</Label>
                    <Textarea
                      id={`p-${s.key}`}
                      value={sections[s.key]}
                      onChange={(e) => setSections((prev) => ({ ...prev, [s.key]: e.target.value }))}
                      placeholder={s.placeholder}
                      rows={s.rows}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <Button variant="outline" onClick={resetForm}>Cancel</Button>
                <Button onClick={() => void saveDraft()} disabled={saving}>
                  {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                  {editId ? "Save changes" : "Save draft"}
                </Button>
              </div>
            </section>
          )}

          <ul className="grid gap-3 sm:grid-cols-2">
            {filtered.map((p) => {
              const deal = dealById.get(p.dealId);
              return (
                <motion.li
                  key={p._id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                >
                  <Link
                    to={`/proposals/${p._id}`}
                    className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-[#b3a894]"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <p className="min-w-0 truncate text-sm font-medium">{p.title}</p>
                      {statusPill(p.status)}
                    </div>
                    <p className="mt-1 truncate text-xs text-muted-foreground">
                      {deal ? (deal.company ?? deal.name) : "Deal removed"}
                      {p.value !== undefined && ` · ${money(p.value, proposalCurrency(p))}`}
                      {p.sentAt !== undefined && ` · sent ${timeAgo(p.sentAt)}`}
                    </p>
                  </Link>
                </motion.li>
              );
            })}
          </ul>
        </>
      )}
    </AppShell>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="text-right">{value}</dd>
    </div>
  );
}
