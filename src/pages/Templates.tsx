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
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/convex/_generated/api";
import type { Doc } from "@/convex/_generated/dataModel";
import { timeAgo } from "@/lib/format";
import { renderTemplate, templateTokens } from "@/lib/outreach";
import { useMutation, useQuery } from "convex/react";
import { BookMarked, Copy, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

type Template = Doc<"templates">;

const EMPTY = { name: "", subject: "", body: "", channel: "email" };

export default function TemplatesPage() {
  const templates = useQuery(api.templates.list, {});
  const create = useMutation(api.templates.create);
  const update = useMutation(api.templates.update);
  const remove = useMutation(api.templates.remove);

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<Template | null>(null);

  if (templates === undefined) {
    return (
      <AppShell title="Templates">
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-44 animate-pulse rounded-xl bg-card" />
          ))}
        </div>
      </AppShell>
    );
  }

  const openEditor = (tpl?: Template) => {
    setEditingId(tpl?._id ?? null);
    setForm(
      tpl
        ? { name: tpl.name, subject: tpl.subject ?? "", body: tpl.body, channel: tpl.channel ?? "email" }
        : EMPTY,
    );
    setEditorOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.body.trim()) {
      toast.error("Name and message body are required.");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(),
        subject: form.subject.trim() || undefined,
        body: form.body,
        channel: form.channel,
      };
      if (editingId) {
        await update({ id: editingId as never, ...payload });
        toast("Template updated");
      } else {
        await create(payload);
        toast("Template created");
      }
      setEditorOpen(false);
    } catch {
      toast.error("Couldn't save the template — try again.");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!confirmDelete) return;
    try {
      await remove({ id: confirmDelete._id });
      toast("Template deleted");
    } catch {
      toast.error("Couldn't delete that template.");
    }
    setConfirmDelete(null);
  };

  const sample = templateTokens(null);

  return (
    <AppShell
      title="Templates"
      actions={
        <Button onClick={() => openEditor()}>
          <Plus className="size-4" /> New template
        </Button>
      }
    >
      <p className="-mt-3 mb-4 text-sm text-muted-foreground">
        Reusable messages with <code className="rounded bg-muted px-1">{"{{tokens}}"}</code> that
        fill from each lead's data — name, company, industry, and more.
      </p>

      {templates.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border bg-card/60 px-6 py-16 text-center">
          <div className="flex size-11 items-center justify-center rounded-full border border-[#8B5CF6]/30 bg-[#8B5CF6]/15 text-[#c4b5fd] shadow-[0_0_20px_rgba(139,92,246,0.25)]">
            <BookMarked className="size-5" />
          </div>
          <h2 className="mt-4 text-lg font-semibold tracking-tight">No templates yet.</h2>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            Save your best-performing outreach as a template and reuse it with every new lead.
          </p>
          <Button className="mt-5" onClick={() => openEditor()}>
            <Plus className="size-4" /> Create your first template
          </Button>
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((tpl) => (
            <div
              key={tpl._id}
              className="depth-card depth-card-hover flex flex-col rounded-xl border border-border bg-card p-4"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{tpl.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {tpl.channel === "linkedin" ? "LinkedIn" : "Email"} ·{" "}
                    {tpl.lastUsedAt ? `used ${timeAgo(tpl.lastUsedAt)}` : "never used"}
                  </p>
                </div>
                <div className="flex shrink-0 gap-0.5">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Copy ${tpl.name}`}
                    onClick={async () => {
                      const text =
                        tpl.channel === "email" && tpl.subject
                          ? `Subject: ${renderTemplate(tpl.subject, sample)}\n\n${renderTemplate(tpl.body, sample)}`
                          : renderTemplate(tpl.body, sample);
                      await navigator.clipboard.writeText(text);
                      toast("Copied with tokens resolved");
                    }}
                  >
                    <Copy className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7"
                    aria-label={`Edit ${tpl.name}`}
                    onClick={() => openEditor(tpl)}
                  >
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="size-7 text-destructive hover:text-destructive"
                    aria-label={`Delete ${tpl.name}`}
                    onClick={() => setConfirmDelete(tpl)}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>
              </div>
              {tpl.subject && (
                <p className="mt-3 truncate rounded bg-muted/60 px-2 py-1 text-xs font-medium">
                  {tpl.subject}
                </p>
              )}
              <p className="mt-2 line-clamp-5 whitespace-pre-wrap text-[13px] leading-relaxed text-muted-foreground">
                {tpl.body}
              </p>
            </div>
          ))}
        </div>
      )}

      {/* Editor dialog */}
      <Dialog open={editorOpen} onOpenChange={setEditorOpen}>
        <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>{editingId ? "Edit template" : "New template"}</DialogTitle>
            <DialogDescription>
              Use <code className="rounded bg-muted px-1">{"{{first_name}}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{{company}}"}</code>,{" "}
              <code className="rounded bg-muted px-1">{"{{industry}}"}</code> — they fill per lead.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-name">Template name</Label>
              <Input
                id="tpl-name"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Intro — design services"
              />
            </div>
            <div className="grid gap-1.5">
              <Label>Channel</Label>
              <div className="flex gap-2">
                {(["email", "linkedin"] as const).map((c) => (
                  <button
                    key={c}
                    type="button"
                    aria-pressed={form.channel === c}
                    onClick={() => setForm((f) => ({ ...f, channel: c }))}
                    className={
                      "cursor-pointer rounded-md border px-3 py-1.5 text-xs font-medium transition-colors " +
                      (form.channel === c
                        ? "border-[#8B5CF6]/60 bg-[#8B5CF6]/15 text-[#c4b5fd]"
                        : "border-border text-muted-foreground hover:text-foreground")
                    }
                  >
                    {c === "email" ? "Email" : "LinkedIn"}
                  </button>
                ))}
              </div>
            </div>
            {form.channel === "email" && (
              <div className="grid gap-1.5">
                <Label htmlFor="tpl-subject">Subject line</Label>
                <Input
                  id="tpl-subject"
                  value={form.subject}
                  onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))}
                  placeholder="Quick idea for {{company}}"
                />
              </div>
            )}
            <div className="grid gap-1.5">
              <Label htmlFor="tpl-body">Message</Label>
              <Textarea
                id="tpl-body"
                value={form.body}
                onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))}
                rows={9}
                className="font-mono text-[13px]"
                placeholder={"Hi {{first_name}},\n\nSaw {{company}} — impressive work in {{industry}}…"}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditorOpen(false)}>
              Cancel
            </Button>
            <Button onClick={() => void handleSave()} disabled={saving}>
              {saving && <Loader2 className="size-4 animate-spin" />}
              {editingId ? "Save changes" : "Create template"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <Dialog open={confirmDelete !== null} onOpenChange={(open) => !open && setConfirmDelete(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete “{confirmDelete?.name}”?</DialogTitle>
            <DialogDescription>
              This can't be undone. Campaigns that used it keep their sent messages.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(null)}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={() => void handleDelete()}>
              Delete template
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </AppShell>
  );
}
