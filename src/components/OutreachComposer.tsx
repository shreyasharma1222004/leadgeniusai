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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { useAction, useMutation } from "convex/react";
import { AlertTriangle, Copy, Loader2, Mail, Send, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  CHANNEL_LABELS,
  OUTREACH_CHANNELS,
  draftOutreach,
  renderTemplate,
  templateTokens,
  type OutreachChannel,
} from "@/lib/outreach";

type Lead = Doc<"leads">;

export interface OutreachTarget {
  lead: Lead;
}

/**
 * Shared outreach composer: generates a personalized draft from the lead's
 * AI intelligence, lets the user edit it, then sends via email (Resend) or
 * copies it for manual sending. Every send is logged into the thread/inbox.
 */
export function OutreachComposer({
  leads,
  open,
  onOpenChange,
  defaultChannel = "email",
  onSent,
}: {
  leads: Lead[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultChannel?: OutreachChannel;
  onSent?: () => void;
}) {
  const [channel, setChannel] = useState<OutreachChannel>(defaultChannel);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [mode, setMode] = useState<"draft" | "sending" | "done">("draft");
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<{ sent: number; copied: number; failed: number } | null>(
    null,
  );

  const sendEmail = useMutation(api.messages.logOutbound);
  const markContacted = useMutation(api.leads.markContacted);
  const sendEmailAction = useAction(api.messages.sendEmail);

  const first = leads[0];

  // Generate a fresh draft whenever the dialog opens for a new lead set.
  useEffect(() => {
    if (!open || leads.length === 0) return;
    const draft = draftOutreach(leads[0], channel);
    setSubject(draft.subject);
    setBody(draft.body);
    setMode("draft");
    setError(null);
    setResults(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, leads[0]?._id, channel]);

  const preview = useMemo(() => {
    if (!first) return { subject: "", body: "" };
    const tokens = templateTokens(first);
    return {
      subject: renderTemplate(subject, tokens),
      body: renderTemplate(body, tokens),
    };
  }, [first, subject, body]);

  if (leads.length === 0) return null;

  const multi = leads.length > 1;

  const handleSend = async () => {
    setMode("sending");
    setError(null);
    let sent = 0;
    let failed = 0;
    const failures: string[] = [];

    for (const lead of leads) {
      const tokens = templateTokens(lead);
      const leadSubject = renderTemplate(subject, tokens) || `(no subject)`;
      const leadBody = renderTemplate(body, tokens);
      try {
        if (channel === "email" && lead.email) {
          await sendEmailAction({ leadId: lead._id, subject: leadSubject, body: leadBody });
          await sendEmail({
            leadId: lead._id,
            channel: "email",
            subject: leadSubject,
            body: leadBody,
            status: "sent",
            provider: "resend",
          });
          await markContacted({ id: lead._id });
          sent++;
        } else {
          // Manual channel (LinkedIn, or email without an address): log as
          // sent-by-you so tracking and threads still work.
          await sendEmail({
            leadId: lead._id,
            channel,
            subject: channel === "email" ? leadSubject : undefined,
            body: leadBody,
            status: "sent",
            provider: "manual",
          });
          await markContacted({ id: lead._id });
          sent++;
        }
      } catch (err) {
        failed++;
        failures.push(err instanceof Error ? err.message : "Unknown error");
        try {
          await sendEmail({
            leadId: lead._id,
            channel,
            subject: channel === "email" ? leadSubject : undefined,
            body: leadBody,
            status: "failed",
            error: err instanceof Error ? err.message.slice(0, 200) : undefined,
          });
        } catch {
          // ignore logging failure
        }
      }
    }

    setResults({ sent, copied: 0, failed });
    setMode("done");
    if (sent > 0) {
      toast(
        channel === "email"
          ? `Sent ${sent} email${sent === 1 ? "" : "s"}`
          : `Logged ${sent} message${sent === 1 ? "" : "s"} — send manually from the lead page`,
      );
      onSent?.();
    }
    if (failed > 0) {
      setError(failures[0] ?? "Some sends failed.");
    }
  };

  const handleCopy = async () => {
    const text =
      channel === "email" && preview.subject
        ? `Subject: ${preview.subject}\n\n${preview.body}`
        : preview.body;
    try {
      await navigator.clipboard.writeText(text);
      toast("Copied — paste it into Gmail or LinkedIn");
    } catch {
      toast.error("Couldn't copy — select the text manually.");
    }
  };

  const hasLiveEmail = channel === "email" && Boolean(first?.email);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            {multi ? `Outreach to ${leads.length} leads` : `Outreach to ${first.name}`}
          </DialogTitle>
          <DialogDescription>
            {multi
              ? "The draft personalizes {{tokens}} per lead. Review before sending."
              : "Drafted from this lead's intelligence. Edit freely — tokens fill from lead data."}
          </DialogDescription>
        </DialogHeader>

        {mode === "done" && results ? (
          <div className="rounded-md border border-border bg-muted/40 px-4 py-3 text-sm">
            <p className="font-medium">
              {results.sent > 0 && `${results.sent} sent. `}
              {results.failed > 0 && `${results.failed} failed.`}
            </p>
            {error && (
              <p className="mt-1 flex items-start gap-1.5 text-xs text-destructive">
                <AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {error}
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Everything is logged in the lead thread and Inbox — replies can be recorded there too.
            </p>
          </div>
        ) : (
          <>
            {/* Channel switch */}
            <div className="flex items-center gap-2">
              {OUTREACH_CHANNELS.map((c) => (
                <button
                  key={c}
                  type="button"
                  aria-pressed={channel === c}
                  onClick={() => setChannel(c)}
                  className={
                    "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                    (channel === c
                      ? "border-foreground bg-foreground text-background"
                      : "border-border text-muted-foreground hover:text-foreground")
                  }
                >
                  {CHANNEL_LABELS[c]}
                </button>
              ))}
              {channel === "email" && !first?.email && (
                <span className="text-xs text-muted-foreground">
                  No email on this lead — you'll copy it instead.
                </span>
              )}
            </div>

            {channel === "email" && (
              <div className="grid gap-1.5">
                <Label htmlFor="outreach-subject">Subject</Label>
                <Input
                  id="outreach-subject"
                  value={subject}
                  onChange={(e) => setSubject(e.target.value)}
                  placeholder="Quick idea for {{company}}"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="outreach-body">Message</Label>
              <Textarea
                id="outreach-body"
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={10}
                className="font-mono text-[13px]"
              />
            </div>

            {/* Live preview for multi-send */}
            {multi && (
              <p className="text-xs text-muted-foreground">
                Tokens like <code className="rounded bg-muted px-1">{"{{first_name}}"}</code> and{" "}
                <code className="rounded bg-muted px-1">{"{{company}}"}</code> are replaced per lead
                on send.
              </p>
            )}

            {error && mode !== "sending" && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                {error}
              </div>
            )}
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {mode !== "done" ? (
            <div className="flex w-full flex-col gap-2 sm:flex-row">
              <Button type="button" variant="outline" className="flex-1" onClick={handleCopy}>
                <Copy className="size-4" /> Copy message
              </Button>
              <Button
                type="button"
                className="flex-1"
                onClick={handleSend}
                disabled={mode === "sending" || !body.trim()}
              >
                {mode === "sending" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : hasLiveEmail ? (
                  <Send className="size-4" />
                ) : (
                  <Mail className="size-4" />
                )}
                {mode === "sending"
                  ? "Sending…"
                  : hasLiveEmail
                    ? `Send via email${multi ? ` (${leads.length})` : ""}`
                    : "Log as sent"}
              </Button>
            </div>
          ) : (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
