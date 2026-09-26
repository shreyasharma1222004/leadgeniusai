import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation } from "convex/react";
import { ArrowRight, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const GOALS = [
  { value: "find-customers", label: "Find more customers" },
  { value: "increase-sales", label: "Increase sales" },
  { value: "improve-conversion", label: "Improve conversion" },
  { value: "manage-clients", label: "Manage clients" },
  { value: "build-brand", label: "Build my brand" },
  { value: "improve-operations", label: "Improve operations" },
] as const;

const BUSINESS_TYPES = [
  "Freelancer",
  "Consultant",
  "Agency",
  "Startup",
  "Creator",
  "Small business",
  "Sales professional",
  "Other",
] as const;

const TEAM_SIZES = ["Just me", "2–5", "6–20", "20+"] as const;

/**
 * Post-signup business onboarding (§51): what you do, what you sell, who you
 * sell to, growth goal, revenue goal, team size. Answers personalize the
 * dashboard and Copilot context. Shown once; skippable.
 */
export function OnboardingDialog() {
  const { user } = useAuth();
  const updateBusiness = useMutation(api.users.updateBusinessProfile);
  const open = Boolean(user && user.onboardedAt === undefined);

  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);

  const [businessType, setBusinessType] = useState("");
  const [sells, setSells] = useState("");
  const [audience, setAudience] = useState("");
  const [growthGoal, setGrowthGoal] = useState("");
  const [revenueGoal, setRevenueGoal] = useState("");
  const [teamSize, setTeamSize] = useState("");

  if (!open) return null;

  const finish = async () => {
    setSaving(true);
    try {
      await updateBusiness({
        businessType: businessType || undefined,
        sells: sells.trim() || undefined,
        audience: audience.trim() || undefined,
        growthGoal: growthGoal || undefined,
        revenueGoal: revenueGoal ? Number(revenueGoal.replace(/[^0-9.]/g, "")) || undefined : undefined,
        teamSize: teamSize || undefined,
        onboarded: true,
      });
      toast("You're set — welcome to Dealflow AI.");
      setStep(0);
    } catch {
      toast.error("Couldn't save your answers — you can update them later in Settings.");
      setSaving(false);
    }
  };

  const steps = [
    // Step 0 — what do you do?
    <div key="type" className="grid gap-3">
      <Label>What do you do?</Label>
      <div className="flex flex-wrap gap-2">
        {BUSINESS_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            aria-pressed={businessType === t}
            onClick={() => setBusinessType(t)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              businessType === t
                ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                : "border-border bg-card text-muted-foreground hover:border-[#b3a894] hover:text-foreground",
            )}
          >
            {t}
          </button>
        ))}
      </div>
    </div>,

    // Step 1 — what do you sell?
    <div key="sells" className="grid gap-1.5">
      <Label htmlFor="ob-sells">What do you sell?</Label>
      <Input
        id="ob-sells"
        value={sells}
        onChange={(e) => setSells(e.target.value)}
        placeholder="Brand and web design for B2B SaaS…"
        autoFocus
      />
      <p className="text-xs text-muted-foreground">
        One line is enough — it shapes the outreach angles the AI suggests.
      </p>
    </div>,

    // Step 2 — who do you sell to?
    <div key="audience" className="grid gap-1.5">
      <Label htmlFor="ob-audience">Who do you sell to?</Label>
      <Input
        id="ob-audience"
        value={audience}
        onChange={(e) => setAudience(e.target.value)}
        placeholder="Seed-stage SaaS founders in North America"
        autoFocus
      />
    </div>,

    // Step 3 — primary growth goal
    <div key="goal" className="grid gap-3">
      <Label>What's your primary growth goal right now?</Label>
      <div className="grid gap-2 sm:grid-cols-2">
        {GOALS.map((g) => (
          <button
            key={g.value}
            type="button"
            aria-pressed={growthGoal === g.value}
            onClick={() => setGrowthGoal(g.value)}
            className={cn(
              "cursor-pointer rounded-lg border px-3 py-2.5 text-left text-sm transition-colors",
              growthGoal === g.value
                ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                : "border-border bg-card hover:border-[#b3a894]",
            )}
          >
            {g.label}
          </button>
        ))}
      </div>
    </div>,

    // Step 4 — revenue goal (optional) + team size
    <div key="numbers" className="grid gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="ob-revenue">Approximate monthly revenue goal (optional)</Label>
        <Input
          id="ob-revenue"
          value={revenueGoal}
          onChange={(e) => setRevenueGoal(e.target.value)}
          placeholder="10,000"
          inputMode="numeric"
        />
      </div>
      <div className="grid gap-3">
        <Label>How large is your team?</Label>
        <div className="flex flex-wrap gap-2">
          {TEAM_SIZES.map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={teamSize === t}
              onClick={() => setTeamSize(t)}
              className={cn(
                "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                teamSize === t
                  ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                  : "border-border bg-card text-muted-foreground hover:border-[#b3a894] hover:text-foreground",
              )}
            >
              {t}
            </button>
          ))}
        </div>
      </div>
    </div>,
  ];

  const titles = [
    "Set up your business",
    "Set up your business",
    "Set up your business",
    "Set up your business",
    "Set up your business",
  ];
  const descriptions = [
    "Six quick answers personalize your dashboard and the AI Copilot.",
    `Step 2 of 5 — what you sell.`,
    `Step 3 of 5 — your audience.`,
    `Step 4 of 5 — your goal.`,
    `Step 5 of 5 — the numbers.`,
  ];

  return (
    <Dialog open={open} onOpenChange={() => { /* no cancel — but backdrop dismiss allowed, reappears next visit until finished */ }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{titles[step]}</DialogTitle>
          <DialogDescription>{descriptions[step]}</DialogDescription>
        </DialogHeader>

        {steps[step]}

        <DialogFooter className="gap-2 sm:gap-0">
          <div className="flex w-full flex-col gap-2 sm:flex-row sm:justify-between">
            <Button
              type="button"
              variant="ghost"
              onClick={finish}
              disabled={saving}
              className="text-muted-foreground"
            >
              Skip for now
            </Button>
            <Button
              type="button"
              onClick={() => (step < steps.length - 1 ? setStep(step + 1) : void finish())}
              disabled={saving}
            >
              {saving ? (
                <Loader2 className="size-4 animate-spin" />
              ) : step < steps.length - 1 ? (
                <>
                  Continue <ArrowRight className="size-4" />
                </>
              ) : (
                "Start growing"
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
