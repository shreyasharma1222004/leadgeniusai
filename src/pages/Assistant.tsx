import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import {
  askAssistant,
  type AssistantHistoryTurn,
  type CopilotContext,
} from "@/lib/assistant";
import { computeClients } from "@/lib/clients";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import { ArrowRight, Bot, MessageSquarePlus, Sparkles, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

interface Turn {
  role: "user" | "assistant";
  text: string;
  bullets?: string[];
  leadIds?: string[];
}

const SUGGESTIONS = [
  "What should I work on today?",
  "What is my weighted pipeline?",
  "Any stalled deals?",
  "Which clients need attention?",
  "What proposals are waiting for action?",
  "Which client generated the most revenue?",
  "Am I on track for my goals?",
  "What is blocking my growth?",
];

const DEFAULT_TITLE = "New conversation";

/** Deterministic, bounded local title from the first user message (§3). */
function deriveTitle(firstMessage: string): string {
  const words = firstMessage.trim().replace(/\s+/g, " ").split(" ").filter(Boolean);
  const stop = new Set([
    "what", "which", "who", "whats", "what's", "is", "are", "the", "a", "an",
    "my", "i", "do", "does", "should", "can", "how", "to", "of", "for", "on",
    "in", "me", "any", "there",
  ]);
  const keys = words
    .filter((w) => !stop.has(w.toLowerCase()))
    .slice(0, 3)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  const title = keys.join(" ").slice(0, 60);
  return title || DEFAULT_TITLE;
}

export default function AssistantPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const profile = useQuery(api.business.myProfile, {});
  const goals = useQuery(api.business.goalsWithProgress, {});
  const proposals = useQuery(api.proposals.list, {});
  const conversations = useQuery(api.assistant.listConversations, {});
  const { user } = useAuth();

  const createConversation = useMutation(api.assistant.createConversation);
  const addMessageMutation = useMutation(api.assistant.addMessage);
  const renameConversationMutation = useMutation(api.assistant.renameConversation);
  const deleteConversationMutation = useMutation(api.assistant.deleteConversation);
  // Server-side AI reply path (Step 2b-1). Explicit submission only — never
  // called on load, switching, or typing. Null return ⇒ deterministic fallback.
  const copilotReplyAction = useAction(api.ai.copilotReply);

  const [activeId, setActiveId] = useState<Id<"conversations"> | null>(null);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(null);

  // Auto-select the most recent conversation once the list loads (§4).
  useEffect(() => {
    if (conversations === undefined) return;
    if (activeId !== null && conversations.some((c) => c._id === activeId)) return;
    setActiveId(conversations[0]?._id ?? null);
  }, [conversations, activeId]);

  // One subscription per active conversation — reused for rendering AND the
  // follow-up history window; no duplicate message subscriptions.
  const activeMessages = useQuery(
    api.assistant.listMessages,
    activeId ? { conversationId: activeId } : "skip",
  );

  const ready =
    leads !== undefined &&
    messages !== undefined &&
    followUps !== undefined &&
    campaigns !== undefined &&
    conversations !== undefined;

  const growthGoalLabel =
    user?.growthGoal === "find-customers"
      ? "find more customers"
      : user?.growthGoal === "increase-sales"
        ? "increase sales"
        : user?.growthGoal === "improve-conversion"
          ? "improve conversion"
          : user?.growthGoal === "manage-clients"
            ? "manage clients better"
            : user?.growthGoal === "build-brand"
              ? "build the brand"
              : user?.growthGoal === "improve-operations"
                ? "improve operations"
                : undefined;

  // Business context (Phase 1 §7 + Phase 2 §20) — unchanged from the audited
  // implementation; the deterministic engine consumes it exactly as before.
  const context: CopilotContext | undefined =
    profile !== undefined && proposals !== undefined
      ? {
          businessName: profile?.businessName,
          industry: profile?.industry,
          businessModel: profile?.businessModel,
          products: profile?.products,
          targetGeography: profile?.targetGeography,
          primaryChallenge: profile?.primaryChallenge,
          growthGoal: growthGoalLabel,
          workspaceCurrency: profile?.currency ?? undefined,
          goals: (goals ?? []).map((g) => ({
            name: g.name,
            period: g.period,
            current: g.current,
            targetValue: g.targetValue,
            unit: g.unit,
            formatted: g.formatted,
            progress: g.progress,
            unavailableReason: g.unavailableReason,
          })),
          clients:
            leads !== undefined
              ? computeClients(leads, profile?.products, {
                  followUps: followUps,
                  messages: messages,
                })
              : [],
          proposals: (proposals ?? []).map((p) => ({
            _id: p._id,
            title: p.title,
            status: p.status,
            value: p.value,
            dealId: p.dealId,
            sentAt: p.sentAt,
          })),
        }
      : undefined;

  // Bounded recent history for follow-up resolution (§5) — the same persisted
  // messages the view renders, no extra subscription, capped by the engine.
  const history: AssistantHistoryTurn[] = useMemo(
    () =>
      (activeMessages ?? []).slice(-8).map((m) => ({
        role: m.role,
        text: m.content,
      })),
    [activeMessages],
  );

  const handleNewConversation = async () => {
    try {
      const id = await createConversation({});
      setActiveId(id);
      setSendError(null);
    } catch {
      toast.error("Couldn't create the conversation — try again.");
    }
  };

  const handleDeleteConversation = async (id: Id<"conversations">) => {
    try {
      await deleteConversationMutation({ id });
      toast("Conversation deleted.");
      if (activeId === id) setActiveId(null);
    } catch {
      toast.error("Couldn't delete the conversation — try again.");
    }
  };

  const ask = async (question: string) => {
    const trimmed = question.trim();
    if (!trimmed || !ready || thinking) return;
    setThinking(true);
    setSendError(null);
    setFallbackNotice(null);

    // 1+2. Ensure a conversation exists and persist the user message FIRST.
    // A failure here must not fake an assistant answer.
    let convId: Id<"conversations">;
    try {
      if (activeId) {
        convId = activeId;
      } else {
        convId = await createConversation({});
        setActiveId(convId);
      }
      await addMessageMutation({ conversationId: convId, role: "user", content: trimmed });
    } catch {
      setSendError(
        "Your message couldn't be saved — it was NOT added to this conversation. Try sending again.",
      );
      setThinking(false);
      return;
    }

    try {
      // First message also titles the conversation (deterministic, local).
      const conv = (conversations ?? []).find((c) => c._id === convId);
      if (conv && conv.title === DEFAULT_TITLE) {
        await renameConversationMutation({ id: convId, title: deriveTitle(trimmed) });
      }

      // 3. Real AI path — server-side, ownership-checked, one request per
      //    submission. Null or a thrown error ⇒ deterministic fallback below.
      let aiReplied: string | null = null;
      try {
        aiReplied = await copilotReplyAction({ conversationId: convId, message: trimmed });
      } catch {
        aiReplied = null;
      }

      if (aiReplied === null) {
        // 4. Fallback: the existing deterministic engine (unchanged). It gets
        //    the bounded recent history for follow-up resolution.
        const priorTurns: AssistantHistoryTurn[] = [
          ...history,
          { role: "user" as const, text: trimmed },
        ];
        const answer = askAssistant(
          trimmed,
          leads,
          messages,
          followUps,
          campaigns,
          context,
          priorTurns,
        );
        // 5. Persist the fallback answer through the same public mutation —
        //    the reactive subscription renders it; no optimistic duplicates.
        await addMessageMutation({
          conversationId: convId,
          role: "assistant",
          content: [answer.text, ...answer.bullets.map((b) => `• ${b}`)].join("\n"),
        });
        setFallbackNotice(
          "AI is unavailable right now — this answer came from the offline rule engine, computed from your real workspace data.",
        );
      } else if (aiReplied === "partial") {
        // Streamed reply was interrupted mid-answer: what arrived was saved
        // as-is (never fabricated into a fake completion).
        setFallbackNotice(
          "The AI reply was interrupted before finishing — the partial response above was saved as-is. Ask again to continue.",
        );
      }
      setInput("");
    } catch {
      setSendError(
        "Your message was saved, but the reply couldn't be generated — try again in a moment.",
      );
    } finally {
      setThinking(false);
    }
  };

  const nameById = useMemo(
    () => new Map<string, { name: string }>((leads ?? []).map((l) => [l._id, l])),
    [leads],
  );

  return (
    <AppShell title="AI Copilot">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Your business copilot — answers from your real workspace data, never invented numbers.
        Conversations are saved to your workspace. AI replies are generated
        server-side; if AI is unavailable, the offline rule engine answers from
        your real data instead.
      </p>

      {!ready ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[240px_1fr]">
          {/* ── Conversation list — lightweight, no animation (§4) ────────── */}
          <aside className="h-fit rounded-xl border border-border bg-card p-2">
            <Button
              variant="outline"
              size="sm"
              className="mb-2 w-full justify-start"
              onClick={() => void handleNewConversation()}
            >
              <MessageSquarePlus className="size-4" /> New conversation
            </Button>
            {conversations.length === 0 ? (
              <p className="px-2 py-3 text-xs text-muted-foreground">
                No conversations yet — start one below.
              </p>
            ) : (
              <ul className="space-y-0.5">
                {conversations.map((c) => (
                  <li key={c._id} className="group flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => {
                        setActiveId(c._id);
                        setSendError(null);
                      }}
                      className={cn(
                        "min-w-0 flex-1 truncate rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                        activeId === c._id
                          ? "bg-[#e4ddcf] font-medium text-foreground"
                          : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                      )}
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete ${c.title}`}
                      onClick={() => void handleDeleteConversation(c._id)}
                      className="rounded p-1 text-muted-foreground/50 opacity-0 transition-opacity hover:bg-secondary hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>

          {/* ── Active conversation ────────────────────────────────────────── */}
          <div>
            {activeMessages === undefined && activeId !== null ? (
              <div className="space-y-3">
                <div className="h-16 animate-pulse rounded-lg bg-card" />
                <div className="h-16 w-5/6 animate-pulse rounded-lg bg-card" />
              </div>
            ) : (
              <>
                <div className="flex flex-col gap-3">
                  {(activeMessages ?? []).length === 0 && (
                    <div className="rounded-lg border border-border bg-card p-5">
                      <div className="flex items-center gap-2">
                        <span className="flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
                          <Bot className="size-4" />
                        </span>
                        <p className="text-sm font-semibold">Your pipeline, on demand.</p>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                        I read your leads, deals, replies, follow-ups and campaigns — ask me
                        anything about them. Every answer is computed from your own workspace.
                      </p>
                    </div>
                  )}

                  {(activeMessages ?? []).map((m) => {
                    const lines = m.content.split("\n");
                    const text = lines[0] ?? m.content;
                    const bullets = lines
                      .slice(1)
                      .map((l) => l.replace(/^•\s*/, ""))
                      .filter(Boolean);
                    // Lead chips resolve from the message text against real
                    // records — same behavior as the previous in-memory chips.
                    const leadIds = (leads ?? [])
                      .filter((l) => m.role === "assistant" && m.content.includes(l.name))
                      .slice(0, 5)
                      .map((l) => l._id as string);
                    return (
                      <div
                        key={m._id}
                        className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}
                      >
                        <div
                          className={cn(
                            "max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed sm:max-w-[75%]",
                            m.role === "user"
                              ? "border border-[#171613]/30 bg-[#e4ddcf]"
                              : "ai-gradient-border rounded-lg",
                          )}
                        >
                          {m.role === "assistant" && (
                            <p className="label-caps mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                              <Sparkles className="size-3" /> Dealflow AI
                            </p>
                          )}
                          <p className="whitespace-pre-wrap">{text}</p>
                          {bullets.length > 0 && (
                            <ul className="mt-2 space-y-1">
                              {bullets.map((b, bi) => (
                                <li key={bi} className="flex gap-2 text-[13px]">
                                  <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#9a9285]" />
                                  {b}
                                </li>
                              ))}
                            </ul>
                          )}
                          {leadIds.length > 0 && (
                            <div className="mt-2.5 flex flex-wrap gap-1.5">
                              {leadIds.map((id) => {
                                const lead = nameById.get(id);
                                if (!lead) return null;
                                return (
                                  <Link
                                    key={id}
                                    to={`/leads/${id}`}
                                    className="rounded-full border border-border bg-card px-2.5 py-0.5 text-xs text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground"
                                  >
                                    {lead.name} →
                                  </Link>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}

                  {thinking && (
                    <div className="flex justify-start">
                      <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                        <span className="animate-pulse">Reading your workspace…</span>
                      </div>
                    </div>
                  )}
                </div>

                {sendError && (
                  <p className="mt-3 rounded-md border border-[#a8442f]/40 bg-[#a8442f]/[0.08] px-3 py-2 text-xs leading-relaxed text-[#a8442f]">
                    {sendError}
                  </p>
                )}
                {fallbackNotice && !sendError && (
                  <p className="mt-3 rounded-md border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-3 py-2 text-xs leading-relaxed text-[#82552e]">
                    {fallbackNotice}
                  </p>
                )}

                {/* Suggestions — only on an empty conversation */}
                {(activeMessages ?? []).length === 0 && (
                  <div className="mt-4 flex flex-wrap gap-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        disabled={thinking}
                        onClick={() => void ask(s)}
                        className={cn(
                          "cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground",
                          thinking && "cursor-not-allowed opacity-50 hover:border-border",
                        )}
                      >
                        {s}
                      </button>
                    ))}
                  </div>
                )}

                {/* Input */}
                <form
                  className="sticky bottom-4 mt-4 flex gap-2"
                  onSubmit={(e) => {
                    e.preventDefault();
                    void ask(input);
                  }}
                >
                  <Input
                    value={input}
                    onChange={(e) => setInput(e.target.value)}
                    placeholder="Ask about deals, revenue, clients, proposals…"
                    aria-label="Ask the assistant"
                  />
                  <Button type="submit" size="icon" disabled={!input.trim() || thinking} aria-label="Send question">
                    <ArrowRight className="size-4" />
                  </Button>
                </form>
              </>
            )}
          </div>
        </div>
      )}
    </AppShell>
  );
}
