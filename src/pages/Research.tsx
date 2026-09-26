import { AppShell } from "@/components/AppShell";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import {
  ICP_EXAMPLES,
  PROSPECT_ARCHETYPES,
  RESEARCH_PROMPTS,
  RESEARCH_TEMPLATES,
  type ProspectArchetype,
} from "@/lib/researchTemplates";
import { cn } from "@/lib/utils";
import { useQuery } from "convex/react";
import { BookOpen, ClipboardList, Compass, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";

type Tab = "archetypes" | "icp" | "templates" | "prompts";

const TABS: { id: Tab; label: string }[] = [
  { id: "archetypes", label: "Prospect archetypes" },
  { id: "icp", label: "ICP examples" },
  { id: "templates", label: "Research templates" },
  { id: "prompts", label: "Research prompts" },
];

export default function ResearchPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const [tab, setTab] = useState<Tab>("archetypes");

  // Real industries already in the pipeline — used only to annotate which
  // archetypes overlap with the user's current book of business.
  const existingIndustries = useMemo(
    () => [...new Set((leads ?? []).map((l) => l.industry).filter((i): i is string => Boolean(i)))],
    [leads],
  );
  const industryMatches = (archetype: ProspectArchetype) =>
    archetype.industries.filter((i) => existingIndustries.includes(i)).length;

  return (
    <AppShell title="Lead Research">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Labeled research tools — buyer archetypes, ICP examples, and copy-ready
        checklists to organize real prospecting. Nothing here invents people or
        companies: research real businesses, then add verified contacts to your CRM.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex flex-wrap items-center rounded-md border border-border p-0.5">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              aria-pressed={tab === t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "cursor-pointer rounded px-3 py-1.5 text-xs font-medium transition-colors",
                tab === t.id
                  ? "bg-[#171613] text-[#f5f0e6]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "archetypes" && (
        <section aria-label="Prospect archetypes" className="grid gap-3 md:grid-cols-2">
          {PROSPECT_ARCHETYPES.map((a) => {
            const overlap = industryMatches(a);
            return (
              <div
                key={a.id}
                className="depth-card flex flex-col rounded-xl border border-border bg-card p-4"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold">{a.title}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.rolePattern}</p>
                  </div>
                  {overlap > 0 && (
                    <span className="shrink-0 rounded-full border border-[#53634a]/45 bg-[#53634a]/[0.12] px-2 py-0.5 text-[10px] font-medium text-[#42503c]">
                      {overlap} industry match{overlap === 1 ? "" : "es"}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {a.industries.map((ind) => (
                    <span
                      key={ind}
                      className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground"
                    >
                      {ind}
                    </span>
                  ))}
                </div>
                <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground">
                  <span className="font-medium text-foreground">Why they buy:</span> {a.why}
                </p>
                <div className="mt-3 rounded-lg bg-muted/50 p-3">
                  <p className="label-caps text-[10px] text-muted-foreground/80">
                    What to look for in real companies
                  </p>
                  <ul className="mt-1.5 space-y-1">
                    {a.whatToLookFor.map((look) => (
                      <li key={look} className="flex gap-1.5 text-xs leading-relaxed text-muted-foreground">
                        <span aria-hidden className="mt-[7px] size-1 shrink-0 rounded-full bg-[#6f4b5e]" />
                        {look}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            );
          })}
        </section>
      )}

      {tab === "icp" && (
        <section aria-label="ICP examples" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {ICP_EXAMPLES.map((icp) => (
            <div
              key={icp.id}
              className="depth-card flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <p className="text-sm font-semibold">{icp.segment}</p>
              <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                {icp.description}
              </p>
              <div className="mt-3">
                <p className="label-caps text-[10px] text-muted-foreground/80">Size signals</p>
                <ul className="mt-1.5 space-y-1">
                  {icp.sizeHints.map((h) => (
                    <li key={h} className="text-xs text-muted-foreground">• {h}</li>
                  ))}
                </ul>
              </div>
              <div className="mt-3">
                <p className="label-caps text-[10px] text-muted-foreground/80">Buying triggers</p>
                <ul className="mt-1.5 space-y-1">
                  {icp.buyingTriggers.map((t) => (
                    <li key={t} className="text-xs text-muted-foreground">• {t}</li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </section>
      )}

      {tab === "templates" && (
        <section aria-label="Research templates" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {RESEARCH_TEMPLATES.map((tpl) => (
            <div
              key={tpl.id}
              className="depth-card flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <ClipboardList className="size-4 text-[#82552e]" />
                <p className="text-sm font-semibold">{tpl.title}</p>
              </div>
              <ol className="mt-3 flex-1 list-decimal space-y-2 pl-4 text-xs leading-relaxed text-muted-foreground">
                {tpl.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </div>
          ))}
        </section>
      )}

      {tab === "prompts" && (
        <section aria-label="Research prompts" className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {RESEARCH_PROMPTS.map((p) => (
            <div
              key={p.id}
              className="depth-card flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-center gap-2">
                <BookOpen className="size-4 text-[#82552e]" />
                <p className="text-sm font-semibold">{p.title}</p>
              </div>
              <p className="mt-3 flex-1 whitespace-pre-wrap rounded-lg bg-muted/50 p-3 font-mono text-[12px] leading-relaxed text-foreground/90">
                {p.prompt}
              </p>
              <p className="mt-2 text-xs text-muted-foreground">
                <span className="font-medium text-foreground">Use for:</span> {p.useFor}
              </p>
            </div>
          ))}
        </section>
      )}

      {!leads ? (
        <div className="mt-4">
          <Skeleton className="h-16 rounded-lg" />
        </div>
      ) : (
        <div className="mt-4 rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
          <p className="flex items-center gap-1.5 font-medium text-foreground">
            <Target className="size-3.5" /> How research works in Dealflow AI
          </p>
          <p className="mt-1.5">
            Archetypes and ICP examples are patterns to aim your research at — not people or
            companies, and not the output of a data provider. External prospect discovery is not
            connected: find real companies yourself (directories, associations, event lists), verify
            them, then{" "}
            <Link to="/leads" className="underline underline-offset-2 hover:text-foreground">
              add leads with the details you confirmed
            </Link>
            . The industry-match badges above come from leads already in your CRM.
          </p>
          <p className="mt-2 flex items-center gap-1.5 text-muted-foreground/80">
            <Compass className="size-3" /> Tip: the “Qualify before first contact” template is the
            fastest filter before spending time on outreach.
          </p>
        </div>
      )}
    </AppShell>
  );
}
