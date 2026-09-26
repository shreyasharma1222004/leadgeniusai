import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { initials, timeAgo } from "@/lib/format";
import { statusClasses, statusLabel } from "@/lib/leadStatus";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { Mail, Phone, Search, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type Lead = Doc<"leads">;

export default function ContactsPage() {
  const leads = useQuery(api.leads.list, {});
  const [search, setSearch] = useState("");

  const filtered = useMemo(() => {
    if (!leads) return [];
    const q = search.trim().toLowerCase();
    if (!q) return leads;
    return leads.filter(
      (l: Lead) =>
        l.name.toLowerCase().includes(q) ||
        l.company?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q),
    );
  }, [leads, search]);

  if (leads === undefined) {
    return (
      <AppShell title="Contacts">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-14 animate-pulse rounded-lg bg-card" />
          ))}
        </div>
      </AppShell>
    );
  }

  return (
    <AppShell title="Contacts">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Everyone in your workspace, one clean directory — click through to the full lead page.
      </p>

      <div className="relative mb-4 max-w-md">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, company, email…"
          className="pl-9"
          aria-label="Search contacts"
        />
      </div>

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <Users className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">
            {leads.length === 0 ? "No contacts yet." : "No matches."}
          </h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {leads.length === 0
              ? "Add or import leads and they'll appear here as contacts."
              : "Try a different search term."}
          </p>
        </div>
      ) : (
        <div className="grid gap-2 md:grid-cols-2">
          {filtered.map((lead) => (
            <Link
              key={lead._id}
              to={`/leads/${lead._id}`}
              className="depth-card depth-card-hover group flex items-center gap-3 rounded-xl border border-border bg-card px-4 py-3"
            >
              <span
                aria-hidden
                className="flex size-9 shrink-0 items-center justify-center rounded-full border border-border bg-secondary text-xs font-semibold text-muted-foreground transition-colors duration-200 group-hover:border-[#191713]/40 group-hover:text-foreground"
              >
                {initials(lead.name)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{lead.name}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {lead.jobTitle ? `${lead.jobTitle} · ` : ""}
                  {lead.company ?? "—"}
                </p>
              </div>
              <div className="hidden flex-col items-end gap-0.5 sm:flex">
                {lead.email && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Mail className="size-3" /> {lead.email}
                  </span>
                )}
                {lead.phone && (
                  <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Phone className="size-3" /> {lead.phone}
                  </span>
                )}
              </div>
              <span
                className={cn(
                  "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-medium",
                  statusClasses(lead.status),
                )}
              >
                {statusLabel(lead.status)}
              </span>
              <span className="hidden w-16 text-right text-[11px] text-muted-foreground lg:block">
                {timeAgo(lead.lastContactedAt)}
              </span>
            </Link>
          ))}
        </div>
      )}
    </AppShell>
  );
}
