import { AppShell } from "@/components/AppShell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { useAuth } from "@/hooks/use-auth";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  Loader2,
  Mail,
  Plus,
  Send,
  Target,
  Trash2,
  Users,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { DEFAULT_SEND_LIMITS } from "@/lib/sendLimits";

type Campaign = Doc<"campaigns">;
type Lead = Doc<"leads">;

const EMPTY = {
  name: "",
  description: "",
  channel: "email",
  subject: "",
  body: "",
};

export default function CampaignsPage() {
  useAuth();
  const [detailId, setDetailId] = useState<string | null>(null);
  const campaigns = useQuery(api.campaigns.list, {});
  const leads = useQuery(api.leads.list, {});
  const detail = useQuery(api.campaigns.getWithLeads, detailId ? { id: detailId as never } : "skip");

  const create = useMutation(api.campaigns.create);
  const remove = useMutation(api.campaigns.remove);
  const setStatus = useMutation(api.campaigns.setStatus);
  const sendAll = useAction(api.campaigns.sendAll);
  const markSentManually = useMutation(api.campaigns.markSentManually);
  const removeLead = useMutation(api.campaigns.removeLead);

  const [creatorOpen, setCreatorOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [selectedLeads, setSelectedLeads] = useState<Set<Id<"leads">>>(new Set());
  const [saving, setSaving] = useState(false);
  const [sending, setSending] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Campaign | null>(null);
  const [confirmSend, setConfirmSend] = useState<Campaign | null>(null);

  if (campaigns === undefined || leads === undefined) {
    return (
      <AppShell title="Campaigns">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </AppShell>
    );
  }

  const emailLeads = leads.filter((l) => l.email);

  const toggleLead = (id: Id<"leads">) => {
    setSelectedLeads((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleCreate = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast.error("Campaign name and message are required.");
      return;
    }
    if (selectedLeads.size === 0) {
      toast.error("Pick at least one recipient.");
      return;
    }
    setSaving(true);
    try {
      const result = await create({
        name: form.name.trim(),
        description: form.description.trim() || undefined,
        channel: form.channel,
        subject: form.subject.trim() || undefined,
        body: form.body,
        leadIds: [...selectedLeads] as Id<"leads">[],
      });
      toast(`Campaign created with ${result.added} recipient${result.added === 1 ? "" : "s"}`);
      setCreatorOpen(false);
      setForm(EMPTY);
      setSelectedLeads(new Set());
      setDetailId(result.campaignId);
    } catch {
      toast.error("Couldn't create the campaign — try again.");
    } finally {
      setSaving(false);
    }
  };

  // Confirmation-first sending (production hardening §4): the button opens a
  // dialog with recipient counts and limits; the actual send only starts after
  // an explicit confirm. Large sends show an extra warning.
  const handleSend = async (campaign: Campaign) => {
    setConfirmSend(null);
    setSending(true);
    try {
      const result = await sendAll({ id: campaign._id });
      if (result.sent > 0) {
        toast(`Sent ${result.sent} email${result.sent === 1 ? "" : "s"}`, {
          description: [
            result.failed > 0 ? `${result.failed} failed — see statuses below.` : undefined,
            result.skipped > 0 ? `${result.skipped} still pending.` : undefined,
          ]
            .filter(Boolean)
            .join(" "),
          duration: 8000,
        });
      } else {
        toast(result.reason ?? "Nothing to send", { duration: 8000 });
      }
      if (result.failures?.length) {
        toast.error(result.failures[0], { duration: 8000 });
      }
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Send failed — check the campaign and try again.",
        { duration: 8000 },
      );
    } finally {
      setSending(false);
    }
  };

  const handleMarkManual = async (campaign: Campaign) => {
    const pendingIds = (detail?.rows ?? [])
      .filter((r) => r.status === "pending")
      .map((r) => r._id as never);
    if (pendingIds.length === 0) return;
    try {
      const result = await markSentManually({ id: campaign._id, rowIds: pendingIds });
      toast(`Logged ${result.marked} manual send${result.marked === 1 ? "" : "s"}`);
    } catch {
      toast.error("Couldn't update the campaign.");
    }
  };

  return (
    <AppShell
      title="Campaigns"
      actions={
        <Button
          onClick={() => {
            setForm(EMPTY);
            setSelectedLeads(new Set(emailLeads.slice(0, 5).map((l) => l._id)));
            setCreatorOpen(true);
          }}
        >
          <Plus className="size-4" /> New campaign
        </Button>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Send one message to many leads — personalized per recipient, tracked per lead.
      </p>

      {campaigns.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <Target className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No campaigns yet.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Group leads into a campaign, write once, and send — every reply lands in the lead's
            thread and your Inbox.
          </p>
          <Button
            className="mt-5"
            onClick={() => {
              setForm(EMPTY);
              setCreatorOpen(true);
            }}
          >
            <Plus className="size-4" /> Create your first campaign
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {campaigns.map((campaign) => (
            <div
              key={campaign._id}
              className="depth-card depth-card-hover flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{campaign.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {campaign.channel === "email" ? "Email" : "LinkedIn"} · created{" "}
                    {timeAgo(campaign.createdAt)}
                  </p>
                </div>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[10px] font-medium " +
                    (campaign.status === "active"
                      ? "border border-[#171613]/40 bg-[#171613] text-[#f5f0e6]"
                      : campaign.status === "completed"
                        ? "border border-border bg-secondary text-muted-foreground"
                        : "border border-border bg-card text-muted-foreground/70")
                  }
                >
                  {campaign.status}
                </span>
              </div>
              {campaign.description && (
                <p className="mt-2 line-clamp-2 text-xs text-muted-foreground">
                  {campaign.description}
                </p>
              )}
              <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[13px] text-muted-foreground">
                {campaign.body}
              </p>
              <div className="mt-3 flex-1" />
              <div className="mt-3 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  className="h-7 gap-1 text-xs"
                  disabled={sending}
                  onClick={() => setConfirmSend(campaign)}
                >
                  {sending ? <Loader2 className="size-3 animate-spin" /> : <Send className="size-3" />}
                  Send pending
                </Button>
                <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDetailId(campaign._id)}>
                  <Users className="size-3" /> Recipients
                </Button>
                {campaign.status === "active" && (
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-7 text-xs"
                    onClick={async () => {
                      await setStatus({ id: campaign._id, status: "completed" });
                      toast("Campaign marked completed");
                    }}
                  >
                    Complete
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-destructive hover:text-destructive"
                  aria-label={`Delete ${campaign.name}`}
                  onClick={() => setConfirmDelete(campaign)}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Creator dialog */}
      <Dialog open={creatorOpen} onOpenChange={setCreatorOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>New campaign</DialogTitle>
            <DialogDescription>
              Write once — tokens like <code className="rounded bg-muted px-1">{"{{first_name}}"}</code>{" "}
              personalize per recipient on send.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="camp-name">Campaign name</Label>
              <Input
                id="camp-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Q3 design agencies outreach"
              />
            </div>
            <div className="grid gap-1.5 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label>Channel</Label>
                <div className="flex gap-2">
                  {(["email", "linkedin"] as const).map((c) => (
                    <button
                      key={c}
                      type="button"
                      aria-pressed={form.channel === c}
                      onClick={() => setForm((f) => ({ ...f, channel: c }))}
                      className={
                        "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                        (form.channel === c
                          ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                          : "border-border text-muted-foreground hover:text-foreground")
                      }
                    >
                      {c === "email" ? "Email" : "LinkedIn"}
                    </button>
                  ))}
                </div>
              </div>
              {form.channel === "email" && (
                <div className="grid gap-1.5">
                  <Label htmlFor="camp-subject">Subject</Label>
                  <Input
                    id="camp-subject"
                    value={form.subject}
                    onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                    placeholder="Quick idea for {{company}}"
                  />
                </div>
              )}
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="camp-body">Message</Label>
              <Textarea
                id="camp-body"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                rows={8}
                className="font-mono text-[13px]"
                placeholder={"Hi {{first_name}},\n\nI noticed {{company}} is growing in {{industry}}…"}
              />
            </div>
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-3 py-2">
                <p className="label-caps text-muted-foreground">
                  Recipients ({selectedLeads.size} selected)
                </p>
                <div className="flex gap-1">
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setSelectedLeads(new Set(emailLeads.map((l) => l._id)))}
                  >
                    All with email
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="h-6 px-2 text-[11px]"
                    onClick={() => setSelectedLeads(new Set())}
                  >
                    Clear
                  </Button>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {leads.length === 0 ? (
                  <p className="px-3 py-6 text-center text-xs text-muted-foreground">
                    Add leads first — they'll show up here.
                  </p>
                ) : (
                  leads.map((lead: Lead) => (
                    <label
                      key={lead._id}
                      className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 transition-colors hover:bg-secondary"
                    >
                      <Checkbox
                        checked={selectedLeads.has(lead._id)}
                        onCheckedChange={() => toggleLead(lead._id)}
                        aria-label={`Include ${lead.name}`}
                      />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{lead.name}</span>
                        <span className="block truncate text-xs text-muted-foreground">
                          {lead.email ?? "no email — copy channel only"}
                        </span>
                      </span>
                      {!lead.email && (
                        <Badge variant="outline" className="font-normal text-muted-foreground">
                          manual
                        </Badge>
                      )}
                    </label>
                  ))
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreatorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleCreate()} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              Create campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Recipients dialog */}
      <Dialog open={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>{detail?.campaign.name ?? "Campaign"} — recipients</DialogTitle>
            <DialogDescription>
              {detail?.rows.length ?? 0} recipient{(detail?.rows.length ?? 0) === 1 ? "" : "s"} ·{" "}
              {detail?.rows.filter((r) => r.status === "sent").length ?? 0} sent ·{" "}
              {detail?.rows.filter((r) => r.status === "pending").length ?? 0} pending
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5">
            {(detail?.rows ?? []).map((row) => (
              <div
                key={row._id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <span
                  className={
                    "size-2 shrink-0 rounded-full " +
                    (row.status === "sent"
                      ? "bg-[#171613]"
                      : row.status === "failed"
                        ? "bg-destructive"
                        : "bg-border")
                  }
                />
                <span className="min-w-0 flex-1 truncate text-sm">{row.lead?.name ?? "Lead"}</span>
                <span className="text-xs text-muted-foreground">
                  {row.status === "sent" && row.sentAt
                    ? `sent ${timeAgo(row.sentAt)}`
                    : row.status === "failed"
                      ? (row.error ?? "failed")
                      : "pending"}
                </span>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground"
                  aria-label="Remove recipient"
                  onClick={async () => {
                    await removeLead({ id: row._id });
                    toast("Removed from campaign");
                  }}
                >
                  <Trash2 className="size-3" />
                </Button>
              </div>
            ))}
            {(detail?.rows.length ?? 0) === 0 && (
              <p className="py-6 text-center text-sm text-muted-foreground">No recipients yet.</p>
            )}
          </div>
          {detail && detail.rows.some((r) => r.status === "pending") && (
            <DialogFooter className="gap-2 sm:gap-0">
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => void handleMarkManual(detail.campaign)}
              >
                <Mail className="size-4" /> Mark pending as sent manually
              </Button>
              <Button
                className="flex-1"
                disabled={sending}
                onClick={() => setConfirmSend(detail.campaign)}
              >
                {sending ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
                Send via email
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              Removes the campaign and its recipient tracking. Sent messages stay in each lead's
              thread.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                await remove({ id: confirmDelete._id });
                toast("Campaign deleted");
                setConfirmDelete(null);
              }}
            >
              Delete campaign
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Send confirm — no email leaves without an explicit confirmation */}
      <SendConfirmDialog
        campaign={confirmSend}
        sending={sending}
        onClose={() => setConfirmSend(null)}
        onConfirm={handleSend}
      />
    </AppShell>
  );
}

/**
 * Confirmation dialog before any campaign send (production hardening §4).
 * Shows live recipient counts, the resolved limits, and a strong warning for
 * large sends. The send only starts after an explicit confirm click.
 */
function SendConfirmDialog({
  campaign,
  sending,
  onClose,
  onConfirm,
}: {
  campaign: Campaign | null;
  sending: boolean;
  onClose: () => void;
  onConfirm: (campaign: Campaign) => Promise<void> | void;
}) {
  const preview = useQuery(
    api.campaigns.sendPreview,
    campaign ? { id: campaign._id } : "skip",
  );

  const pending = preview?.pending ?? 0;
  const confirmThreshold =
    preview?.limits.confirmThreshold ?? DEFAULT_SEND_LIMITS.confirmThreshold;
  const maxBatch = preview?.limits.maxBatch ?? DEFAULT_SEND_LIMITS.maxBatch;
  const maxPerDay = preview?.limits.maxPerDay ?? DEFAULT_SEND_LIMITS.maxPerDay;
  const sentToday = preview?.sentToday ?? 0;
  const remainingToday = Math.max(0, maxPerDay - sentToday);
  const willSend = Math.min(pending, maxBatch, remainingToday);
  const large = pending > confirmThreshold;
  const estSeconds = Math.round((preview?.limits.throttleMs ?? 0) * willSend / 1000);

  return (
    <Dialog
      open={campaign !== null}
      onOpenChange={(open) => {
        if (!open && !sending) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            Send to {pending} recipient{pending === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogDescription>
            Real emails go out from your connected mailbox as throttled batches.
            Recipients receive the campaign message immediately — double-check the
            message and the list before confirming.
          </DialogDescription>
        </DialogHeader>

        {preview === undefined ? (
          <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Checking recipients…
          </div>
        ) : (
          <div className="space-y-2 rounded-lg border border-border bg-muted/40 p-3 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Pending recipients</span>
              <span className="tabular font-medium">{pending}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">This run will send</span>
              <span className="tabular font-medium">{willSend}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Batch limit</span>
              <span className="tabular">{maxBatch} per send</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Daily limit</span>
              <span className="tabular">
                {maxPerDay}/day · {sentToday} used today
              </span>
            </div>
            {pending > willSend && willSend > 0 && (
              <p className="text-xs text-muted-foreground">
                {pending - willSend} stay pending — press send again after this run.
              </p>
            )}
            {large && willSend > 0 && (
              <p className="flex items-start gap-1.5 rounded-md border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] p-2 text-xs leading-relaxed text-[#82552e]">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
                Large send: {willSend} emails, roughly {estSeconds}s to complete
                {estSeconds > 0 ? "" : "."} Make sure the message is final — it goes to everyone at
                once.
              </p>
            )}
            {willSend === 0 && (
              <p className="text-xs font-medium text-[#82552e]">
                {pending === 0
                  ? "Nothing pending — every recipient is already handled."
                  : "Today's daily sending limit is reached — sending resumes tomorrow."}
              </p>
            )}
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={sending}>
            Cancel
          </Button>
          <Button
            onClick={() => campaign && void onConfirm(campaign)}
            disabled={sending || preview === undefined || willSend === 0}
          >
            {sending ? (
              <>
                <Loader2 className="size-4 animate-spin" /> Sending…
              </>
            ) : (
              `Send ${willSend} email${willSend === 1 ? "" : "s"}`
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
