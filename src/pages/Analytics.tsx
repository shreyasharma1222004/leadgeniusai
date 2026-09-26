import { AppShell } from "@/components/AppShell";
import { TiltCard } from "@/components/spatial";
import { Button } from "@/components/ui/button";
import { api } from "@/convex/_generated/api";
import { computeAnalytics } from "@/lib/analytics";
import { downloadTextFile, leadsToCsv } from "@/lib/outreach";
import { useAuth } from "@/hooks/use-auth";
import { useQuery } from "convex/react";
import { ArrowDownToLine, BarChart3, TrendingUp } from "lucide-react";
import { Link } from "react-router";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export default function AnalyticsPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});
  const followUps = useQuery(api.followUps.listForUser, {});

  const ready = leads !== undefined && messages !== undefined && campaigns !== undefined && followUps !== undefined;

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
    { label: "Meeting rate", value: `${a.meetingRate}%`, hint: "replied → meeting or better" },
    { label: "Win rate", value: a.won + a.lost > 0 ? `${a.winRate}%` : "—", hint: `${a.won} won · ${a.lost} lost` },
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
        </>
      )}
    </AppShell>
  );
}
