import { AppShell } from "@/components/AppShell";
import { TiltCard } from "@/components/spatial";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
// Single source of truth for metrics (production hardening §8): the former
// src/lib/analytics.ts was merged into src/lib/growth.ts, which the Dashboard
// also uses — both pages now share identical metric definitions.
import { computeAnalytics, money } from "@/lib/growth";
import {
  computeClosedStats,
  computeForecast,
  computePipelineStats,
  dealFlags,
  dealTitle,
  pipelineAging,
  revenueBreakdown,
  stageLastAtMap,
  wonRevenueInPeriod,
} from "@/lib/revenue";
import { downloadTextFile, leadsToCsv } from "@/lib/outreach";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "convex/react";
import { ArrowDownToLine, BarChart3, Clock, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AnalyticsPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const history = useQuery(api.leads.stageHistoryForUser, {});
  const [breakdown, setBreakdown] = useState<"source" | "campaign" | "industry" | "company" | "stage">("source");

  const ready =
    leads !== undefined &&
    messages !== undefined &&
    campaigns !== undefined &&
    followUps !== undefined &&
    history !== undefined;

  if (!ready) {
    return (
      <AppShell title="Analytics">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-24 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </AppShell>
    );
  }

  const a = computeAnalytics(leads, messages, campaigns, followUps);

  // ── Revenue Intelligence (Phase 2 §6–§11) — same growth/revenue source of truth ──
  const closed = computeClosedStats(leads);
  const pipeline = computePipelineStats(leads);
  const forecast = computeForecast(closed, pipeline);
  const stageLastAt = useMemo(() => stageLastAtMap(history), [history]);
  const aging = pipelineAging(leads);
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = wonRevenueInPeriod(leads, monthStart.getTime());
  const breakdownRows = revenueBreakdown(leads, breakdown);

  const exportCsv = () => {
    if (leads.length === 0) {
      toast("No leads to export yet");
      return;
    }
    downloadTextFile(`dealflow-leads-${new Date().toISOString().slice(0, 10)}.csv`, leadsToCsv(leads));
    toast(`Exported ${leads.length} leads to CSV`);
  };

  const metrics = [
    { label: "Contact rate", value: `${a.contactRate}%`, hint: `${leads.filter((l) => l.lastContactedAt).length} of ${a.total} leads contacted` },
    { label: "Reply rate", value: `${a.replyRate}%`, hint: `${a.repliesReceived} replies logged` },
    { label: "Meeting rate", value: `${a.meetingRate}%`, hint: "proposal or better · estimates" },
    { label: "Win rate", value: a.won + a.lost > 0 ? `${a.winRate}%` : "—", hint: `closed deals only · ${a.won} won · ${a.lost} lost` },
  ];

  const maxFunnel = Math.max(1, ...a.funnel.map((f) => f.count));

  return (
    <AppShell
      title="Analytics"
      actions={
        <Button variant="outline" onClick={exportCsv}>
          <ArrowDownToLine className="size-4" /> Export CSV
        </Button>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        How your pipeline is actually performing — computed live from your data.
      </p>

      {a.total === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <BarChart3 className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No data to analyze yet.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Add leads, send outreach, and log replies — analytics build themselves as you work.
          </p>
        </div>
      ) : (
        <>
          {/* Metric cards — floating */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {metrics.map((m) => (
              <TiltCard key={m.label} className="p-4">
                <p className="label-caps text-muted-foreground/70">{m.label}</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{m.value}</p>
                <p className="mt-1 text-xs text-muted-foreground">{m.hint}</p>
              </TiltCard>
            ))}
          </div>

          <div className="mt-4 grid gap-4 lg:grid-cols-3">
            {/* Funnel */}
            <section className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
              <h2 className="text-sm font-semibold">Pipeline funnel</h2>
              <div className="mt-4 space-y-2.5">
                {a.funnel.map((stage) => (
                  <div key={stage.key} className="flex items-center gap-3">
                    <span className="w-20 shrink-0 text-xs text-muted-foreground">{stage.label}</span>
                    <div className="h-6 flex-1 overflow-hidden rounded-md bg-[#e4ddcf]">
                      <div
                        className={cn(
                          "flex h-full items-center justify-end rounded-md px-2 transition-all",
                          stage.key === "won"
                            ? "bg-[#171613] text-[#f5f0e6]"
                            : "bg-[#9a9285] text-[#f5f0e6]",
                        )}
                        style={{ width: `${Math.max(8, (stage.count / maxFunnel) * 100)}%` }}
                      >
                        <span className="tabular text-[11px] font-medium">{stage.count}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </section>

            {/* Activity */}
            <section className="rounded-lg border border-border bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold">
                <TrendingUp className="size-4" /> Activity
              </h2>
              <dl className="mt-4 space-y-3 text-sm">
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Leads total</dt>
                  <dd className="tabular font-medium">{a.total}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Messages sent</dt>
                  <dd className="tabular font-medium">{a.messagesSent}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Replies received</dt>
                  <dd className="tabular font-medium">{a.repliesReceived}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Follow-ups due 24h</dt>
                  <dd className="tabular font-medium">{a.followUpsDue}</dd>
                </div>
                <div className="flex items-center justify-between">
                  <dt className="text-muted-foreground">Active campaigns</dt>
                  <dd className="tabular font-medium">{a.activeCampaigns}</dd>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <dt className="text-muted-foreground">Avg lead score</dt>
                  <dd className="tabular font-semibold">{a.avgScore ?? "—"}</dd>
                </div>
              </dl>
            </section>
          </div>

          {/* Top industries */}
          {a.topIndustries.length > 0 && (
            <section className="mt-4 rounded-lg border border-border bg-card p-5">
              <h2 className="text-sm font-semibold">Top industries</h2>
              <div className="mt-3 flex flex-wrap gap-2">
                {a.topIndustries.map((ind) => (
                  <Link
                    key={ind.name}
                    to="/leads"
                    className="rounded-full border border-border bg-card px-3 py-1 text-xs text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground"
                  >
                    {ind.name} · {ind.count}
                  </Link>
                ))}
              </div>
            </section>
          )}

          {/* ── Revenue Intelligence (Phase 2 §6–§11) ─────────────────────── */}
          <section className="mt-8 border-t border-border pt-8">
            <div>
              <h2 className="text-sm font-semibold">Revenue intelligence</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Computed from persisted deal records. Weighted and forecast figures are estimates,
                never guarantees. Won/lost revenue is dated by the won/lost timestamp where one
                exists.
              </p>
            </div>

            {/* Pipeline + closed + forecast cards */}
            <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Pipeline value</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{money(pipeline.pipelineValue)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Sum of open deal values · {pipeline.openDeals} open ({pipeline.openOpportunities} in-pipeline)
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Weighted pipeline</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{money(pipeline.weightedPipeline)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Estimate based on current deal probabilities
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Won revenue</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight text-[#53634a]">{money(closed.wonRevenue)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Actual closed · {closed.wonCount} won{closed.undatedWonCount > 0 ? ` (${closed.undatedWonCount} predate timestamps)` : ""}
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Lost value</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{money(closed.lostValue)}</p>
                <p className="mt-1 text-xs text-muted-foreground">{closed.lostCount} lost deal{closed.lostCount === 1 ? "" : "s"}</p>
              </TiltCard>
            </div>

            {/* Sales metrics (§8) — labeled by formula, honest when empty */}
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Win rate (closed deals)</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
                  {closed.winRate === null ? "—" : `${closed.winRate}%`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {closed.winRate === null
                    ? "Not enough data yet — no closed deals"
                    : `won ÷ (won + lost) · ${closed.wonCount} won, ${closed.lostCount} lost`}
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Avg deal size (won)</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
                  {closed.avgDealSize === null ? "—" : money(closed.avgDealSize)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {closed.avgDealSize === null
                    ? "No closed revenue yet — appears when a valued deal is Won"
                    : `won revenue ÷ ${closed.valuedWonCount} valued won deal${closed.valuedWonCount === 1 ? "" : "s"}`}
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps flex items-center gap-1 text-muted-foreground/70">
                  <Clock className="size-3" /> Sales cycle (avg)
                </p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">
                  {closed.avgSalesCycleDays === null ? "—" : `${closed.avgSalesCycleDays}d`}
                </p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {closed.avgSalesCycleDays === null
                    ? "Not enough data yet — needs won deals with timestamps"
                    : `wonAt − created · median ${closed.medianSalesCycleDays}d · ${closed.salesCycleSample} deal${closed.salesCycleSample === 1 ? "" : "s"}`}
                </p>
              </TiltCard>
              <TiltCard className="p-4">
                <p className="label-caps text-muted-foreground/70">Won this month</p>
                <p className="tabular mt-2 text-3xl font-semibold tracking-tight">{money(thisMonth.revenue)}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Dated by won timestamp{thisMonth.undatedExcluded > 0 ? ` · ${thisMonth.undatedExcluded} older won deal${thisMonth.undatedExcluded === 1 ? "" : "s"} without timestamps excluded` : ""}
                </p>
              </TiltCard>
            </div>

            {/* Forecast (§11) — actuals and estimates visually distinct */}
            <div className="mt-3 grid gap-3 lg:grid-cols-2">
              <section className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Forecast</h3>
                <div className="mt-3 space-y-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-medium">Conservative</p>
                      <p className="text-xs text-muted-foreground">Closed won revenue only — an actual, not a prediction</p>
                    </div>
                    <span className="tabular text-lg font-semibold">{money(forecast.conservative)}</span>
                  </div>
                  <div className="flex items-center justify-between gap-3 border-t border-border pt-3">
                    <div>
                      <p className="font-medium">
                        Weighted <span className="ml-1 rounded-full border border-[#a06b3c]/35 bg-[#a06b3c]/[0.08] px-1.5 py-0.5 text-[10px] font-medium text-[#82552e]">estimate</span>
                      </p>
                      <p className="text-xs text-muted-foreground">Won revenue + probability-weighted open pipeline</p>
                    </div>
                    <span className="tabular text-lg font-semibold">{money(forecast.weighted)}</span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-muted-foreground/60">
                    Estimates based on current pipeline data — not a guarantee of future revenue. No
                    AI-invented predictions are used.
                  </p>
                </div>
              </section>

              {/* Aging (§10) */}
              <section className="rounded-lg border border-border bg-card p-5">
                <h3 className="text-sm font-semibold">Pipeline aging</h3>
                <p className="mt-0.5 text-xs text-muted-foreground">Open deals by age since creation</p>
                <div className="mt-3 space-y-2">
                  {aging.map((b) => {
                    const max = Math.max(1, ...aging.map((x) => x.count));
                    return (
                      <div key={b.key} className="flex items-center gap-3">
                        <span className="w-20 shrink-0 text-xs text-muted-foreground">{b.label}</span>
                        <div className="h-5 flex-1 overflow-hidden rounded-md bg-[#e4ddcf]">
                          <div
                            className={cn(
                              "flex h-full items-center justify-end rounded-md px-2",
                              b.key === "older" ? "bg-[#a8442f]/70" : "bg-[#9a9285]",
                            )}
                            style={{ width: `${Math.max(b.count > 0 ? 8 : 0, (b.count / max) * 100)}%` }}
                          >
                            {b.count > 0 && <span className="tabular text-[10px] font-medium text-[#f5f0e6]">{b.count}</span>}
                          </div>
                        </div>
                        <span className="tabular w-14 shrink-0 text-right text-xs text-muted-foreground">{money(b.value)}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            </div>

            {/* Breakdowns (§9) — honest about missing attribution */}
            <section className="mt-3 rounded-lg border border-border bg-card p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Revenue breakdowns</h3>
                <div className="flex flex-wrap gap-1">
                  {([
                    ["source", "Source"],
                    ["campaign", "Campaign"],
                    ["industry", "Industry"],
                    ["company", "Company"],
                    ["stage", "Stage"],
                  ] as const).map(([key, label]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setBreakdown(key)}
                      className={cn(
                        "cursor-pointer rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                        breakdown === key
                          ? "border-[#171613]/40 bg-[#e4ddcf] font-medium text-foreground"
                          : "border-border bg-card text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              {breakdownRows.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">Not enough data yet — no deals to break down.</p>
              ) : (
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full min-w-[480px] text-sm">
                    <thead>
                      <tr className="border-b border-border text-left">
                        <th className="label-caps pb-2 font-normal text-muted-foreground/70">{breakdown}</th>
                        <th className="label-caps pb-2 text-right font-normal text-muted-foreground/70">Deals</th>
                        <th className="label-caps pb-2 text-right font-normal text-muted-foreground/70">Open pipeline</th>
                        <th className="label-caps pb-2 text-right font-normal text-muted-foreground/70">Won</th>
                        <th className="label-caps pb-2 text-right font-normal text-muted-foreground/70">Lost</th>
                      </tr>
                    </thead>
                    <tbody>
                      {breakdownRows.map((r) => (
                        <tr key={r.key ?? "__none__"} className="border-b border-border/50 last:border-0">
                          <td className="py-2">
                            {r.key === null ? (
                              <span className="text-xs italic text-muted-foreground/60">No attribution data yet</span>
                            ) : (
                              <span className="capitalize">{r.label}</span>
                            )}
                          </td>
                          <td className="tabular py-2 text-right">{r.count}</td>
                          <td className="tabular py-2 text-right">{r.pipeline > 0 ? money(r.pipeline) : "—"}</td>
                          <td className="tabular py-2 text-right text-[#42503c]">{r.won > 0 ? money(r.won) : "—"}</td>
                          <td className="tabular py-2 text-right text-muted-foreground">{r.lost > 0 ? money(r.lost) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>

            {/* At-risk deals (§10) — every row shows its reason */}
            {(() => {
              const flagged = leads
                .filter((l) => l.status !== "won" && l.status !== "lost")
                .map((l) => ({ lead: l, flags: dealFlags(l, { lastStageAt: stageLastAt.get(l._id as string) }) }))
                .filter((f) => f.flags.length > 0)
                .sort((x, y) => (y.lead.dealValue ?? 0) - (x.lead.dealValue ?? 0))
                .slice(0, 6);
              if (flagged.length === 0) return null;
              return (
                <section className="mt-3 rounded-lg border border-border bg-card p-5">
                  <h3 className="text-sm font-semibold">Deals needing attention</h3>
                  <ul className="mt-3 divide-y divide-border">
                    {flagged.map(({ lead, flags }) => (
                      <li key={lead._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                        <Link to={`/leads/${lead._id}`} className="min-w-0 flex-1 truncate text-sm font-medium underline-offset-4 hover:underline">
                          {dealTitle(lead)}
                          {lead.dealValue !== undefined && (
                            <span className="ml-1.5 font-normal text-muted-foreground">{money(lead.dealValue)}</span>
                          )}
                        </Link>
                        <span className="text-xs text-muted-foreground">{flags[0].detail}</span>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })()}
          </section>
        </>
      )}
    </AppShell>
  );
}
