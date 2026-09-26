import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowRight,
  CornerDownLeft,
  Inbox as InboxIcon,
  Info,
  Mail,
  Send,
  Sparkles,
} from "lucide-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Message = Doc<"messages">;
type Lead = Doc<"leads">;

export default function InboxPage() {
  const messages = useQuery(api.messages.listForUser, {});
  const leads = useQuery(api.leads.list, {});
  const markRead = useMutation(api.messages.markRead);
  const logInbound = useMutation(api.messages.logInbound);
  const [replyFor, setReplyFor] = useState<Message | null>(null);
  const [replyBody, setReplyBody] = useState("");
  const [filter, setFilter] = useState<"all" | "sent" | "received">("all");

  if (messages === undefined || leads === undefined) {
    return (
      <AppShell title="Inbox">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-muted/60" />
          ))}
        </div>
      </AppShell>
    );
  }

  const leadById = new Map<string, Lead>(leads.map((l) => [l._id, l]));
  const unread = messages.filter((m) => m.direction === "received" && !m.readAt).length;

  const visible = messages.filter((m) =>
    filter === "all" ? true : filter === "sent" ? m.direction === "sent" : m.direction === "received",
  );

  const openReply = (m: Message) => {
    setReplyFor(m);
    setReplyBody("");
    if (!m.readAt) void markRead({ id: m._id });
  };

  const submitReply = async () => {
    if (!replyFor || !replyBody.trim()) return;
    try {
      await logInbound({
        leadId: replyFor.leadId,
        channel: replyFor.channel,
        subject: `Re: ${replyFor.subject ?? "your message"}`,
        body: replyBody.trim(),
      });
      toast("Reply logged");
      setReplyFor(null);
      setReplyBody("");
    } catch {
      toast.error("Couldn't log that reply — try again.");
    }
  };

  return (
    <AppShell
      title="Inbox"
      actions={
        <span className="rounded-full bg-secondary px-2.5 py-1 text-xs text-secondary-foreground">
          {unread} unread
        </span>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Every message you've sent or received — outreach history across all leads.
      </p>

      {/* Manual-logging notice (production hardening §7): no Gmail/Outlook sync. */}
      <div
        role="note"
        className="mb-4 flex items-start gap-2 rounded-md border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-3 py-2.5 text-xs leading-relaxed text-[#82552e]"
      >
        <Info className="mt-0.5 size-3.5 shrink-0" />
        <p>
          Incoming replies are currently logged manually. Gmail/Outlook inbox synchronization is
          not connected.
        </p>
      </div>

      <div className="mb-4 flex items-center rounded-md border border-border bg-card p-0.5" style={{ width: "fit-content" }}>
        {(["all", "sent", "received"] as const).map((key) => (
          <button
            key={key}
            type="button"
            aria-pressed={filter === key}
            onClick={() => setFilter(key)}
            className={cn(
              "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium capitalize transition-colors",
              filter === key
                ? "bg-[#171613] text-[#f5f0e6]"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {key}
          </button>
        ))}
      </div>

      {visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <InboxIcon className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">
            {filter === "received"
              ? "No replies logged yet."
              : filter === "sent"
                ? "No outreach sent yet."
                : "No messages yet."}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Compose outreach from the Leads table or any lead page — everything lands here.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {visible.map((m) => {
            const lead = leadById.get(m.leadId);
            const unreadMsg = m.direction === "received" && !m.readAt;
            return (
              <div
                key={m._id}
                className={cn(
                  "rounded-lg border bg-card px-4 py-3 transition-colors hover:border-[#b3a894]",
                  unreadMsg ? "border-[#171613]/40 bg-[#f5f0e6]" : "border-border",
                )}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full",
                      m.direction === "sent"
                        ? "border border-border bg-secondary text-muted-foreground"
                        : "border border-[#171613]/30 bg-[#171613] text-[#f5f0e6]",
                    )}
                  >
                    {m.direction === "sent" ? <Send className="size-3" /> : <CornerDownLeft className="size-3" />}
                  </span>
                  <Link
                    to={`/leads/${m.leadId}`}
                    className="truncate text-sm font-medium underline-offset-2 hover:underline"
                  >
                    {lead?.name ?? "Unknown lead"}
                  </Link>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[10px] font-medium",
                      m.channel === "email"
                        ? "bg-secondary text-secondary-foreground"
                        : "bg-muted text-muted-foreground",
                    )}
                  >
                    {m.channel}
                  </span>
                  {m.campaignId && (
                    <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      campaign
                    </span>
                  )}
                  {m.provider && m.provider !== "manual" && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Sparkles className="size-3" /> auto-sent
                    </span>
                  )}
                  <span className="ml-auto text-xs text-muted-foreground">
                    {timeAgo(m.sentAt ?? m.createdAt)}
                  </span>
                </div>
                {m.subject && (
                  <p className="mt-1.5 truncate text-sm font-medium">
                    {m.direction === "received" ? "Re: " : ""}
                    {m.subject}
                  </p>
                )}
                <p className="mt-1 line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">
                  {m.body}
                </p>
                {m.status === "failed" && m.error && (
                  <p className="mt-1.5 flex items-center gap-1.5 text-xs text-destructive">
                    <Mail className="size-3" /> Failed: {m.error}
                  </p>
                )}
                <div className="mt-2 flex flex-wrap gap-1.5">
                  <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                    <Link to={`/leads/${m.leadId}`}>
                      Open thread <ArrowRight className="size-3" />
                    </Link>
                  </Button>
                  {m.direction === "received" && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 gap-1 text-xs"
                      onClick={() => openReply(m)}
                    >
                      <CornerDownLeft className="size-3" /> Log reply
                    </Button>
                  )}
                  {unreadMsg && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void markRead({ id: m._id })}
                    >
                      Mark read
                    </Button>
                  )}
                  <span className="ml-auto self-center text-[10px] text-muted-foreground">
                    {formatDateTime(m.createdAt)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Log reply dialog */}
      <Dialog open={replyFor !== null} onOpenChange={(open) => !open && setReplyFor(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Log the reply</DialogTitle>
            <DialogDescription>
              Paste or summarize what {leadById.get(replyFor?.leadId ?? "")?.name ?? "the lead"} said.
              It becomes part of the thread and moves the lead into Discovery if they haven't
              progressed further. Log replies yourself — inbox sync is not connected.
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={replyBody}
            onChange={(e) => setReplyBody(e.target.value)}
            placeholder="“This looks interesting — can you send pricing?”"
            rows={4}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setReplyFor(null)}>
              Cancel
            </Button>
            <Button onClick={() => void submitReply()} disabled={!replyBody.trim()}>
              Log reply
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
