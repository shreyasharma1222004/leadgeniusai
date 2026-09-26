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
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight, Check, X } from "lucide-react";
import { Link } from "react-router";
import { useState } from "react";
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
  const setFollowUpStatus = useMutation(api.leads.setFollowUpStatus);

  const ready = leads !== undefined && messages !== undefined && followUps !== undefined && campaigns !== undefined;

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
  const brief = computeGrowthBrief(metrics, leads);
  const opportunities = computeOpportunities(metrics, leads, followUps as FollowUpRow[]);
  const plan = computeTodayPlan(metrics, leads, followUps as FollowUpRow[]);

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

  const [planDismissed, setPlanDismissed] = useState<Set<string>>(new Set());

  return (
    <AppShell title="Dashboard">
      <OnboardingDialog />
      {/* ── Greeting + Growth Brief ───────────────────────────────────────── */}
      <header className="max-w-3xl">
        <h1 className="text-[26px] font-semibold uppercase leading-tight tracking-tight md:text-3xl">
          {greeting}, {first}.
        </h1>
        <p className="mt-1.5 text-[15px] text-muted-foreground">Here's what matters today.</p>

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
          {/* ── KPI strip ──────────────────────────────────────────────────── */}
          <section className="mt-10 grid grid-cols-2 gap-x-8 gap-y-8 border-t border-border pt-8 sm:grid-cols-3 lg:grid-cols-6">
            {[
              { label: "Pipeline value", value: money(metrics.pipelineValue), hint: `${metrics.activeOpportunities} active` },
              { label: "Won revenue", value: money(metrics.wonRevenue), hint: `${metrics.wonCount} deal${metrics.wonCount === 1 ? "" : "s"}`, tone: "olive" },
              { label: "Conversion", value: `${metrics.conversionRate}%`, hint: "leads → won" },
              { label: "Avg deal size", value: metrics.avgDealSize === null ? "—" : money(metrics.avgDealSize), hint: "closed deals" },
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
              <p className="label-caps text-muted-foreground">Today's growth plan</p>
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
