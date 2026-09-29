import { AppShell } from "@/components/AppShell";
import { AddLeadDialog } from "@/components/AddLeadDialog";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { OnboardingDialog } from "@/components/OnboardingDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { money } from "@/lib/growth";
import { timeAgo } from "@/lib/format";
import { GOAL_PERIOD_LABELS, type GoalPeriod } from "@/lib/goalEngine";
import { computeClients } from "@/lib/clients";
import {
  computeClosedStats,
  computePipelineStats,
  dealCurrency,
  dealFlags,
  dealTitle,
  stageLastAtMap,
} from "@/lib/revenue";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Building2, Check, FileText, Sparkles, TrendingUp, Trophy, Users, X } from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import {
  computeGrowthBrief,
  computeGrowthMetrics,
  computeOpportunities,
  computeTodayPlan,
} from "@/lib/growth";
import type { BriefLine } from "@/lib/growth";

type FollowUpRow = {
  _id: string;
  leadId: string;
  dueAt: number;
  status: string;
  note?: string;
};

/** A workspace with zero records is a real state, not an error: show the setup path. */
function EmptyWorkspace() {
  return (
    <section className="mt-14 border-t border-border pt-10">
      <p className="label-caps text-muted-foreground">Your growth workspace is ready</p>
      <h2 className="mt-3 text-2xl font-semibold tracking-tight">Start by adding your first leads.</h2>
      <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
        Import a CSV or add one prospect. Every metric, brief and recommendation on this page
        builds itself from your own data — nothing here is pre-filled.
      </p>
      <div className="mt-6 flex flex-wrap items-center gap-2">
        <AddLeadDialog />
        <ImportCsvDialog />
        <Button variant="ghost" asChild>
          <Link to="/assistant">
            Ask the Copilot <ArrowRight className="size-4" />
          </Link>
        </Button>
      </div>
      <dl className="mt-10 grid max-w-2xl gap-x-8 gap-y-4 sm:grid-cols-3">
        {[
          { t: "1. Import leads", d: "CSV or one at a time — research runs automatically." },
          { t: "2. Reach out", d: "AI drafts, you approve. Every send is logged." },
          { t: "3. Track to close", d: "Pipeline, follow-ups and revenue in one loop." },
        ].map((s) => (
          <div key={s.t}>
            <dt className="text-sm font-medium">{s.t}</dt>
            <dd className="mt-1 text-xs leading-relaxed text-muted-foreground">{s.d}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

export default function OverviewPage() {
  const { user } = useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const profile = useQuery(api.business.myProfile, {});
  const goals = useQuery(api.business.goalsWithProgress, {});
  const proposals = useQuery(api.proposals.list, {});
  const history = useQuery(api.leads.stageHistoryForUser, {});
  const setFollowUpStatus = useMutation(api.leads.setFollowUpStatus);
  // AI Business Brief action + state (hooks must live above the loading return)
  const businessBriefAction = useAction(api.ai.businessBrief);
  const [aiBrief, setAiBrief] = useState<Awaited<ReturnType<typeof businessBriefAction>>>(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [briefError, setBriefError] = useState<string | null>(null);
  const [planDismissed, setPlanDismissed] = useState<Set<string>>(new Set());

  // Hooks must run unconditionally on every render — including the loading
  // render below. These three memos used to sit after the early return, so
  // the hook count grew once data arrived ("Rendered more hooks than during
  // the previous render").
  const workspaceCurrency = profile?.currency ?? undefined;

  // ── Phase 2: today's revenue priorities (§22) — evidence-backed, why-labeled ──
  const stageLastAt = useMemo(() => stageLastAtMap(history ?? []), [history]);
  const clients = useMemo(
    () => computeClients(leads ?? [], profile?.products, { followUps, messages }),
    [leads, profile?.products, followUps, messages],
  );
  const revenuePriorities = useMemo(() => {
    const out: { id: string; title: string; why: string; to: string; kind: string }[] = [];
    const now = Date.now();
    const leadRows = leads ?? [];
    // 1. Close-date passed / stalled high-value deals
    const flagged = leadRows
      .filter((l) => l.status !== "won" && l.status !== "lost")
      .map((l) => ({ lead: l, flags: dealFlags(l, { now, lastStageAt: stageLastAt.get(l._id as string), proposalPending: (proposals ?? []).some((p) => p.dealId === l._id && (p.status === "sent" || p.status === "viewed")) }) }))
      .filter((f) => f.flags.length > 0)
      .sort((a, b) => (b.lead.dealValue ?? 0) - (a.lead.dealValue ?? 0));
    for (const f of flagged.slice(0, 2)) {
      out.push({
        id: `deal-${f.lead._id}`,
        title: `Review ${dealTitle(f.lead)}`,
        why: `${f.flags[0].detail}${f.lead.dealValue !== undefined ? ` · ${money(f.lead.dealValue, dealCurrency(f.lead, workspaceCurrency))} open value` : ""}`,
        to: `/leads/${f.lead._id}`,
        kind: "deal",
      });
    }
    // 2. Proposals waiting on a response
    const waiting = (proposals ?? []).filter((p) => p.status === "sent" || p.status === "viewed");
    for (const p of waiting.slice(0, 1)) {
      out.push({
        id: `prop-${p._id}`,
        title: `Follow up: ${p.title}`,
        why: `Proposal sent ${p.sentAt !== undefined ? timeAgo(p.sentAt) : "recently"} and no outcome recorded yet`,
        to: `/proposals/${p._id}`,
        kind: "proposal",
      });
    }
    // 3. Client needing attention
    const attentionClient = clients
      .filter((c) => c.health.state !== "healthy")
      .sort((a, b) => (a.lastActivityAt ?? 0) - (b.lastActivityAt ?? 0))[0];
    if (attentionClient) {
      out.push({
        id: `client-${attentionClient.key}`,
        title: `Reach out to ${attentionClient.name}`,
        why: `Client needing attention — ${attentionClient.health.detail}`,
        to: `/clients/${encodeURIComponent(attentionClient.key)}`,
        kind: "client",
      });
    }
    // 4. Deals closing within 14 days (opportunity push)
    const closingSoon = leadRows
      .filter(
        (l) =>
          l.status !== "won" &&
          l.status !== "lost" &&
          l.expectedCloseAt !== undefined &&
          l.expectedCloseAt >= now &&
          l.expectedCloseAt <= now + 14 * 86_400_000,
      )
      .sort((a, b) => (a.expectedCloseAt ?? 0) - (b.expectedCloseAt ?? 0));
    for (const l of closingSoon.slice(0, 1)) {
      if (out.some((o) => o.id === `deal-${l._id}`)) continue;
      const days = Math.ceil(((l.expectedCloseAt ?? now) - now) / 86_400_000);
      out.push({
        id: `closing-${l._id}`,
        title: `Push ${dealTitle(l)} to close`,
        why: `Expected close in ${days} day${days === 1 ? "" : "s"}${l.dealValue !== undefined ? ` · ${money(l.dealValue, dealCurrency(l, workspaceCurrency))} open value` : ""}`,
        to: `/leads/${l._id}`,
        kind: "closing",
      });
    }
    return out.slice(0, 4);
  }, [leads, proposals, clients, stageLastAt, workspaceCurrency]);

  const ready =
    leads !== undefined &&
    messages !== undefined &&
    followUps !== undefined &&
    campaigns !== undefined &&
    proposals !== undefined &&
    history !== undefined;

  const first = (user?.name ?? "there").split(" ")[0];

  if (!ready) {
    return (
      <AppShell title="Dashboard">
        <div className="space-y-10">
          <Skeleton className="h-24 w-2/3" />
          <div className="grid gap-8 lg:grid-cols-3">
            <Skeleton className="h-64 lg:col-span-2" />
            <Skeleton className="h-64" />
          </div>
        </div>
      </AppShell>
    );
  }

  const now = Date.now();

  // ── Intelligence layer (pure functions over real records) ─────────────────
  const metrics = computeGrowthMetrics(
    leads,
    messages,
    followUps as FollowUpRow[],
    campaigns,
  );
  const brief = computeGrowthBrief(metrics, leads, workspaceCurrency);
  const opportunities = computeOpportunities(metrics, leads, followUps as FollowUpRow[]);
  const plan = computeTodayPlan(metrics, leads, followUps as FollowUpRow[], workspaceCurrency);

  // ── Phase 2: revenue snapshot (§21) — same revenue source of truth ──
  const closedStats = computeClosedStats(leads);
  const pipelineStats = computePipelineStats(leads);
  const pendingProposals = (proposals ?? []).filter(
    (p) => p.status === "sent" || p.status === "viewed",
  ).length;
  const healthyClients = clients.filter((c) => c.health.state === "healthy").length;

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const leadName = (id: string) => leads.find((l) => l._id === id)?.name ?? "a lead";

  const recent = [...messages].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);

  const toneClass = (tone: BriefLine["tone"]) =>
    tone === "danger"
      ? "text-[#a8442f]"
      : tone === "accent"
        ? "text-[#6f4b5e]"
        : "text-foreground";

  const completeAction = async (id: string) => {
    // Plan items that map to real follow-up records get completed for real.
    const row = (followUps as FollowUpRow[]).find((f) => `fu-${f._id}` === id);
    if (!row) return false;
    try {
      await setFollowUpStatus({ id: row._id as never, status: "done" });
      toast("Nice — follow-up completed.");
      return true;
    } catch {
      toast.error("Couldn't complete that — try again.");
      return false;
    }
  };

  const dismissAction = (id: string) => {
    setPlanDismissed((prev) => new Set(prev).add(id));
    toast("Removed from today's plan.");
  };

  // ── AI Business Brief (Phase 1 §5) — server-side action over profile,
  // goals and real CRM metrics. Falls back honestly when unavailable.
  const generateBrief = async () => {
    setBriefLoading(true);
    setBriefError(null);
    try {
      const industries = Object.entries(
        leads.reduce<Record<string, number>>((acc, l) => {
          if (l.industry) {
            const k = l.industry.trim();
            acc[k] = (acc[k] ?? 0) + 1;
          }
          return acc;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count }));
      const sources = Object.entries(
        leads.reduce<Record<string, number>>((acc, l) => {
          if (l.source) {
            const k = l.source.trim();
            acc[k] = (acc[k] ?? 0) + 1;
          }
          return acc;
        }, {}),
      )
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([name, count]) => ({ name, count }));
      const result = await businessBriefAction({
        profile: profile
          ? {
              businessName: profile.businessName,
              industry: profile.industry,
              businessType: profile.businessType,
              businessModel: profile.businessModel,
              products: profile.products,
              targetGeography: profile.targetGeography,
              teamSize: profile.teamSize,
              currentMonthlyRevenue: profile.currentMonthlyRevenue,
              targetMonthlyRevenue: profile.targetMonthlyRevenue,
              acquisitionChannels: profile.acquisitionChannels,
              avgSalesCycle: profile.avgSalesCycle,
              primaryChallenge: profile.primaryChallenge,
            }
          : undefined,
        goals: (goals ?? []).map((g) => ({
          name: g.name,
          kind: g.kind,
          period: g.period,
          targetValue: g.targetValue,
          current: g.current,
          unit: g.unit,
        })),
        metrics: {
          totalLeads: metrics.totalLeads,
          qualified: metrics.qualified,
          activeOpportunities: metrics.activeOpportunities,
          proposalsOut: metrics.proposalsOut,
          wonCount: metrics.wonCount,
          lostCount: leads.filter((l) => l.status === "lost").length,
          pipelineValue: metrics.pipelineValue,
          weightedPipeline: metrics.weightedPipeline,
          wonRevenue: metrics.wonRevenue,
          avgDealSize: metrics.avgDealSize,
          repliesReceived: messages.filter((m) => m.direction === "received").length,
          messagesSent: messages.filter((m) => m.direction === "sent").length,
          overdueFollowUps: metrics.overdueFollowUps,
          unreadReplies: metrics.unreadReplies,
          activeCampaigns: metrics.activeCampaigns,
          conversionRate: metrics.conversionRate,
          responseRate: metrics.responseRate,
        },
        activity: {
          recentMessages: recent
            .slice(0, 5)
            .map(
              (m) =>
                `${m.direction === "received" ? "Reply from" : "Sent to"} ${leadName(m.leadId)}: "${m.body.slice(0, 60)}${m.body.length > 60 ? "…" : ""}"`,
            ),
          topIndustries: industries,
          topSources: sources,
        },
      });
      if (!result) {
        setBriefError(
          "The AI brief isn't available right now (no OPENAI_API_KEY configured, or the provider couldn't be reached). The deterministic brief above always works from your data.",
        );
      } else {
        setAiBrief(result);
      }
    } catch {
      setBriefError("Generating the brief failed — try again in a moment.");
    } finally {
      setBriefLoading(false);
    }
  };

  return (
    <AppShell title="Dashboard">
      <OnboardingDialog />
      {/* ── Greeting + Growth Brief ───────────────────────────────────────── */}
      <header className="max-w-3xl">
        <h1 className="text-[26px] font-semibold uppercase leading-tight tracking-tight md:text-3xl">
          {greeting}, {first}.
        </h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">Here's what matters today.</p>

        {/* ── Business snapshot chips (Phase 1 §4) ─────────────────────── */}
        {profile === undefined ? null : profile === null ? (
          <div className="mt-5">
            <Link
              to="/business"
              className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-card px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground"
            >
              <Building2 className="size-3.5" /> Add your business context → sharper recommendations
            </Link>
          </div>
        ) : (
          <div className="mt-5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Link
              to="/business"
              className="inline-flex items-center gap-1.5 rounded-full border border-border bg-card px-3 py-1 font-medium text-foreground transition-colors hover:border-[#b3a894]"
            >
              <Building2 className="size-3.5" />
              {profile.businessName}
            </Link>
            {profile.industry && (
              <span className="rounded-full border border-border bg-secondary px-2.5 py-1">
                {profile.industry}
              </span>
            )}
            {profile.targetGeography && (
              <span className="rounded-full border border-border bg-secondary px-2.5 py-1">
                Sells to: {profile.targetGeography}
                </span>
            )}
            {profile.primaryChallenge && (
              <span className="rounded-full border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-2.5 py-1 text-[#82552e]">
                Focus: {profile.primaryChallenge}
              </span>
            )}
          </div>
        )}

        {leads.length === 0 ? (
          <EmptyWorkspace />
        ) : !brief.enoughData ? (
          <div className="mt-6 rounded-lg border border-border bg-card p-5">
            <p className="label-caps text-muted-foreground">Today's growth brief</p>
            <p className="mt-2 text-sm text-muted-foreground">
              Not enough data yet — add leads and the brief builds itself from your workspace.
            </p>
          </div>
        ) : (
          <div className="mt-6 rounded-lg border border-border bg-card p-5">
            <p className="label-caps text-muted-foreground">Today's growth brief</p>
            <p className="text-[11px] text-muted-foreground/60">computed from your workspace data · {new Date().toLocaleDateString(undefined, { month: "short", day: "numeric" })}</p>
            <ul className="mt-3 space-y-1.5">
              {brief.headline.map((line, i) => (
                <li key={i} className="flex items-start gap-2 text-sm leading-relaxed">
                  <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-[#9a9285]" />
                  {line.to ? (
                    <Link
                      to={line.to}
                      className={cn("underline-offset-4 hover:underline", toneClass(line.tone))}
                    >
                      {line.text}
                    </Link>
                  ) : (
                    <span className={toneClass(line.tone)}>{line.text}</span>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
      </header>

      {leads.length > 0 && (
        <>
          {/* ── Revenue snapshot (Phase 2 §21) ─────────────────────────── */}
          <section className="mt-10 border-t border-border pt-8">
            <div className="flex items-center justify-between">
              <p className="label-caps text-muted-foreground">Revenue snapshot</p>
              <Link to="/analytics" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                Revenue intelligence →
              </Link>
            </div>
            <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {[
                { label: "Pipeline", value: money(pipelineStats.pipelineValue, workspaceCurrency), hint: `${pipelineStats.openDeals} open deal${pipelineStats.openDeals === 1 ? "" : "s"}`, to: "/pipeline", icon: Users },
                { label: "Weighted pipeline", value: money(pipelineStats.weightedPipeline, workspaceCurrency), hint: "Estimate based on probabilities", to: "/analytics", icon: TrendingUp },
                { label: "Won revenue", value: money(closedStats.wonRevenue, workspaceCurrency), hint: `Actual closed · ${closedStats.wonCount} deal${closedStats.wonCount === 1 ? "" : "s"}`, to: "/analytics", icon: Trophy, tone: "olive" as const },
                { label: "Open deals", value: `${pipelineStats.openDeals}`, hint: `${pipelineStats.openOpportunities} in-pipeline`, to: "/pipeline", icon: Users },
                { label: "Proposals", value: `${pendingProposals}`, hint: pendingProposals > 0 ? "Awaiting response" : "None pending", to: "/proposals", icon: FileText },
                { label: "Clients", value: `${clients.length}`, hint: `${healthyClients} healthy`, to: "/clients", icon: Building2 },
              ].map((card, i) => {
                const Icon = card.icon;
                return (
                  <motion.div
                    key={card.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <Link
                      to={card.to}
                      className="block rounded-lg border border-border bg-card p-4 transition-colors hover:border-[#b3a894]"
                    >
                      <div className="flex items-center justify-between">
                        <p className={cn("tabular text-xl font-semibold tracking-tight", "tone" in card && card.tone === "olive" && "text-[#53634a]")}>
                          {card.value}
                        </p>
                        <Icon className="size-3.5 text-muted-foreground/50" />
                      </div>
                      <p className="label-caps mt-1.5 text-muted-foreground">{card.label}</p>
                      <p className="text-[11px] text-muted-foreground/60">{card.hint}</p>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          </section>

          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <section className="mt-12 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-border pt-8 sm:grid-cols-3 lg:grid-cols-6">
            {[
              // One pipeline definition everywhere (§27): the same
              // computePipelineStats the snapshot card, Pipeline header and
              // Analytics use — never the narrower in-pipeline subset.
              { label: "Pipeline value", value: money(pipelineStats.pipelineValue, workspaceCurrency), hint: `${pipelineStats.openDeals} open · weighted ${money(pipelineStats.weightedPipeline, workspaceCurrency)} (estimate)` },
              { label: "Won revenue", value: money(metrics.wonRevenue, workspaceCurrency), hint: `actual closed · ${metrics.wonCount} deal${metrics.wonCount === 1 ? "" : "s"}`, tone: "olive" },
              { label: "Conversion", value: `${metrics.conversionRate}%`, hint: "leads → won" },
              { label: "Avg deal size", value: metrics.avgDealSize === null ? "—" : money(metrics.avgDealSize, workspaceCurrency), hint: "closed deals" },
              { label: "Response rate", value: `${metrics.responseRate}%`, hint: `${metrics.unreadReplies} unread` },
              { label: "Total leads", value: `${metrics.totalLeads}`, hint: `${metrics.newThisWeek} new this week` },
            ].map((kpi, i) => (
              <motion.div
                key={kpi.label}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              >
                <p className={cn("tabular text-3xl font-semibold tracking-tight", kpi.tone === "olive" && "text-[#53634a]")}>
                  {kpi.value}
                </p>
                <p className="label-caps mt-1.5 text-muted-foreground">{kpi.label}</p>
                <p className="text-[11px] text-muted-foreground/60">{kpi.hint}</p>
              </motion.div>
            ))}
          </section>

          {/* ── Goal progress (Phase 1 §2/§4) ───────────────────────────── */}
          {goals !== undefined && goals.length > 0 && (
            <section className="mt-12 border-t border-border pt-8">
              <div className="flex items-center justify-between">
                <p className="label-caps text-muted-foreground">Goal progress</p>
                <Link to="/business" className="text-xs text-muted-foreground underline-offset-4 hover:underline">
                  Manage goals
                </Link>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {goals.slice(0, 3).map((g) => (
                  <div key={g._id} className="rounded-lg border border-border bg-card p-4">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="truncate text-sm font-medium">{g.name}</p>
                      <span className="shrink-0 text-[10px] text-muted-foreground">
                        {GOAL_PERIOD_LABELS[g.period as GoalPeriod]}
                      </span>
                    </div>
                    {g.current !== null && g.targetValue !== undefined ? (
                      <>
                        <p className="tabular mt-2 text-xl font-semibold tracking-tight">
                          {g.formatted}
                          <span className="text-sm font-normal text-muted-foreground">
                            {" "}/ {g.targetValue.toLocaleString()}
                          </span>
                        </p>
                        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4ddcf]">
                          <div
                            className={cn(
                              "h-full rounded-full",
                              (g.progress ?? 0) >= 1 ? "bg-[#53634a]" : "bg-[#171613]",
                            )}
                            style={{ width: `${Math.max(3, (g.progress ?? 0) * 100)}%` }}
                          />
                        </div>
                      </>
                    ) : (
                      <p className="mt-2 text-xs text-[#82552e]">Not measurable automatically</p>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── AI Business Brief (Phase 1 §5) ──────────────────────────── */}
          <section className="mt-12 border-t border-border pt-8">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="label-caps text-muted-foreground">AI business brief</p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  An estimate and recommendation based on your business profile, goals, and CRM
                  records — never market guesses.
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="h-8"
                onClick={() => void generateBrief()}
                disabled={briefLoading}
              >
                <Sparkles className="size-3.5" />
                {briefLoading ? "Analyzing…" : aiBrief ? "Regenerate brief" : "Generate brief"}
              </Button>
            </div>

            {briefError && (
              <p className="mt-3 rounded-md border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-3 py-2 text-xs leading-relaxed text-[#82552e]">
                {briefError}
              </p>
            )}

            {!briefError && !aiBrief && !briefLoading && (
              <p className="mt-3 text-sm text-muted-foreground">
                Generates a structured situation report with growth opportunities, risks, and next
                actions — grounded strictly in your workspace data. If there isn't enough data yet,
                it will say so rather than guess.
              </p>
            )}

            {briefLoading && (
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <Skeleton className="h-40 rounded-lg" />
                <Skeleton className="h-40 rounded-lg" />
                <Skeleton className="h-40 rounded-lg" />
              </div>
            )}

            {aiBrief && !briefLoading && (
              <div className="mt-3 grid gap-3 lg:grid-cols-3">
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="label-caps text-[10px] text-muted-foreground/70">Current situation</p>
                  <p className="mt-2 text-sm leading-relaxed">{aiBrief.situation}</p>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="label-caps text-[10px] text-muted-foreground/70">Growth opportunities</p>
                  <ul className="mt-2 space-y-1.5">
                    {aiBrief.opportunities.map((o, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-[#53634a]" />
                        {o}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border bg-card p-4">
                  <p className="label-caps text-[10px] text-muted-foreground/70">Risks & bottlenecks</p>
                  <ul className="mt-2 space-y-1.5">
                    {aiBrief.risks.map((r, i) => (
                      <li key={i} className="flex gap-2 text-[13px] leading-relaxed">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-[#a8442f]" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-lg border border-border bg-card p-4 lg:col-span-2">
                  <p className="label-caps text-[10px] text-muted-foreground/70">Recommended next actions</p>
                  <ol className="mt-2 list-decimal space-y-1.5 pl-4">
                    {aiBrief.actions.map((a, i) => (
                      <li key={i} className="text-[13px] leading-relaxed">{a}</li>
                    ))}
                  </ol>
                </div>
                <div className="flex items-start rounded-lg border border-border bg-muted/40 p-4 text-[11px] leading-relaxed text-muted-foreground">
                  AI-generated estimate from your workspace data ({new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}).
                  {aiBrief.insufficientData
                    ? " The model flagged that there isn't enough data yet for a reliable recommendation — treat these as directional only."
                    : " Verify against your own knowledge before acting — consequential actions always ask for confirmation."}
                </div>
              </div>
            )}
          </section>

          {/* ── Opportunities + Today's plan ───────────────────────────────── */}
          <section className="mt-12 grid gap-10 border-t border-border pt-8 lg:grid-cols-5">
            <div className="lg:col-span-3">
              <p className="label-caps text-muted-foreground">AI growth opportunities</p>
              {opportunities.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Not enough data yet — opportunities appear as your pipeline grows.
                </p>
              ) : (
                <ul className="mt-3 space-y-2.5">
                  {opportunities.map((o, i) => (
                    <motion.li
                      key={o.id}
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.05 * i, duration: 0.25 }}
                      className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3"
                    >
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-medium">{o.title}</p>
                        <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{o.evidence}</p>
                      </div>
                      <Button asChild variant="outline" size="sm" className="h-7 shrink-0 text-xs">
                        <Link to={o.action.to}>
                          {o.action.label} <ArrowUpRight className="size-3" />
                        </Link>
                      </Button>
                    </motion.li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground/60">
                Suggestions are estimates based on your workspace activity — not guarantees.
              </p>
            </div>

            <div className="lg:col-span-2">
              <p className="label-caps text-muted-foreground">Today's revenue priorities</p>
              {revenuePriorities.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing needs revenue attention right now — deals are moving, proposals are fresh,
                  clients are active.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {revenuePriorities.map((a) => (
                    <li key={a.id} className="rounded-lg border border-border bg-card px-3.5 py-2.5">
                      <Link to={a.to} className="block truncate text-sm font-medium underline-offset-4 hover:underline">
                        {a.title}
                      </Link>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{a.why}</p>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-3 text-[11px] text-muted-foreground/60">
                Every priority shows why it was selected — computed from your actual records.
              </p>
              <p className="label-caps mt-6 text-muted-foreground">Today's growth plan</p>
              {plan.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">
                  Nothing scheduled for today. Schedule follow-ups from any lead and they land here.
                </p>
              ) : (
                <ul className="mt-3 space-y-2">
                  {plan
                    .filter((a) => !planDismissed.has(a.id))
                    .map((a) => (
                      <li
                        key={a.id}
                        className="flex items-start gap-2 rounded-lg border border-border bg-card px-3.5 py-2.5"
                      >
                        <div className="min-w-0 flex-1">
                          <Link to={a.to} className="block truncate text-sm font-medium underline-offset-4 hover:underline">
                            {a.title}
                          </Link>
                          {a.why && (
                            <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{a.why}</p>
                          )}
                        </div>
                        <div className="flex shrink-0 gap-0.5">
                          <button
                            type="button"
                            aria-label="Complete action"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            onClick={async () => {
                              const done = await completeAction(a.id);
                              if (done || a.kind !== "followup") dismissAction(a.id);
                            }}
                          >
                            <Check className="size-3.5" />
                          </button>
                          <button
                            type="button"
                            aria-label="Dismiss action"
                            className="rounded p-1 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                            onClick={() => dismissAction(a.id)}
                          >
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </li>
                    ))}
                </ul>
              )}
            </div>
          </section>

          {/* ── Recent activity ────────────────────────────────────────────── */}
          <section className="mt-12 border-t border-border pt-8">
            <p className="label-caps text-muted-foreground">Recent activity</p>
            {recent.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                No messages yet — your outreach history lands here.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-border">
                {recent.map((m) => (
                  <li key={m._id} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden
                      className={cn(
                        "size-1.5 shrink-0 rounded-full",
                        m.direction === "received" ? "bg-[#6f4b5e]" : "bg-border",
                      )}
                    />
                    <Link to={`/leads/${m.leadId}`} className="min-w-0 flex-1 truncate text-sm hover:underline">
                      <span className="font-medium">{leadName(m.leadId)}</span>
                      <span className="text-muted-foreground">
                        {m.direction === "received" ? " replied" : " — outreach sent"}
                      </span>
                    </Link>
                    <span className="shrink-0 text-xs text-muted-foreground">{timeAgo(m.createdAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-6 flex flex-wrap items-center gap-4 border-t border-border pt-5 text-sm">
              <Link to="/leads" className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-[#6f4b5e]">
                Open workspace <ArrowRight className="size-3.5" />
              </Link>
              <Link to="/pipeline" className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                Pipeline view
              </Link>
              <Link to="/analytics" className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                Analytics
              </Link>
              <Link to="/assistant" className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                Ask the Copilot <ArrowRight className="size-3.5" />
              </Link>
            </div>
          </section>
        </>
      )}
    </AppShell>
  );
}
