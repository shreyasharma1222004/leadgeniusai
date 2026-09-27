import { AppShell } from "@/components/AppShell";
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
import { Skeleton } from "@/components/ui/skeleton";
import { api } from "@/convex/_generated/api";
import { formatDateTime, timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import { ArrowRight, CalendarClock, Check, X } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router";
import { toast } from "sonner";

type Filter = "overdue" | "today" | "upcoming" | "done";

export default function TasksPage() {
  const followUps = useQuery(api.followUps.listForUser, {});
  const stats = useQuery(api.followUps.stats, {});
  const setFollowUpStatus = useMutation(api.leads.setFollowUpStatus);
  // Phase 2 cleanup item 5: wire the EXISTING updateFollowUp mutation into the
  // existing task list — a small inline reschedule, not a new task system.
  const updateFollowUp = useMutation(api.leads.updateFollowUp);
  const [filter, setFilter] = useState<Filter>("overdue");
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [rescheduleAt, setRescheduleAt] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");

  if (followUps === undefined || stats === undefined) {
    return (
      <AppShell title="Tasks">
        <div className="space-y-2">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-16 rounded-lg" />
          ))}
        </div>
      </AppShell>
    );
  }

  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const matches = (dueAt: number, status: string): boolean => {
    if (filter === "done") return status === "done" || status === "skipped";
    if (status !== "pending") return false;
    if (filter === "overdue") return dueAt < now;
    if (filter === "today") return dueAt >= now && dueAt <= endOfDay.getTime();
    return dueAt > endOfDay.getTime();
  };

  const visible = followUps.filter((f) => matches(f.dueAt, f.status));
  const skipped = followUps.filter((f) => f.status === "skipped" && filter === "done");

  const chips: { key: Filter; label: string; count: number }[] = [
    { key: "overdue", label: "Overdue", count: stats.overdue },
    { key: "today", label: "Due today", count: stats.dueToday },
    { key: "upcoming", label: "Upcoming", count: stats.upcoming },
    { key: "done", label: "Done", count: stats.done },
  ];

  const update = async (id: typeof followUps[number]["_id"], status: "done" | "skipped" | "pending") => {
    try {
      await setFollowUpStatus({ id, status });
      toast(status === "done" ? "Follow-up completed" : status === "skipped" ? "Skipped" : "Reopened");
    } catch {
      toast.error("Couldn't update that task — try again.");
    }
  };

  const saveReschedule = async () => {
    if (!rescheduleId || !rescheduleAt) return;
    const ts = new Date(rescheduleAt).getTime();
    if (Number.isNaN(ts)) {
      toast.error("Pick a valid date and time.");
      return;
    }
    try {
      await updateFollowUp({
        id: rescheduleId as never,
        dueAt: ts,
        note: rescheduleNote.trim() || undefined,
      });
      toast("Follow-up rescheduled");
      setRescheduleId(null);
      setRescheduleAt("");
      setRescheduleNote("");
    } catch {
      toast.error("Couldn't reschedule — try again.");
    }
  };

  return (
    <AppShell title="Tasks">
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Every scheduled follow-up across your pipeline. The money is in the follow-up.
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="flex items-center rounded-md border border-border bg-card p-0.5">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              aria-pressed={filter === chip.key}
              onClick={() => setFilter(chip.key)}
              className={cn(
                "cursor-pointer rounded px-2.5 py-1.5 text-xs font-medium transition-colors",
                filter === chip.key
                  ? "bg-[#171613] text-[#f5f0e6]"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {chip.label} ({chip.count})
            </button>
          ))}
        </div>
      </div>

      {visible.length === 0 && skipped.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-14 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-border bg-secondary text-foreground">
            <CalendarClock className="size-5" />
          </div>
          <p className="mt-4 text-sm font-medium">Nothing in “{chips.find((c) => c.key === filter)?.label}”.</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Schedule follow-ups from any lead page — they land here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {[...visible, ...skipped].map((f) => {
            const overdue = f.status === "pending" && f.dueAt < now;
            return (
              <div
                key={f._id}
                className={cn(
                  "flex flex-wrap items-center gap-3 rounded-lg border bg-card px-4 py-3 transition-colors hover:border-[#b3a894]",
                  overdue ? "border-destructive/40" : "border-border",
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    f.status === "done"
                      ? "bg-[#171613]"
                      : overdue
                        ? "bg-destructive"
                        : f.status === "skipped"
                          ? "bg-border"
                          : "bg-[#9a9285]",
                  )}
                />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      "truncate text-sm font-medium",
                      f.status === "skipped" && "text-muted-foreground line-through",
                    )}
                  >
                    {f.note || "Follow up"}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    <Link
                      to={`/leads/${f.leadId}`}
                      className="underline-offset-2 hover:text-foreground hover:underline"
                    >
                      {f.lead?.name ?? "Lead"}
                    </Link>
                    {" · "}
                    <span className={overdue ? "text-destructive" : undefined}>
                      {f.status === "pending"
                        ? overdue
                          ? `overdue · ${timeAgo(f.dueAt)}`
                          : `due ${formatDateTime(f.dueAt)}`
                        : f.status === "done"
                          ? `done ${timeAgo(f.completedAt)}`
                          : "skipped"}
                    </span>
                  </p>
                </div>
                <div className="flex gap-1.5">
                  {f.status === "pending" ? (
                    <>
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => void update(f._id, "done")}
                      >
                        <Check className="size-3" /> Done
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => {
                          setRescheduleId(f._id);
                          setRescheduleAt(
                            new Date(f.dueAt - new Date().getTimezoneOffset() * 60000)
                              .toISOString()
                              .slice(0, 16),
                          );
                          setRescheduleNote(f.note ?? "");
                        }}
                      >
                        <CalendarClock className="size-3" /> Reschedule
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 gap-1 text-xs"
                        onClick={() => void update(f._id, "skipped")}
                      >
                        <X className="size-3" /> Skip
                      </Button>
                    </>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => void update(f._id, "pending")}
                    >
                      Reopen
                    </Button>
                  )}
                  <Button asChild variant="ghost" size="sm" className="h-7 gap-1 text-xs">
                    <Link to={`/leads/${f.leadId}`}>
                      Open <ArrowRight className="size-3" />
                    </Link>
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Inline reschedule dialog — uses the existing updateFollowUp mutation */}
      <Dialog open={rescheduleId !== null} onOpenChange={(open) => !open && setRescheduleId(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reschedule follow-up</DialogTitle>
            <DialogDescription>
              Moves this task to a new time. The lead's next scheduled activity updates with it.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="rs-at">When</Label>
              <Input
                id="rs-at"
                type="datetime-local"
                value={rescheduleAt}
                onChange={(e) => setRescheduleAt(e.target.value)}
              />
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="rs-note">Note (optional)</Label>
              <Input
                id="rs-note"
                value={rescheduleNote}
                onChange={(e) => setRescheduleNote(e.target.value)}
                placeholder="What's the angle?"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRescheduleId(null)}>
              Cancel
            </Button>
            <Button onClick={() => void saveReschedule()} disabled={!rescheduleAt}>
              Reschedule
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
