import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import { analyzeLead } from "@/lib/leads-client";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import {
  AlertTriangle,
  Loader2,
  Plus,
  Sparkles,
  UserRoundPlus,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

const STAGES = [
  "Reading lead…",
  "Finding relevant context…",
  "Estimating pain points…",
  "Ready.",
];

const FIELD_CLASSES: Record<string, string> = {
  name: "Full name",
  jobTitle: "Job title",
  company: "Company",
  email: "Email",
  phone: "Phone",
  website: "Website",
  industry: "Industry",
  location: "Location",
  linkedin: "LinkedIn",
  notes: "Notes",
};

type FormState = {
  name: string;
  jobTitle: string;
  company: string;
  email: string;
  phone: string;
  website: string;
  industry: string;
  location: string;
  linkedin: string;
  notes: string;
};

const EMPTY_FORM: FormState = {
  name: "",
  jobTitle: "",
  company: "",
  email: "",
  phone: "",
  website: "",
  industry: "",
  location: "",
  linkedin: "",
  notes: "",
};

interface AnalysisResult {
  summary: string;
  industry: string;
  painPoints: string[];
  signals: string[];
  approach: string;
  score: number;
  scoreBreakdown: { label: string; value: number }[];
  provider: "openai" | "heuristic";
}

export function AddLeadDialog({
  triggerLabel = "Add lead",
  variant = "default",
  className,
}: {
  triggerLabel?: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [analyze, setAnalyze] = useState(true);
  const [stage, setStage] = useState(-1);
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const timers = useRef<number[]>([]);

  const createLead = useMutation(api.leads.create);
  const saveAnalysis = useMutation(api.leads.saveAnalysis);

  const set = (key: keyof FormState) => (
    event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>,
  ) => setForm((f) => ({ ...f, [key]: event.target.value }));

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const reset = () => {
    setForm(EMPTY_FORM);
    setAnalysis(null);
    setStage(-1);
    setError(null);
    setAnalyze(true);
    setSaving(false);
  };

  const runAnalysis = async () => {
    if (!form.name.trim()) {
      setError("Add a name first — the AI needs someone to research.");
      return;
    }
    setError(null);
    setAnalysis(null);
    setStage(0);
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = STAGES.slice(0, 3).map((_, i) =>
      window.setTimeout(() => setStage(i + 1), 450 * (i + 1)),
    );
    try {
      const result = await analyzeLead({
        name: form.name,
        jobTitle: form.jobTitle,
        company: form.company,
        website: form.website,
        industry: form.industry,
        location: form.location,
        notes: form.notes,
      });
      // make sure the last stage has shown for a beat
      await new Promise((r) => setTimeout(r, 350));
      setAnalysis(result);
      setStage(STAGES.length - 1);
    } catch {
      setStage(-1);
      setError("Something went wrong while analyzing this lead. Try again.");
    }
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const id = await createLead({
        name: form.name.trim(),
        jobTitle: form.jobTitle.trim() || undefined,
        company: form.company.trim() || undefined,
        email: form.email.trim() || undefined,
        phone: form.phone.trim() || undefined,
        website: form.website.trim() || undefined,
        industry: form.industry.trim() || undefined,
        location: form.location.trim() || undefined,
        linkedin: form.linkedin.trim() || undefined,
        notes: form.notes.trim() || undefined,
        source: "Manual entry",
      });
      let finalAnalysis = analysis;
      if (analyze && !finalAnalysis) {
        finalAnalysis = await analyzeLead({
          name: form.name,
          jobTitle: form.jobTitle,
          company: form.company,
          website: form.website,
          industry: form.industry,
          location: form.location,
          notes: form.notes,
        });
      }
      if (finalAnalysis) {
        await saveAnalysis({
          id,
          score: finalAnalysis.score,
          summary: finalAnalysis.summary,
          painPoints: finalAnalysis.painPoints,
          signals: finalAnalysis.signals,
          approach: finalAnalysis.approach,
          industry: finalAnalysis.industry || undefined,
          scoreBreakdown: finalAnalysis.scoreBreakdown,
        });
      }
      toast(`Lead added: ${form.name.trim()}`, {
        description: finalAnalysis
          ? `AI analysis attached (score ${finalAnalysis.score}/100).`
          : "Add notes and analyze it any time from the lead page.",
      });
      reset();
      setOpen(false);
    } catch (err) {
      setError(
        err instanceof Error && err.message === "You need to sign in to do that."
          ? "Your session expired — sign in again and retry."
          : "We couldn't save this lead. Check your connection and try again.",
      );
      setSaving(false);
    }
  };

  const busy = stage >= 0 && stage < STAGES.length - 1;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant={variant} className={className}>
          <UserRoundPlus className="size-4" />
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Add lead</DialogTitle>
          <DialogDescription>
            Fields marked required only require a name — everything else sharpens
            the analysis.
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="lead-name">Full name *</Label>
            <Input
              id="lead-name"
              value={form.name}
              onChange={set("name")}
              placeholder="Sarah Mitchell"
              required
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-title">Job title</Label>
            <Input
              id="lead-title"
              value={form.jobTitle}
              onChange={set("jobTitle")}
              placeholder="Founder"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-company">Company</Label>
            <Input
              id="lead-company"
              value={form.company}
              onChange={set("company")}
              placeholder="Nova Studio"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-email">Email</Label>
            <Input
              id="lead-email"
              type="email"
              value={form.email}
              onChange={set("email")}
              placeholder="sarah@novastudio.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-phone">Phone</Label>
            <Input
              id="lead-phone"
              type="tel"
              value={form.phone}
              onChange={set("phone")}
              placeholder="+1 555 010 2030"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-website">Website</Label>
            <Input
              id="lead-website"
              value={form.website}
              onChange={set("website")}
              placeholder="novastudio.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-industry">Industry</Label>
            <Input
              id="lead-industry"
              value={form.industry}
              onChange={set("industry")}
              placeholder="Design"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-location">Location</Label>
            <Input
              id="lead-location"
              value={form.location}
              onChange={set("location")}
              placeholder="Austin, TX"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="lead-linkedin">LinkedIn</Label>
            <Input
              id="lead-linkedin"
              value={form.linkedin}
              onChange={set("linkedin")}
              placeholder="linkedin.com/in/…"
            />
          </div>
          <div className="grid gap-1.5 sm:col-span-2">
            <Label htmlFor="lead-notes">Notes</Label>
            <Textarea
              id="lead-notes"
              value={form.notes}
              onChange={set("notes")}
              placeholder="Met at a meetup — interested in redesigning their site this quarter."
              rows={3}
            />
          </div>
        </div>

        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          <Checkbox
            checked={analyze}
            onCheckedChange={(v) => setAnalyze(v === true)}
          />
          Analyze with AI after saving
        </label>

        {stage >= 0 && (
          <div
            aria-live="polite"
            className="rounded-md border border-border bg-muted/50 px-4 py-3"
          >
            <ul className="space-y-1.5 text-xs">
              {STAGES.map((label, i) => (
                <li
                  key={label}
                  className={cn(
                    "flex items-center gap-2 transition-colors",
                    i <= stage ? "text-foreground" : "text-muted-foreground/50",
                  )}
                >
                  {i < stage || (i === stage && !busy) ? (
                    <span className="size-1.5 rounded-full bg-[#8B5CF6]" />
                  ) : i === stage ? (
                    <Loader2 className="size-3 animate-spin text-muted-foreground" />
                  ) : (
                    <span className="size-1.5 rounded-full bg-border" />
                  )}
                  {label}
                </li>
              ))}
            </ul>
          </div>
        )}

        {analysis && (
          <div className="rounded-md border border-border p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="flex items-center gap-1.5 text-xs font-medium">
                <Sparkles className="size-3.5 text-foreground" />
                AI analysis ready
              </p>
              <span className="tabular text-xs text-muted-foreground">
                {analysis.provider === "openai"
                  ? "GPT research brief"
                  : "Estimate from entered data"}
              </span>
            </div>
            <div className="mt-3 flex items-baseline gap-2">
              <span className="tabular text-3xl font-semibold tracking-tight">
                {analysis.score}
              </span>
              <span className="text-xs text-muted-foreground">/ 100 lead score</span>
            </div>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {analysis.summary}
            </p>
            {analysis.painPoints.length > 0 && (
              <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                {analysis.painPoints.map((p) => (
                  <li key={p} className="flex gap-2">
                    <span className="mt-1.5 size-1 shrink-0 rounded-full bg-foreground/40" />
                    {p}
                  </li>
                ))}
              </ul>
            )}
            {analysis.provider === "heuristic" && (
              <p className="mt-3 text-[11px] leading-relaxed text-muted-foreground/80">
                Generated from the details you entered — no external data was
                fetched. Verify before outreach.
              </p>
            )}
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <div>
              {error}
              {stage >= 0 && (
                <button
                  type="button"
                  onClick={runAnalysis}
                  className="ml-1 underline underline-offset-2"
                >
                  Try again
                </button>
              )}
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex w-full flex-col gap-2 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              className="flex-1"
              onClick={runAnalysis}
              disabled={busy || !form.name.trim()}
            >
              {busy ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Sparkles className="size-4" />
              )}
              {analysis ? "Re-analyze with AI" : "Analyze with AI"}
            </Button>
            <Button
              type="button"
              className="flex-1"
              onClick={handleSave}
              disabled={saving || !form.name.trim()}
            >
              {saving ? (
                <>
                  <Loader2 className="size-4 animate-spin" />
                  Saving…
                </>
              ) : (
                <>
                  <Plus className="size-4" />
                  {analysis ? "Save lead + analysis" : "Save lead"}
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export { FIELD_CLASSES };
