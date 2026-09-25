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

  if (campaigns === undefined || leads === undefined) {
    return (
      <AppShell title="Campaigns">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-lg bg-muted/60" />
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

  const handleSend = async (campaignId: string) => {
    setSending(true);
    try {
      const result = await sendAll({ id: campaignId as never });
      if (result.sent > 0) {
        toast(`Sent ${result.sent} email${result.sent === 1 ? "" : "s"}`, {
          description: result.failed > 0 ? `${result.failed} failed — see statuses below.` : undefined,
        });
      } else {
        toast(result.reason ?? "Nothing to send");
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
        <div className="flex flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full bg-foreground text-background">
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
            <div key={campaign._id} className="flex flex-col rounded-lg border border-border bg-card p-4">
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
                      ? "bg-[#D4FF4F] text-[#191918]"
                      : campaign.status === "completed"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground")
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
                  onClick={() => void handleSend(campaign._id)}
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
                        "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                        (form.channel === c
                          ? "border-foreground bg-foreground text-background"
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
                      className="flex cursor-pointer items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0 hover:bg-muted/40"
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
                      ? "bg-[#A9E813]"
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
                onClick={() => void handleSend(detail.campaign._id)}
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
    </AppShell>
  );
}
