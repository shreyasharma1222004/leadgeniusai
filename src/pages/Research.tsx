import { AddLeadDialog } from "@/components/AddLeadDialog";
import { AppShell } from "@/components/AppShell";
import { AIButton } from "@/components/spatial";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { generateProspectSuggestions } from "@/lib/leads-client";
import { useQuery } from "convex/react";
import { ExternalLink, MapPin, RefreshCw, Search, Sparkles, Target } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

interface Suggestion {
  name: string;
  jobTitle: string;
  company: string;
  industry: string;
  location: string;
  why: string;
}

export default function ResearchPage() {
  useAuth();
  const leads = useQuery(api.leads.list, {});
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [industryFilter, setIndustryFilter] = useState<string>("");

  const existingIndustries = useMemo(
    () => (leads ?? []).map((l) => l.industry).filter((i): i is string => Boolean(i)),
    [leads],
  );

  const filtered = (suggestions ?? []).filter(
    (s) => !industryFilter || s.industry === industryFilter,
  );

  const generate = () => {
    setSuggestions(generateProspectSuggestions(existingIndustries, 6));
    toast("Generated 6 prospect archetypes to verify");
  };

  return (
    <AppShell title="Lead Research">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Prospect archetypes tailored to your pipeline — verify them, research the real company, then
        add the one that fits.
      </p>

      {!leads ? (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2">
            <AIButton onClick={generate} disabled={!leads} className="h-9">
              {suggestions ? "Regenerate suggestions" : "Find prospects"}
            </AIButton>
            {suggestions && (
              <div className="flex items-center rounded-md border border-border p-0.5">
                <button
                  type="button"
                  aria-pressed={industryFilter === ""}
                  onClick={() => setIndustryFilter("")}
                  className={
                    "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium transition-colors " +
                    (industryFilter === ""
                      ? "bg-[#171613] text-[#f5f0e6]"
                      : "text-muted-foreground hover:text-foreground")
                  }
                >
                  All
                </button>
                {[...new Set(suggestions.map((s) => s.industry))].map((ind) => (
                  <button
                    key={ind}
                    type="button"
                    aria-pressed={industryFilter === ind}
                    onClick={() => setIndustryFilter(ind)}
                    className={
                      "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium transition-colors " +
                      (industryFilter === ind
                        ? "bg-[#171613] text-[#f5f0e6]"
                        : "text-muted-foreground hover:text-foreground")
                    }
                  >
                    {ind}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!suggestions ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
              <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
                <Search className="size-5" />
              </div>
              <h2 className="mt-4 text-lg font-semibold tracking-tight">
                Find your next 6 prospects.
              </h2>
              <p className="mt-1 max-w-md text-sm text-muted-foreground">
                Dealflow AI suggests prospect archetypes weighted toward your existing pipeline
                industries. They're starting points — verify the company, find the real contact, and
                add them in one click.
              </p>
              <Button className="mt-5" onClick={generate}>
                <Sparkles className="size-4" /> Generate suggestions
              </Button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground">
              No suggestions in this industry — try another or regenerate.
            </div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((s, i) => (
                <div
                  key={`${s.name}-${i}`}
                  className="depth-card depth-card-hover flex flex-col rounded-xl border border-border bg-card p-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{s.name}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {s.jobTitle} · {s.company}
                      </p>
                    </div>
                    <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                      {s.industry}
                    </span>
                  </div>
                  <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                    <MapPin className="size-3" /> {s.location}
                  </p>
                  <p className="mt-2 flex-1 text-[13px] leading-relaxed text-muted-foreground">
                    <span className="font-medium text-foreground">Why:</span> {s.why}
                  </p>
                  <div className="mt-3 flex items-center gap-2">
                    <AddLeadDialog
                      triggerLabel="Add as lead"
                      variant="outline"
                      className="h-8 flex-1 text-xs"
                    />
                    <a
                      href={`https://www.google.com/search?q=${encodeURIComponent(`${s.company} ${s.location}`)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex h-8 items-center gap-1 rounded-md border border-border px-2.5 text-xs text-muted-foreground transition-colors hover:border-[#b3a894] hover:text-foreground"
                    >
                      <ExternalLink className="size-3" /> Verify
                    </a>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
            <p className="flex items-center gap-1.5 font-medium text-foreground">
              <Target className="size-3.5" /> How suggestions work
            </p>
            <p className="mt-1.5">
              Suggestions are archetype-based starting points derived from your pipeline's industries
              — not scraped personal data. Dealflow AI never fabricates facts about real companies:
              verify externally, then add the lead with the details you confirm.
            </p>
          </div>
        </>
      )}
    </AppShell>
  );
}
