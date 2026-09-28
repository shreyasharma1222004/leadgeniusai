import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import { askAssistant, type CopilotContext } from "@/lib/assistant";
import { computeClients } from "@/lib/clients";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { ArrowRight, Bot, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

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

export default function AssistantPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const profile = useQuery(api.business.myProfile, {});
  const goals = useQuery(api.business.goalsWithProgress, {});
  const proposals = useQuery(api.proposals.list, {});
  const { user } = useAuth();

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

  const [turns, setTurns] = useState<Turn[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);

  const ready =
    leads !== undefined && messages !== undefined && followUps !== undefined && campaigns !== undefined;

  // Business context (Phase 1 §7) — profile + goals feed the Copilot so its
  // answers use what the business sells, who it targets, and real goal math.
  // Phase 2 (§20) adds revenue context: derived clients + persisted proposals.
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

  const ask = (question: string) => {
    if (!question.trim() || !ready) return;
    const answer = askAssistant(question, leads, messages, followUps, campaigns, context);
    setTurns((prev) => [
      ...prev,
      { role: "user", text: question },
      {
        role: "assistant",
        text: answer.text,
        bullets: answer.bullets,
        leadIds: answer.leadIds,
      },
    ]);
    setInput("");
    setThinking(false);
  };

  const nameById = useMemo(
    () => new Map<string, { name: string }>((leads ?? []).map((l) => [l._id, l])),
    [leads],
  );

  return (
    <AppShell title="AI Copilot">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Your business copilot — answers from your real workspace data, never invented numbers.
      </p>

      {!ready ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-16 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-3">
            {turns.length === 0 && (
              <div className="rounded-lg border border-border bg-card p-5">
                <div className="flex items-center gap-2">
                  <span className="flex size-8 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
                    <Bot className="size-4" />
                  </span>
                  <p className="text-sm font-semibold">Your pipeline, on demand.</p>
                </div>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  I read your leads, deals, replies, follow-ups and campaigns — ask me anything about
                  them. Every answer is computed from your own workspace.
                </p>
              </div>
            )}

            {turns.map((turn, i) => (
              <div key={i} className={cn("flex", turn.role === "user" ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[85%] rounded-lg px-4 py-3 text-sm leading-relaxed sm:max-w-[75%]",
                    turn.role === "user"
                      ? "border border-[#171613]/30 bg-[#e4ddcf]"
                      : "ai-gradient-border rounded-lg",
                  )}
                >
                  {turn.role === "assistant" && (
                    <p className="label-caps mb-1.5 flex items-center gap-1.5 text-muted-foreground">
                      <Sparkles className="size-3" /> Dealflow AI
                    </p>
                  )}
                  <p className="whitespace-pre-wrap">{turn.text}</p>
                  {turn.bullets && turn.bullets.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {turn.bullets.map((b, bi) => (
                        <li key={bi} className="flex gap-2 text-[13px]">
                          <span className="mt-1.5 size-1 shrink-0 rounded-full bg-[#9a9285]" />
                          {b}
                        </li>
                      ))}
                    </ul>
                  )}
                  {turn.leadIds && turn.leadIds.length > 0 && (
                    <div className="mt-2.5 flex flex-wrap gap-1.5">
                      {turn.leadIds.map((id) => {
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
            ))}

            {thinking && (
              <div className="flex justify-start">
                <div className="rounded-lg border border-border bg-card px-4 py-3 text-sm text-muted-foreground">
                  <span className="animate-pulse">Reading your workspace…</span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions */}
          {turns.length === 0 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => ask(s)}
                  className="cursor-pointer rounded-full border border-border bg-card px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground"
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
              setThinking(true);
              // small delay so the "thinking" state renders before the answer
              setTimeout(() => ask(input), 250);
            }}
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about deals, revenue, clients, proposals…"
              aria-label="Ask the assistant"
            />
            <Button type="submit" size="icon" disabled={!input.trim() || !ready} aria-label="Send question">
              <ArrowRight className="size-4" />
            </Button>
          </form>
        </>
      )}
    </AppShell>
  );
}
