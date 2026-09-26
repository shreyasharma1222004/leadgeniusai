import { AppShell } from "@/components/AppShell";
import { AddLeadDialog } from "@/components/AddLeadDialog";
import { ImportCsvDialog } from "@/components/ImportCsvDialog";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { ArrowRight, ArrowUpRight } from "lucide-react";
import { Link } from "react-router";

export default function OverviewPage() {
  const { user } = useAuth();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const campaigns = useQuery(api.campaigns.list, {});

  const ready = leads !== undefined && messages !== undefined && followUps !== undefined && campaigns !== undefined;

  const first = (user?.name ?? "there").split(" ")[0];

  if (!ready) {
    return (
      <AppShell title="Overview">
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
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  // ── Attention items ──────────────────────────────────────────────────────
  const overdue = followUps.filter((f) => f.status === "pending" && f.dueAt < now);
  const dueToday = followUps.filter(
    (f) => f.status === "pending" && f.dueAt >= now && f.dueAt <= endOfDay.getTime(),
  );
  const unread = messages.filter((m) => m.direction === "received" && !m.readAt);

  const attention = [
    overdue.length > 0 && { label: `${overdue.length} follow-up${overdue.length === 1 ? "" : "s"} overdue`, to: "/tasks", tone: "danger" as const },
    unread.length > 0 && { label: `${unread.length} repl${unread.length === 1 ? "y" : "ies"} waiting`, to: "/inbox", tone: "plum" as const },
    dueToday.length > 0 && { label: `${dueToday.length} follow-up${dueToday.length === 1 ? "" : "s"} due today`, to: "/tasks", tone: "default" as const },
  ].filter(Boolean) as { label: string; to: string; tone: "danger" | "plum" | "default" }[];

  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  // ── Pipeline numbers ─────────────────────────────────────────────────────
  const total = leads.length;
  const contacted = leads.filter(
    (l) => l.lastContactedAt !== undefined || ["contacted", "replied", "interested", "meeting", "won"].includes(l.status),
  ).length;
  const replies = leads.filter((l) => ["replied", "interested", "meeting", "won"].includes(l.status)).length;
  const meetings = leads.filter((l) => l.status === "meeting" || l.status === "won").length;
  const won = leads.filter((l) => l.status === "won").length;

  // ── Focus & activity ─────────────────────────────────────────────────────
  const focus = [...overdue, ...dueToday, ...followUps.filter((f) => f.status === "pending" && f.dueAt > endOfDay.getTime())].slice(0, 5);
  const leadName = (id: string) => leads.find((l) => l._id === id)?.name ?? "Lead";
  const recent = [...messages].sort((a, b) => b.createdAt - a.createdAt).slice(0, 6);
  const campaignSends = messages.filter((m) => m.campaignId && m.direction === "sent").length;
  const campaignReplies = messages.filter((m) => m.campaignId && m.direction === "received").length;

  return (
    <AppShell title="Overview">
      {/* Greeting — editorial, directly on the canvas */}
      <header className="max-w-2xl">
        <h1 className="text-[26px] font-semibold uppercase leading-tight tracking-tight md:text-3xl">
          {greeting}, {first}.
        </h1>
        <p className="mt-2 text-[15px] text-muted-foreground">
          {attention.length === 0
            ? "You're clear for today. Nothing waiting on you."
            : attention.length === 1
              ? "1 thing needs your attention today."
              : `${attention.length} things need your attention today.`}
        </p>
        {attention.length > 0 && (
          <div className="mt-4 flex flex-wrap gap-2">
            {attention.map((a) => (
              <Link
                key={a.label}
                to={a.to}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-colors",
                  a.tone === "danger"
                    ? "border-[#a8442f]/30 bg-[#a8442f]/[0.07] text-[#8a3625] hover:bg-[#a8442f]/[0.12]"
                    : a.tone === "plum"
                      ? "border-[#6f4b5e]/30 bg-[#6f4b5e]/[0.08] text-[#6f4b5e] hover:bg-[#6f4b5e]/[0.14]"
                      : "border-border bg-card text-foreground hover:border-[#b3a894]",
                )}
              >
                {a.label}
                <ArrowUpRight className="size-3" />
              </Link>
            ))}
          </div>
        )}
      </header>

      {total === 0 ? (
        /* Editorial empty state — typography, not illustration */
        <section className="mt-16 border-t border-border pt-10">
          <h2 className="text-2xl font-semibold tracking-tight">No leads yet.</h2>
          <p className="mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
            Import your list or add your first prospect — DealFlow AI will research
            them and draft the opening message.
          </p>
          <div className="mt-6 flex flex-wrap gap-2">
            <AddLeadDialog />
            <ImportCsvDialog />
          </div>
        </section>
      ) : (
        <>
          {/* Pipeline overview — asymmetric: large left block, focus right */}
          <section className="mt-12 grid gap-10 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <p className="label-caps text-muted-foreground">Pipeline</p>
              <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-8 sm:grid-cols-3">
                {[
                  { label: "Leads", value: total },
                  { label: "Contacted", value: contacted },
                  { label: "Replies", value: replies },
                  { label: "Meetings", value: meetings },
                  { label: "Won", value: won, tone: "olive" as const },
                ].map((stat, i) => (
                  <motion.div
                    key={stat.label}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: 0.05 * i, duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
                  >
                    <p
                      className={cn(
                        "tabular text-4xl font-semibold tracking-tight md:text-5xl",
                        stat.tone === "olive" && "text-[#53634a]",
                      )}
                    >
                      {stat.value}
                    </p>
                    <p className="label-caps mt-1.5 text-muted-foreground">{stat.label}</p>
                  </motion.div>
                ))}
              </div>
              <div className="mt-8 flex flex-wrap items-center gap-4 border-t border-border pt-5 text-sm">
                <Link to="/leads" className="inline-flex items-center gap-1 font-medium underline underline-offset-4 hover:text-[#6f4b5e]">
                  Open workspace <ArrowRight className="size-3.5" />
                </Link>
                <Link to="/pipeline" className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                  Pipeline view
                </Link>
                <Link to="/analytics" className="inline-flex items-center gap-1 text-muted-foreground transition-colors hover:text-foreground">
                  Analytics
                </Link>
              </div>
            </div>

            {/* Today's focus — actionable */}
            <div className="rounded-lg border border-border bg-card p-5">
              <div className="flex items-center justify-between">
                <p className="label-caps text-muted-foreground">Today's focus</p>
                <Link to="/tasks" className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                  All tasks
                </Link>
              </div>
              {focus.length === 0 ? (
                <p className="mt-6 text-sm text-muted-foreground">
                  Nice. Nothing scheduled — clear for the rest of the day.
                </p>
              ) : (
                <ul className="mt-3 divide-y divide-border">
                  {focus.map((f) => {
                    const isOverdue = f.status === "pending" && f.dueAt < now;
                    return (
                      <li key={f._id} className="py-2.5">
                        <Link to={`/leads/${f.leadId}`} className="group block">
                          <p className="truncate text-sm font-medium group-hover:underline">
                            {f.note || `Follow up with ${leadName(f.leadId)}`}
                          </p>
                          <p className={cn("mt-0.5 text-xs", isOverdue ? "text-[#a8442f]" : "text-muted-foreground")}>
                            {leadName(f.leadId)} · {isOverdue ? `overdue ${timeAgo(f.dueAt)}` : `due ${timeAgo(f.dueAt).replace(" from now", "")}`}
                          </p>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </section>

          {/* Recent activity + campaigns — lightweight, mostly on canvas */}
          <section className="mt-12 grid gap-10 border-t border-border pt-8 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <p className="label-caps text-muted-foreground">Recent activity</p>
              {recent.length === 0 ? (
                <p className="mt-4 text-sm text-muted-foreground">
                  No messages yet — your outreach history will land here.
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
            </div>

            {campaigns.length > 0 && (
              <div>
                <p className="label-caps text-muted-foreground">Campaigns</p>
                <div className="mt-3 space-y-4">
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-3xl font-semibold tracking-tight">{campaignSends}</span>
                    <span className="text-xs text-muted-foreground">emails sent via campaigns</span>
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="tabular text-3xl font-semibold tracking-tight">{campaignReplies}</span>
                    <span className="text-xs text-muted-foreground">replies generated</span>
                  </div>
                  <Link to="/campaigns" className="inline-flex items-center gap-1 text-sm text-muted-foreground transition-colors hover:text-foreground">
                    Manage campaigns <ArrowRight className="size-3.5" />
                  </Link>
                </div>
              </div>
            )}
          </section>
        </>
      )}
    </AppShell>
  );
}
