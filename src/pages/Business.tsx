import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { api } from "@/convex/_generated/api";
import type { Doc, Id } from "@/convex/_generated/dataModel";
import { useAuth } from "@/hooks/use-auth";
import {
  GOAL_KINDS,
  GOAL_KIND_LABELS,
  GOAL_PERIODS,
  GOAL_PERIOD_LABELS,
  goalUnit,
  type GoalKind,
  type GoalPeriod,
} from "@/lib/goalEngine";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  Building2,
  Check,
  Loader2,
  Pencil,
  Plus,
  Target,
  Trash2,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Profile = NonNullable<Doc<"businessProfiles">>;
type GoalRow = Awaited<ReturnType<typeof useGoalsData>[number]>;

function useGoalsData() {
  return useQuery(api.business.goalsWithProgress) ?? [];
}

const CHANNELS = [
  "Referrals",
  "Cold email",
  "LinkedIn outreach",
  "Content / SEO",
  "Paid ads",
  "Events / networking",
  "Partnerships",
  "Inbound / website",
];

const BUSINESS_MODELS = [
  "Services",
  "Productized service",
  "SaaS / subscription",
  "E-commerce",
  "Marketplace",
  "Other",
];

const SALES_CYCLES = ["< 1 week", "1–4 weeks", "1–3 months", "3–6 months", "6+ months"];

function moneyFmt(n: number): string {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  if (Math.abs(n) >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${n.toLocaleString()}`;
}

export default function BusinessPage() {
  useAuth();
  const profile = useQuery(api.business.myProfile);
  const goals = useQuery(api.business.goalsWithProgress);
  const saveProfile = useMutation(api.business.saveProfile);
  const createGoal = useMutation(api.business.createGoal);
  const updateGoal = useMutation(api.business.updateGoal);
  const deleteGoal = useMutation(api.business.deleteGoal);
  const setManual = useMutation(api.business.setManualCurrentValue);

  const [editing, setEditing] = useState(false);
  const [goalDialog, setGoalDialog] = useState<
    | { mode: "create" }
    | {
        mode: "edit";
        goal: {
          _id: Id<"businessGoals">;
          name: string;
          kind: string;
          period: string;
          targetValue?: number;
          deadline?: number;
          status: string;
        };
      }
    | null
  >(null);
  const [confirmDelete, setConfirmDelete] = useState<Id<"businessGoals"> | null>(null);

  const save = async (form: ProfileFormValues) => {
    const num = (s: string) =>
      s.trim() ? Number(s.replace(/[^0-9.]/g, "")) || undefined : undefined;
    await saveProfile({
      businessName: form.businessName.trim(),
      website: form.website.trim() || undefined,
      industry: form.industry.trim() || undefined,
      businessType: form.businessType || undefined,
      businessModel: form.businessModel || undefined,
      products: form.products.trim() || undefined,
      description: form.description.trim() || undefined,
      targetGeography: form.targetGeography.trim() || undefined,
      currency: form.currency.trim() || undefined,
      teamSize: form.teamSize || undefined,
      currentMonthlyRevenue: num(form.currentMonthlyRevenue),
      targetMonthlyRevenue: num(form.targetMonthlyRevenue),
      acquisitionChannels: form.acquisitionChannels.length ? form.acquisitionChannels : undefined,
      avgSalesCycle: form.avgSalesCycle || undefined,
      primaryChallenge: form.primaryChallenge.trim() || undefined,
    });
  };

  return (
    <AppShell title="Business">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Your business context — the dashboard, AI brief, and Copilot use this to tailor every
        recommendation to what you actually sell and who you sell to.
      </p>

      {profile === undefined || goals === undefined ? (
        <div className="grid gap-3 md:grid-cols-2">
          <Skeleton className="h-64 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : (
        <div className="space-y-10">
          {/* ── Profile ──────────────────────────────────────────────────── */}
          <section>
            <div className="flex items-center justify-between">
              <div>
                <p className="label-caps text-muted-foreground">Business profile</p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Private to you. All fields optional except the name.
                </p>
              </div>
              {!editing && (
                <Button variant="outline" size="sm" className="h-8" onClick={() => setEditing(true)}>
                  <Pencil className="size-3.5" /> {profile ? "Edit" : "Set up profile"}
                </Button>
              )}
            </div>

            {editing ? (
              <ProfileForm
                initial={profile}
                onCancel={() => setEditing(false)}
                onSave={async (values) => {
                  try {
                    await save(values);
                    toast("Business profile saved.");
                    setEditing(false);
                  } catch (err) {
                    toast.error(err instanceof Error ? err.message : "Couldn't save the profile.");
                  }
                }}
              />
            ) : profile ? (
              <ProfileView profile={profile} />
            ) : (
              <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
                <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary">
                  <Building2 className="size-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold tracking-tight">
                  Tell Dealflow about your business.
                </h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Industry, target market, and challenges shape your dashboard priorities, the AI
                  brief, and Copilot answers. Revenue fields are optional — nothing sensitive is
                  required.
                </p>
                <Button className="mt-5" onClick={() => setEditing(true)}>
                  <Plus className="size-4" /> Set up profile
                </Button>
              </div>
            )}
          </section>

          {/* ── Goals ────────────────────────────────────────────────────── */}
          <section className="border-t border-border pt-8">
            <div className="flex items-center justify-between">
              <div>
                <p className="label-caps text-muted-foreground">Goals</p>
                <p className="mt-0.5 text-xs text-muted-foreground/60">
                  Progress is computed live from your CRM — current values can't be faked.
                </p>
              </div>
              <Button size="sm" className="h-8" onClick={() => setGoalDialog({ mode: "create" })}>
                <Plus className="size-3.5" /> New goal
              </Button>
            </div>

            {goals.length === 0 ? (
              <div className="mt-3 flex flex-col items-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-12 text-center">
                <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary">
                  <Target className="size-5" />
                </div>
                <h2 className="mt-4 text-lg font-semibold tracking-tight">No goals yet.</h2>
                <p className="mt-1 max-w-md text-sm text-muted-foreground">
                  Set a revenue, qualified-leads, or meetings goal and the dashboard tracks real
                  progress against it automatically.
                </p>
                <Button className="mt-5" onClick={() => setGoalDialog({ mode: "create" })}>
                  <Plus className="size-4" /> Create your first goal
                </Button>
              </div>
            ) : (
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {goals.map((g) => (
                  <GoalCard
                    key={g._id}
                    goal={g}
                    onEdit={() => setGoalDialog({ mode: "edit", goal: g })}
                    onDelete={() => setConfirmDelete(g._id)}
                    onSetManual={async (value) => {
                      try {
                        await setManual({ id: g._id, value });
                        toast("Manual value saved.");
                      } catch (err) {
                        toast.error(err instanceof Error ? err.message : "Couldn't save.");
                      }
                    }}
                  />
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      <GoalDialog
        state={goalDialog}
        onClose={() => setGoalDialog(null)}
        onCreate={async (fields) => {
          try {
            await createGoal(fields);
            toast("Goal created.");
            setGoalDialog(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't create the goal.");
          }
        }}
        onUpdate={async (id, fields) => {
          try {
            await updateGoal({ id, ...fields });
            toast("Goal updated.");
            setGoalDialog(null);
          } catch (err) {
            toast.error(err instanceof Error ? err.message : "Couldn't update the goal.");
          }
        }}
      />

      {/* Delete confirm — consequential action requires explicit confirmation */}
      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete this goal?</DialogTitle>
            <DialogDescription>
              The goal and its tracked progress are removed. Your CRM data is untouched.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (!confirmDelete) return;
                await deleteGoal({ id: confirmDelete });
                toast("Goal deleted.");
                setConfirmDelete(null);
              }}
            >
              Delete goal
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}

// ── Profile display ──────────────────────────────────────────────────────────

function ProfileView({ profile }: { profile: Profile }) {
  const rows = [
    { label: "Industry", value: profile.industry },
    { label: "Business type", value: profile.businessType },
    { label: "Model", value: profile.businessModel },
    { label: "What you sell", value: profile.products },
    { label: "Target market", value: profile.targetGeography },
    { label: "Team size", value: profile.teamSize },
    { label: "Sales cycle", value: profile.avgSalesCycle },
    { label: "Primary challenge", value: profile.primaryChallenge },
    { label: "Channels", value: (profile.acquisitionChannels ?? []).join(", ") || undefined },
    {
      label: "Revenue focus",
      value:
        profile.targetMonthlyRevenue !== undefined
          ? `${moneyFmt(profile.targetMonthlyRevenue)} / month target`
          : undefined,
    },
  ].filter((r): r is { label: string; value: string } => Boolean(r.value));

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-base font-semibold tracking-tight">{profile.businessName}</p>
          {profile.website && (
            <a
              href={profile.website.startsWith("http") ? profile.website : `https://${profile.website}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {profile.website}
            </a>
          )}
        </div>
        {profile.currency && (
          <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
            {profile.currency}
          </span>
        )}
      </div>
      {profile.description && (
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{profile.description}</p>
      )}
      {rows.length > 0 ? (
        <dl className="mt-4 grid gap-x-8 gap-y-3 border-t border-border pt-4 sm:grid-cols-2">
          {rows.map((r) => (
            <div key={r.label}>
              <dt className="label-caps text-[10px] text-muted-foreground/70">{r.label}</dt>
              <dd className="mt-0.5 text-sm">{r.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="mt-3 text-xs text-muted-foreground/60">
          Add details like industry and target market so recommendations can use them.
        </p>
      )}
    </div>
  );
}

// ── Profile edit form (state kept local, remounted on edit) ─────────────────

export interface ProfileFormValues {
  businessName: string;
  website: string;
  industry: string;
  businessType: string;
  businessModel: string;
  products: string;
  description: string;
  targetGeography: string;
  currency: string;
  teamSize: string;
  currentMonthlyRevenue: string;
  targetMonthlyRevenue: string;
  acquisitionChannels: string[];
  avgSalesCycle: string;
  primaryChallenge: string;
}

function ProfileForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: Profile | null;
  onSave: (values: ProfileFormValues) => Promise<void>;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<ProfileFormValues>({
    businessName: initial?.businessName ?? "",
    website: initial?.website ?? "",
    industry: initial?.industry ?? "",
    businessType: initial?.businessType ?? "",
    businessModel: initial?.businessModel ?? "",
    products: initial?.products ?? "",
    description: initial?.description ?? "",
    targetGeography: initial?.targetGeography ?? "",
    currency: initial?.currency ?? "USD",
    teamSize: initial?.teamSize ?? "",
    currentMonthlyRevenue: initial?.currentMonthlyRevenue?.toString() ?? "",
    targetMonthlyRevenue: initial?.targetMonthlyRevenue?.toString() ?? "",
    acquisitionChannels: initial?.acquisitionChannels ?? [],
    avgSalesCycle: initial?.avgSalesCycle ?? "",
    primaryChallenge: initial?.primaryChallenge ?? "",
  });
  const [saving, setSaving] = useState(false);

  const set = (patch: Partial<ProfileFormValues>) => setForm((f) => ({ ...f, ...patch }));

  const toggle = (field: "acquisitionChannels", value: string) =>
    setForm((f) => ({
      ...f,
      [field]: f[field].includes(value)
        ? f[field].filter((x) => x !== value)
        : [...f[field], value],
    }));

  return (
    <div className="mt-3 rounded-xl border border-border bg-card p-5">
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="bp-name">Business name *</Label>
          <Input
            id="bp-name"
            value={form.businessName}
            onChange={(e) => set({ businessName: e.target.value })}
            placeholder="Nova Studio"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="bp-website">Website</Label>
            <Input
              id="bp-website"
              value={form.website}
              onChange={(e) => set({ website: e.target.value })}
              placeholder="novastudio.com"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-industry">Industry</Label>
            <Input
              id="bp-industry"
              value={form.industry}
              onChange={(e) => set({ industry: e.target.value })}
              placeholder="Design, SaaS, Consulting…"
            />
          </div>
        </div>
        <ChipRow
          label="Business model"
          options={BUSINESS_MODELS}
          selected={form.businessModel}
          onToggle={(v) => set({ businessModel: form.businessModel === v ? "" : v })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="bp-products">Products / services</Label>
          <Input
            id="bp-products"
            value={form.products}
            onChange={(e) => set({ products: e.target.value })}
            placeholder="Brand design, web development, CRO audits…"
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="bp-desc">Short description</Label>
          <Textarea
            id="bp-desc"
            value={form.description}
            onChange={(e) => set({ description: e.target.value })}
            rows={2}
            placeholder="Independent design practice for B2B SaaS companies…"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="bp-geo">Target geography</Label>
            <Input
              id="bp-geo"
              value={form.targetGeography}
              onChange={(e) => set({ targetGeography: e.target.value })}
              placeholder="North America"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-currency">Currency</Label>
            <Input
              id="bp-currency"
              value={form.currency}
              onChange={(e) => set({ currency: e.target.value.toUpperCase().slice(0, 3) })}
              placeholder="USD"
            />
          </div>
        </div>
        <ChipRow
          label="Team size"
          options={["Just me", "2–5", "6–20", "20+"]}
          selected={form.teamSize}
          onToggle={(v) => set({ teamSize: form.teamSize === v ? "" : v })}
        />
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="bp-cur">Current monthly revenue (optional)</Label>
            <Input
              id="bp-cur"
              value={form.currentMonthlyRevenue}
              onChange={(e) => set({ currentMonthlyRevenue: e.target.value })}
              inputMode="numeric"
              placeholder="8,000"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="bp-tgt">Target monthly revenue (optional)</Label>
            <Input
              id="bp-tgt"
              value={form.targetMonthlyRevenue}
              onChange={(e) => set({ targetMonthlyRevenue: e.target.value })}
              inputMode="numeric"
              placeholder="15,000"
            />
          </div>
        </div>
        <div className="grid gap-1.5">
          <Label>Primary acquisition channels</Label>
          <div className="flex flex-wrap gap-2">
            {CHANNELS.map((c) => (
              <button
                key={c}
                type="button"
                aria-pressed={form.acquisitionChannels.includes(c)}
                onClick={() => toggle("acquisitionChannels", c)}
                className={cn(
                  "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                  form.acquisitionChannels.includes(c)
                    ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                    : "border-border bg-card text-muted-foreground hover:border-[#b3a894] hover:text-foreground",
                )}
              >
                {c}
              </button>
            ))}
          </div>
        </div>
        <ChipRow
          label="Average sales cycle"
          options={SALES_CYCLES}
          selected={form.avgSalesCycle}
          onToggle={(v) => set({ avgSalesCycle: form.avgSalesCycle === v ? "" : v })}
        />
        <div className="grid gap-1.5">
          <Label htmlFor="bp-challenge">Primary business challenge</Label>
          <Input
            id="bp-challenge"
            value={form.primaryChallenge}
            onChange={(e) => set({ primaryChallenge: e.target.value })}
            placeholder="Inconsistent pipeline between referral bursts"
          />
        </div>
      </div>
      <div className="mt-5 flex justify-end gap-2 border-t border-border pt-4">
        <Button variant="outline" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        <Button
          onClick={async () => {
            if (!form.businessName.trim()) {
              toast.error("Business name is required.");
              return;
            }
            setSaving(true);
            await onSave(form);
            setSaving(false);
          }}
          disabled={saving || !form.businessName.trim()}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
          Save profile
        </Button>
      </div>
    </div>
  );
}

function ChipRow({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: readonly string[];
  selected: string;
  onToggle: (value: string) => void;
}) {
  return (
    <div className="grid gap-1.5">
      <Label>{label}</Label>
      <div className="flex flex-wrap gap-2">
        {options.map((o) => (
          <button
            key={o}
            type="button"
            aria-pressed={selected === o}
            onClick={() => onToggle(o)}
            className={cn(
              "cursor-pointer rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
              selected === o
                ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                : "border-border bg-card text-muted-foreground hover:border-[#b3a894] hover:text-foreground",
            )}
          >
            {o}
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Goal card ────────────────────────────────────────────────────────────────

function GoalCard({
  goal,
  onEdit,
  onDelete,
  onSetManual,
}: {
  goal: GoalRow;
  onEdit: () => void;
  onDelete: () => void;
  onSetManual: (value: number | undefined) => Promise<void>;
}) {
  const [manualOpen, setManualOpen] = useState(false);
  const [manualVal, setManualVal] = useState("");
  const manualAllowed = goal.kind === "retention" || goal.kind === "custom";

  return (
    <div className="flex flex-col rounded-xl border border-border bg-card p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold">{goal.name}</p>
          <p className="text-xs text-muted-foreground">
            {GOAL_KIND_LABELS[goal.kind]} · {GOAL_PERIOD_LABELS[goal.period]}
            {goal.deadline ? ` · due ${new Date(goal.deadline).toLocaleDateString()}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 gap-0.5">
          <Button variant="ghost" size="icon" className="size-7" aria-label="Edit goal" onClick={onEdit}>
            <Pencil className="size-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="size-7 text-destructive hover:text-destructive"
            aria-label="Delete goal"
            onClick={onDelete}
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-baseline gap-1.5">
        {goal.current !== null ? (
          <>
            <span className="tabular text-2xl font-semibold tracking-tight">{goal.formatted}</span>
            {goal.targetValue !== undefined && (
              <span className="tabular text-sm text-muted-foreground">
                / {goalUnitLabel(goal.unit, goal.targetValue)}
              </span>
            )}
          </>
        ) : (
          <span className="text-sm font-medium text-[#82552e]">Not measurable automatically</span>
        )}
      </div>

      {goal.progress !== null && (
        <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#e4ddcf]">
          <div
            className={cn(
              "h-full rounded-full transition-all",
              (goal.progress ?? 0) >= 1 ? "bg-[#53634a]" : "bg-[#171613]",
            )}
            style={{ width: `${Math.max(3, (goal.progress ?? 0) * 100)}%` }}
          />
        </div>
      )}

      <p className="mt-2 flex-1 text-[11px] leading-relaxed text-muted-foreground/70">
        {goal.current !== null
          ? goal.usingManualValue
            ? "Manually tracked — this goal type can't be derived from CRM data."
            : `Derived from your CRM: ${goal.basis}.`
          : goal.unavailableReason}
      </p>

      <div className="mt-2 flex items-center justify-between gap-2">
        {manualAllowed ? (
          manualOpen ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={manualVal}
                onChange={(e) => setManualVal(e.target.value)}
                className="h-7 w-28 text-xs"
                placeholder="Current value"
                inputMode="numeric"
              />
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={async () => {
                  await onSetManual(
                    manualVal.trim() ? Number(manualVal.replace(/[^0-9.]/g, "")) : undefined,
                  );
                  setManualOpen(false);
                  setManualVal("");
                }}
              >
                Save
              </Button>
              <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setManualOpen(false)}>
                Cancel
              </Button>
            </div>
          ) : (
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => setManualOpen(true)}>
              {goal.usingManualValue ? "Edit manual value" : "Track manually"}
            </Button>
          )
        ) : (
          <span />
        )}
        {goal.status === "achieved" && (
          <span className="rounded-full border border-[#53634a]/45 bg-[#53634a]/[0.12] px-2 py-0.5 text-[10px] font-medium text-[#42503c]">
            Achieved
          </span>
        )}
      </div>
    </div>
  );
}

function goalUnitLabel(unit: "money" | "count" | "percent", target: number): string {
  if (unit === "money") return moneyFmt(target);
  if (unit === "percent") return `${target}%`;
  return target.toLocaleString();
}

// ── Goal create/edit dialog ──────────────────────────────────────────────────

function GoalDialog({
  state,
  onClose,
  onCreate,
  onUpdate,
}: {
  state:
    | { mode: "create" }
    | {
        mode: "edit";
        goal: {
          _id: Id<"businessGoals">;
          name: string;
          kind: string;
          period: string;
          targetValue?: number;
          deadline?: number;
          status: string;
        };
      }
    | null;
  onClose: () => void;
  onCreate: (fields: {
    name: string;
    kind: string;
    targetValue?: number;
    period: string;
    deadline?: number;
  }) => Promise<void>;
  onUpdate: (
    id: Id<"businessGoals">,
    fields: { name?: string; targetValue?: number; period?: string; deadline?: number; status?: string },
  ) => Promise<void>;
}) {
  const editing = state?.mode === "edit" ? state.goal : null;

  return (
    <Dialog open={state !== null} onOpenChange={(open) => !open && onClose()}>
      {state !== null && (
        <GoalDialogInner
          key={editing?._id ?? "create"}
          editing={editing}
          onClose={onClose}
          onCreate={onCreate}
          onUpdate={onUpdate}
        />
      )}
    </Dialog>
  );
}

function GoalDialogInner({
  editing,
  onClose,
  onCreate,
  onUpdate,
}: {
  editing: {
    _id: Id<"businessGoals">;
    name: string;
    kind: string;
    period: string;
    targetValue?: number;
    deadline?: number;
    status: string;
  } | null;
  onClose: () => void;
  onCreate: (fields: {
    name: string;
    kind: string;
    targetValue?: number;
    period: string;
    deadline?: number;
  }) => Promise<void>;
  onUpdate: (
    id: Id<"businessGoals">,
    fields: { name?: string; targetValue?: number; period?: string; deadline?: number; status?: string },
  ) => Promise<void>;
}) {
  const [name, setName] = useState(editing?.name ?? "");
  const [kind, setKind] = useState<GoalKind>((editing?.kind as GoalKind) ?? "revenue");
  const [period, setPeriod] = useState<GoalPeriod>((editing?.period as GoalPeriod) ?? "month");
  const [target, setTarget] = useState(editing?.targetValue?.toString() ?? "");
  const [deadline, setDeadline] = useState(
    editing?.deadline ? new Date(editing.deadline).toISOString().slice(0, 10) : "",
  );
  const [status, setStatus] = useState(editing?.status ?? "active");
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (!name.trim()) {
      toast.error("Give the goal a name.");
      return;
    }
    setBusy(true);
    try {
      const parsedTarget = target.trim()
        ? Number(target.replace(/[^0-9.]/g, "")) || undefined
        : undefined;
      const parsedDeadline = deadline ? new Date(deadline).getTime() : undefined;
      if (editing) {
        await onUpdate(editing._id, {
          name: name.trim(),
          targetValue: parsedTarget,
          period,
          deadline: parsedDeadline,
          status,
        });
      } else {
        await onCreate({
          name: name.trim(),
          kind,
          targetValue: parsedTarget,
          period,
          deadline: parsedDeadline,
        });
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't save the goal.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent className="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>{editing ? "Edit goal" : "New goal"}</DialogTitle>
        <DialogDescription>
          Current values are computed from your CRM automatically — you set the target, the data
          provides the progress.
        </DialogDescription>
      </DialogHeader>
      <div className="grid gap-4">
        <div className="grid gap-1.5">
          <Label htmlFor="goal-name">Goal name</Label>
          <Input
            id="goal-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="20 qualified leads"
          />
        </div>
        {!editing && (
          <div className="grid gap-1.5">
            <Label>What kind of goal?</Label>
            <div className="grid grid-cols-2 gap-2">
              {GOAL_KINDS.map((k) => (
                <button
                  key={k}
                  type="button"
                  aria-pressed={kind === k}
                  onClick={() => setKind(k)}
                  className={cn(
                    "cursor-pointer rounded-lg border px-3 py-2 text-left text-xs font-medium transition-colors",
                    kind === k
                      ? "border-[#171613] bg-[#171613] text-[#f5f0e6]"
                      : "border-border bg-card hover:border-[#b3a894]",
                  )}
                >
                  {GOAL_KIND_LABELS[k]}
                  {(k === "retention" || k === "custom") && (
                    <span className="mt-0.5 block text-[10px] font-normal opacity-70">
                      tracked manually
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="goal-target">
              Target {goalUnit(kind) === "money" ? "($)" : goalUnit(kind) === "percent" ? "(%)" : ""}
            </Label>
            <Input
              id="goal-target"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              inputMode="numeric"
              placeholder={goalUnit(kind) === "money" ? "10,000" : "20"}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="goal-period">Period</Label>
            <select
              id="goal-period"
              value={period}
              onChange={(e) => setPeriod(e.target.value as GoalPeriod)}
              className="h-9 rounded-md border border-border bg-card px-2 text-sm"
            >
              {GOAL_PERIODS.map((p) => (
                <option key={p} value={p}>
                  {GOAL_PERIOD_LABELS[p]}
                </option>
              ))}
            </select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid gap-1.5">
            <Label htmlFor="goal-deadline">Deadline (optional)</Label>
            <Input
              id="goal-deadline"
              type="date"
              value={deadline}
              onChange={(e) => setDeadline(e.target.value)}
            />
          </div>
          {editing && (
            <div className="grid gap-1.5">
              <Label htmlFor="goal-status">Status</Label>
              <select
                id="goal-status"
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                className="h-9 rounded-md border border-border bg-card px-2 text-sm"
              >
                <option value="active">Active</option>
                <option value="achieved">Achieved</option>
                <option value="paused">Paused</option>
              </select>
            </div>
          )}
        </div>
      </div>
      <DialogFooter>
        <Button variant="outline" onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void submit()} disabled={busy || !name.trim()}>
          {busy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : editing ? (
            "Save changes"
          ) : (
            "Create goal"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
