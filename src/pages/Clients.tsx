import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { formatDateTime, initials, timeAgo } from "@/lib/format";
import { money } from "@/lib/growth";
import {
  type Client,
  type ClientFilterState,
  computeClients,
  filterClients,
  sortClients,
} from "@/lib/clients";
import { REVENUE_THRESHOLDS, lastActivityOf } from "@/lib/revenue";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { motion } from "framer-motion";
import { Building2, HeartPulse, Search, TrendingUp, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";

type Lead = Doc<"leads">;

const HEALTH_CLASSES: Record<ClientHealth["state"], string> = {
  healthy: "border-[#53634a]/45 bg-[#53634a]/[0.12] text-[#42503c]",
  attention: "border-[#a06b3c]/45 bg-[#a06b3c]/[0.1] text-[#82552e]",
  quiet: "border-[#a8442f]/45 bg-[#a8442f]/[0.1] text-[#a8442f]",
};

// Importing after declaration order matters not in TS; alias for label use below.
type ClientHealth = Client["health"];

const RETENTION_LABELS: Record<Client["retention"]["state"], string> = {
  at_risk: "At risk",
  healthy: "Healthy",
  expansion: "Expansion opportunity",
  insufficient: "Not enough data",
};

function healthPill(c: Client) {
  return (
    <span
      title={c.health.detail}
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        HEALTH_CLASSES[c.health.state],
      )}
    >
      <HeartPulse className="size-3" />
      {c.health.state === "healthy" ? "Healthy" : c.health.state === "attention" ? "Needs attention" : "Quiet"}
    </span>
  );
}

export default function ClientsPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const leads = useQuery(api.leads.list, {});
  const messages = useQuery(api.messages.listForUser, {});
  const followUps = useQuery(api.followUps.listForUser, {});
  const profile = useQuery(api.business.myProfile, {});

  const [filters, setFilters] = useState<ClientFilterState>({
    health: "all",
    minRevenue: "",
    active: "all",
    q: "",
  });

  const clients = useMemo(() => {
    if (leads === undefined) return undefined;
    return computeClients(leads, profile?.products);
  }, [leads, profile?.products]);

  // ── Detail route ───────────────────────────────────────────────────────
  if (id) {
    if (clients === undefined || messages === undefined || followUps === undefined) {
      return (
        <AppShell title="Client">
          <div className="space-y-4">
            <Skeleton className="h-24 w-full rounded-lg" />
            <div className="grid gap-4 lg:grid-cols-3">
              <Skeleton className="h-72 rounded-lg lg:col-span-2" />
              <Skeleton className="h-72 rounded-lg" />
            </div>
          </div>
        </AppShell>
      );
    }
    const client = clients.find((c) => c.key === id);
    if (!client) {
      return (
        <AppShell title="Client">
          <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <h2 className="text-lg font-semibold">Client not found.</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Clients exist while at least one of their deals is marked Won.
            </p>
            <Button asChild className="mt-5">
              <Link to="/clients">Back to clients</Link>
            </Button>
          </div>
        </AppShell>
      );
    }
    return (
      <ClientDetail
        client={client}
        messages={messages}
        followUps={followUps}
      />
    );
  }

  // ── List route ─────────────────────────────────────────────────────────
  if (clients === undefined) {
    return (
      <AppShell title="Clients">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-36 rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  if (clients.length === 0) {
    return (
      <AppShell title="Clients">
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <Users className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No clients yet.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Clients appear when a deal is marked Won — close your first deal and the client
            workspace builds itself from your records.
          </p>
          <Button asChild className="mt-5">
            <Link to="/pipeline">Open pipeline</Link>
          </Button>
        </div>
      </AppShell>
    );
  }

  const filtered = sortClients(filterClients(clients, filters), "revenue");

  return (
    <AppShell title="Clients">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Clients emerge automatically when a deal is marked Won — grouped by company (or contact).
        Every underlying record stays in your Leads, Notes, Tasks and Inbox; nothing is duplicated.
      </p>

      {/* Filters (§24): health, revenue, active deals, search */}
      <div className="mb-4 grid gap-3 rounded-lg border border-border bg-card p-3 sm:grid-cols-4">
        <div className="grid gap-1">
          <Label htmlFor="c-q" className="text-xs">Search</Label>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="c-q"
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Company or contact"
              className="h-8 pl-7 text-sm"
            />
          </div>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="c-health" className="text-xs">Health</Label>
          <select
            id="c-health"
            value={filters.health}
            onChange={(e) => setFilters((f) => ({ ...f, health: e.target.value as ClientFilterState["health"] }))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All</option>
            <option value="healthy">Healthy</option>
            <option value="attention">Needs attention</option>
            <option value="quiet">Quiet</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="c-rev" className="text-xs">Revenue</Label>
          <select
            id="c-rev"
            value={filters.minRevenue}
            onChange={(e) => setFilters((f) => ({ ...f, minRevenue: e.target.value as ClientFilterState["minRevenue"] }))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="">All</option>
            <option value="gt0">Has recorded revenue</option>
          </select>
        </div>
        <div className="grid gap-1">
          <Label htmlFor="c-active" className="text-xs">Active deals</Label>
          <select
            id="c-active"
            value={filters.active}
            onChange={(e) => setFilters((f) => ({ ...f, active: e.target.value as ClientFilterState["active"] }))}
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          >
            <option value="all">All</option>
            <option value="hasActive">Has active deals</option>
          </select>
        </div>
      </div>

      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((c, i) => (
          <motion.li
            key={c.key}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.04 * i, duration: 0.25 }}
          >
            <Link
              to={`/clients/${encodeURIComponent(c.key)}`}
              className="flex h-full flex-col rounded-lg border border-border bg-card p-4 transition-colors hover:border-[#b3a894]"
            >
              <div className="flex items-center gap-2.5">
                <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-[11px] font-semibold text-muted-foreground">
                  {initials(c.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{c.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {c.primaryLead.name} · {c.industry ?? "Industry not set"}
                  </p>
                </div>
              </div>
              <div className="mt-3 flex items-center justify-between">
                <span className="tabular text-lg font-semibold">{money(c.totalRevenue)}</span>
                {healthPill(c)}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground/70">{c.health.detail}</p>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {c.wonDeals.length} won · {c.activeDeals.length} active deal{c.activeDeals.length === 1 ? "" : "s"}
                {c.retention.state === "at_risk" && " · at risk"}
                {c.retention.state === "expansion" && " · expansion signal"}
              </p>
            </Link>
          </motion.li>
        ))}
      </ul>
    </AppShell>
  );
}

/** Client workspace (§16): overview, revenue, deals, comms, retention. */
function ClientDetail({
  client,
  messages,
  followUps,
}: {
  client: Client;
  messages: Doc<"messages">[];
  followUps: { _id: string; leadId: string; dueAt: number; status: string; note?: string }[];
}) {
  const dealIds = new Set(client.deals.map((d) => d.lead._id as string));
  const clientMessages = messages
    .filter((m) => dealIds.has(m.leadId))
    .sort((a, b) => b.createdAt - a.createdAt);
  const clientFollowUps = followUps.filter((f) => dealIds.has(f.leadId));
  const last = client.lastActivityAt;

  return (
    <AppShell
      title={
        <span className="flex items-center gap-2">
          <Link
            to="/clients"
            className="flex size-8 items-center justify-center rounded-md border border-border text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Back to clients"
          >
            <Building2 className="size-4" />
          </Link>
          {client.name}
        </span>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Primary contact {client.primaryLead.name}
        {client.primaryLead.email ? ` · ${client.primaryLead.email}` : ""}
        {client.website ? ` · ${client.website}` : ""}
      </p>

      {/* Overview numbers (§16) */}
      <div className="grid grid-cols-2 gap-6 border-b border-border pb-6 sm:grid-cols-3 lg:grid-cols-5">
        {[
          { label: "Total won revenue", value: money(client.totalRevenue) },
          { label: "Open deal value", value: client.openValue > 0 ? money(client.openValue) : "—" },
          { label: "Won deals", value: `${client.wonDeals.length}` },
          { label: "Active deals", value: `${client.activeDeals.length}` },
          {
            label: "Last activity",
            value: last !== undefined ? timeAgo(last) : "None recorded",
          },
        ].map((s) => (
          <div key={s.label}>
            <p className="tabular text-2xl font-semibold tracking-tight">{s.value}</p>
            <p className="label-caps mt-1 text-muted-foreground">{s.label}</p>
          </div>
        ))}
      </div>

      <div className="mt-6 grid gap-4 lg:grid-cols-3">
        {/* Health + retention (§17/§18) — transparent, evidence-based */}
        <div className="space-y-4">
          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <HeartPulse className="size-4 text-muted-foreground" /> Client health
            </h2>
            <div className="mt-3">{healthPill(client)}</div>
            <p className="mt-2 text-sm text-muted-foreground">{client.health.detail}</p>
            <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/60">
              Health is computed from recorded activity: last touch, scheduled follow-ups, and recent
              messages. Thresholds: healthy under {REVENUE_THRESHOLDS.clientHealthyDays} days, needs
              attention below {REVENUE_THRESHOLDS.clientInactiveDays}, quiet beyond that.
            </p>
          </section>

          <section className="rounded-lg border border-border bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold">
              <TrendingUp className="size-4 text-muted-foreground" /> Retention
            </h2>
            <p className="mt-3 text-sm font-medium">{RETENTION_LABELS[client.retention.state]}</p>
            {client.retention.evidence.length === 0 ? (
              <p className="mt-2 text-sm text-muted-foreground">
                Not enough information to identify a retention or expansion signal yet.
              </p>
            ) : (
              <ul className="mt-2 space-y-1.5">
                {client.retention.evidence.map((e, i) => (
                  <li key={i} className="flex gap-2 text-[13px] leading-relaxed text-muted-foreground">
                    <span aria-hidden className="mt-2 size-1 shrink-0 rounded-full bg-foreground/50" />
                    {e}
                  </li>
                ))}
              </ul>
            )}
            {client.nextActivityAt !== undefined && (
              <p className="mt-3 text-xs text-muted-foreground">
                Next scheduled activity {timeAgo(client.nextActivityAt).replace(" from now", "")}
              </p>
            )}
          </section>
        </div>

        {/* Deals (revenue + work) */}
        <section className="rounded-lg border border-border bg-card p-5 lg:col-span-2">
          <h2 className="text-sm font-semibold">Deals & revenue</h2>
          {client.deals.length === 0 ? (
            <p className="mt-3 text-sm text-muted-foreground">No deals recorded for this client.</p>
          ) : (
            <ul className="mt-3 divide-y divide-border">
              {client.deals.map((d) => (
                <li key={d.lead._id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="min-w-0">
                    <Link
                      to={`/leads/${d.lead._id}`}
                      className="block truncate text-sm font-medium underline-offset-4 hover:underline"
                    >
                      {d.lead.dealName ?? d.lead.company ?? d.lead.name}
                    </Link>
                    <p className="text-xs text-muted-foreground">
                      {d.role === "won"
                        ? `Won ${d.lead.wonAt !== undefined ? formatDateTime(d.lead.wonAt) : "(before timestamps were recorded)"}`
                        : d.role === "active"
                          ? "In progress"
                          : "Lost"}
                      {lastActivityOf(d.lead) !== undefined &&
                        ` · last activity ${timeAgo(lastActivityOf(d.lead))}`}
                    </p>
                  </div>
                  <span className="tabular text-sm font-medium">
                    {d.lead.dealValue !== undefined ? money(d.lead.dealValue) : "—"}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {/* Communications — persisted only, no fake sync (§16/§34) */}
          <h2 className="mt-6 text-sm font-semibold">Communications</h2>
          {clientMessages.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No logged communications. Email sync isn't connected — messages you send or log
              through Dealflow appear here.
            </p>
          ) : (
            <ul className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
              {clientMessages.slice(0, 12).map((m) => (
                <li key={m._id} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                  <p className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {m.direction === "received" ? client.primaryLead.name : "You"}
                    </span>
                    <span>{timeAgo(m.createdAt)}</span>
                    {m.subject && <span className="truncate">· {m.subject}</span>}
                  </p>
                  <p className="mt-1 line-clamp-2 text-sm">{m.body}</p>
                </li>
              ))}
            </ul>
          )}

          {/* Tasks — the client's follow-ups (reuse, don't duplicate) */}
          <h2 className="mt-6 text-sm font-semibold">Tasks</h2>
          {clientFollowUps.length === 0 ? (
            <p className="mt-2 text-sm text-muted-foreground">
              No tasks for this client. Schedule follow-ups from any of their deals.
            </p>
          ) : (
            <ul className="mt-2 space-y-1.5">
              {clientFollowUps.slice(0, 8).map((f) => {
                const deal = client.deals.find((d) => d.lead._id === f.leadId);
                const overdue = f.status === "pending" && f.dueAt < Date.now();
                return (
                  <li key={f._id} className="flex items-center justify-between gap-2 text-sm">
                    <Link to={`/leads/${f.leadId}`} className="min-w-0 truncate underline-offset-4 hover:underline">
                      {f.note || "Follow up"}
                      <span className="ml-1 text-xs text-muted-foreground">
                        · {deal?.lead.company ?? deal?.lead.name}
                      </span>
                    </Link>
                    <span className={cn("shrink-0 text-xs", overdue ? "text-destructive" : "text-muted-foreground")}>
                      {f.status === "pending"
                        ? overdue
                          ? `overdue ${timeAgo(f.dueAt)}`
                          : `due ${timeAgo(f.dueAt).replace(" from now", "")}`
                        : f.status}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>
    </AppShell>
  );
}
