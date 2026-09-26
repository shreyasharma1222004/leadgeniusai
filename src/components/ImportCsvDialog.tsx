import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useMutation, useQuery } from "convex/react";
import {
  analyzeImportRows,
  buildExistingKeys,
  buildRowCandidates,
  LEAD_FIELD_OPTIONS,
  parseCsv,
  suggestField,
  type LeadField,
} from "@/lib/csv";
import { AlertTriangle, CheckCircle2, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import { toast } from "sonner";

type Mapping = (LeadField | "skip")[];

/** Above this many new rows, the import asks for a second explicit confirm. */
const LARGE_IMPORT_THRESHOLD = 50;

export function ImportCsvDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [confirmStep, setConfirmStep] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const bulkImport = useMutation(api.leads.bulkImport);
  // Existing CRM leads — needed for against-CRM duplicate detection in the
  // preview. Only subscribed while a file is loaded.
  const leads = useQuery(api.leads.list, open && fileName ? {} : "skip");

  const reset = () => {
    setFileName(null);
    setRows([]);
    setHeaders([]);
    setMapping([]);
    setError(null);
    setImporting(false);
    setProgress(0);
    setConfirmStep(false);
  };

  const handleFile = async (file: File) => {
    setError(null);
    if (file.size > 2 * 1024 * 1024) {
      setError("That file is over 2 MB — split it into smaller batches.");
      return;
    }
    try {
      const text = await file.text();
      const parsed = parseCsv(text);
      if (parsed.length < 2) {
        setError(
          "We couldn't find data rows in that file. Check that it's a CSV with a header row.",
        );
        return;
      }
      const [headerRow, ...dataRows] = parsed;
      setFileName(file.name);
      setHeaders(headerRow);
      setRows(dataRows);
      setMapping(headerRow.map((h) => suggestField(h)));
      setConfirmStep(false);
    } catch {
      setError("That file couldn't be read as text. Export it as CSV and retry.");
    }
  };

  // Live analysis: validation + in-file and against-CRM dedup, recomputed
  // whenever the mapping or your CRM changes.
  const analysis = useMemo(() => {
    if (!fileName || leads === undefined) return null;
    const candidates = buildRowCandidates(rows, mapping);
    const existing = buildExistingKeys(leads);
    return analyzeImportRows(candidates, existing);
  }, [fileName, leads, rows, mapping]);

  const startImport = async () => {
    if (!analysis) return;
    setImporting(true);
    setError(null);
    const { newLeads } = analysis;
    if (newLeads.length === 0) {
      setError("Nothing to import — every row is a duplicate or invalid.");
      setImporting(false);
      return;
    }
    // Import in batches so progress feels real for big lists
    const batchSize = 50;
    const batches: (typeof newLeads)[] = [];
    for (let i = 0; i < newLeads.length; i += batchSize) {
      batches.push(newLeads.slice(i, i + batchSize));
    }
    try {
      let done = 0;
      let serverDuplicates = 0;
      for (const batch of batches) {
        const result = await bulkImport({
          leads: batch.map((l) => ({ ...l, source: "CSV import" })),
        });
        serverDuplicates += result.duplicates;
        done += batch.length;
        setProgress(Math.round((done / newLeads.length) * 100));
      }
      const skipped = analysis.duplicateCount + analysis.invalidCount;
      toast(`Imported ${newLeads.length} lead${newLeads.length === 1 ? "" : "s"}`, {
        description:
          skipped > 0 || serverDuplicates > 0
            ? `${skipped + serverDuplicates} row${skipped + serverDuplicates === 1 ? " was" : "s were"} skipped as duplicates or invalid. Nothing was overwritten.`
            : "All rows imported successfully.",
      });
      reset();
      setOpen(false);
    } catch {
      setError("Import failed partway — your CRM keeps every lead already saved. Retry re-imports safely: duplicates are skipped automatically.");
      setImporting(false);
    }
  };

  const nameCols = mapping.filter((m) => m === "name").length;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button variant="outline" className={className}>
          <Upload className="size-4" />
          Import CSV
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Import leads from CSV</DialogTitle>
          <DialogDescription>
            Upload a file, check the column mapping, then review the dedup
            preview. Nothing is imported until you confirm.
          </DialogDescription>
        </DialogHeader>

        {!fileName ? (
          <div
            role="button"
            tabIndex={0}
            aria-label="Upload CSV file"
            onClick={() => inputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") inputRef.current?.click();
            }}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => {
              e.preventDefault();
              const file = e.dataTransfer.files?.[0];
              if (file) void handleFile(file);
            }}
            className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed border-border bg-muted/40 px-6 py-12 text-center transition-colors hover:border-foreground/30 hover:bg-muted/70"
          >
            <FileSpreadsheet className="size-8 text-muted-foreground" />
            <p className="text-sm font-medium">Upload CSV</p>
            <p className="text-xs text-muted-foreground">
              Drag a file here or click to browse · max 2 MB
            </p>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            <div className="flex items-center justify-between rounded-md border border-border bg-muted/40 px-3 py-2">
              <div className="flex min-w-0 items-center gap-2">
                <FileSpreadsheet className="size-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{fileName}</p>
                  <p className="text-xs text-muted-foreground">
                    {rows.length} row{rows.length === 1 ? "" : "s"} · {headers.length}{" "}
                    column{headers.length === 1 ? "" : "s"}
                  </p>
                </div>
              </div>
              <Button variant="ghost" size="sm" onClick={reset}>
                Replace
              </Button>
            </div>

            <div className="rounded-md border border-border">
              <div className="border-b border-border px-3 py-2">
                <p className="label-caps text-muted-foreground">Column mapping</p>
              </div>
              <div className="max-h-72 overflow-y-auto">
                {headers.map((header, col) => (
                  <div
                    key={`${header}-${col}`}
                    className="flex items-center gap-3 border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{header}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        e.g. “{rows[0]?.[col] ?? "—"}”
                      </p>
                    </div>
                    <Select
                      value={mapping[col] ?? "skip"}
                      onValueChange={(value) =>
                        setMapping((m) => {
                          const next = [...m];
                          next[col] = value as LeadField | "skip";
                          return next;
                        })
                      }
                    >
                      <SelectTrigger size="sm" className="w-44">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="skip">Skip column</SelectItem>
                        {LEAD_FIELD_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
              </div>
            </div>

            {/* Import preview — counts + reasons before anything is written */}
            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <p className="label-caps text-muted-foreground">Import preview</p>
              {nameCols === 0 ? (
                <p className="mt-1 text-sm text-destructive">
                  Map at least one column to “Full name” — leads need a name.
                </p>
              ) : leads === undefined ? (
                <p className="mt-1 flex items-center gap-2 text-sm text-muted-foreground">
                  <Loader2 className="size-3.5 animate-spin" /> Checking against your CRM…
                </p>
              ) : analysis ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-5">
                    <Count label="Total rows" value={analysis.totalRows} />
                    <Count label="New" value={analysis.newCount} tone="good" />
                    <Count label="Duplicates" value={analysis.duplicateCount} tone="warn" />
                    <Count label="Invalid" value={analysis.invalidCount} tone="bad" />
                    <Count label="To be skipped" value={analysis.skippedCount} />
                  </div>
                  {(analysis.duplicateReasons.length > 0 || analysis.invalidReasons.length > 0) && (
                    <ul className="mt-2 space-y-1 text-xs text-muted-foreground">
                      {analysis.duplicateReasons.map((r) => (
                        <li key={r}>• {r}</li>
                      ))}
                      {analysis.invalidReasons.map((r) => (
                        <li key={r}>• {r}</li>
                      ))}
                      {(analysis.duplicateCount > analysis.duplicateReasons.length ||
                        analysis.invalidCount > analysis.invalidReasons.length) && (
                        <li>• …and more</li>
                      )}
                    </ul>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Duplicates match email, phone, or company + name — against this file
                    <span className="font-medium"> and your existing CRM</span>. First occurrence
                    wins; duplicates are skipped, never overwritten or deleted.
                  </p>
                </>
              ) : null}
            </div>
          </div>
        )}

        {importing && (
          <div aria-live="polite" className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[#171613] transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              Importing… {progress}%
            </p>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-sm text-destructive">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            {error}
          </div>
        )}

        <DialogFooter>
          {fileName && !importing && analysis && nameCols > 0 && (
            <>
              {confirmStep ? (
                <>
                  <Button variant="outline" onClick={() => setConfirmStep(false)}>
                    Back
                  </Button>
                  <Button onClick={() => void startImport()} disabled={analysis.newCount === 0}>
                    <CheckCircle2 className="size-4" />
                    Confirm import — {analysis.newCount} new lead
                    {analysis.newCount === 1 ? "" : "s"}
                  </Button>
                </>
              ) : (
                <Button
                  onClick={() =>
                    analysis.newCount > LARGE_IMPORT_THRESHOLD
                      ? setConfirmStep(true)
                      : void startImport()
                  }
                  disabled={analysis.newCount === 0}
                >
                  {analysis.newCount > LARGE_IMPORT_THRESHOLD
                    ? `Review ${analysis.newCount} new leads…`
                    : `Import ${analysis.newCount} new lead${analysis.newCount === 1 ? "" : "s"}`}
                </Button>
              )}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Count({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "good" | "warn" | "bad";
}) {
  return (
    <div className="rounded-md border border-border bg-card px-2 py-1.5 text-center">
      <p
        className={
          "tabular text-lg font-semibold leading-none " +
          (tone === "good"
            ? "text-[#42503c]"
            : tone === "warn"
              ? "text-[#82552e]"
              : tone === "bad"
                ? "text-destructive"
                : "text-foreground")
        }
      >
        {value}
      </p>
      <p className="mt-1 text-[10px] text-muted-foreground">{label}</p>
    </div>
  );
}
