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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useMutation } from "convex/react";
import {
  buildLeadsFromMapping,
  LEAD_FIELD_OPTIONS,
  parseCsv,
  suggestField,
  type LeadField,
} from "@/lib/csv";
import { AlertTriangle, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "sonner";

type Mapping = (LeadField | "skip")[];

export function ImportCsvDialog({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const [fileName, setFileName] = useState<string | null>(null);
  const [rows, setRows] = useState<string[][]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Mapping>([]);
  const [error, setError] = useState<string | null>(null);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const bulkImport = useMutation(api.leads.bulkImport);

  const reset = () => {
    setFileName(null);
    setRows([]);
    setHeaders([]);
    setMapping([]);
    setError(null);
    setImporting(false);
    setProgress(0);
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
    } catch {
      setError("That file couldn't be read as text. Export it as CSV and retry.");
    }
  };

  const startImport = async () => {
    const nameCols = mapping.filter((m) => m === "name").length;
    if (nameCols === 0) {
      setError("Map at least one column to “Full name” — leads need a name.");
      return;
    }
    setImporting(true);
    setError(null);
    const { leads, skipped } = buildLeadsFromMapping(rows, mapping);
    if (leads.length === 0) {
      setError("None of the rows had a name in the mapped column — nothing to import.");
      setImporting(false);
      return;
    }
    // Import in batches so progress feels real for big lists
    const batchSize = 50;
    const batches: (typeof leads)[] = [];
    for (let i = 0; i < leads.length; i += batchSize) {
      batches.push(leads.slice(i, i + batchSize));
    }
    try {
      let done = 0;
      for (const batch of batches) {
        await bulkImport({
          leads: batch.map((l) => ({ ...l, source: "CSV import" })),
        });
        done += batch.length;
        setProgress(Math.round((done / leads.length) * 100));
      }
      toast(`Imported ${leads.length} lead${leads.length === 1 ? "" : "s"}`, {
        description:
          skipped > 0
            ? `${skipped} row${skipped === 1 ? " was" : "s were"} skipped (no name in the mapped column).`
            : "All rows imported successfully.",
      });
      reset();
      setOpen(false);
    } catch {
      setError("Import failed partway — check your connection and retry.");
      setImporting(false);
    }
  };

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
            Upload a file, check the column mapping, then confirm. Nothing is
            imported until you approve.
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

            <div className="rounded-md border border-border bg-muted/30 px-3 py-2.5">
              <p className="label-caps text-muted-foreground">Preview</p>
              <p className="mt-1 text-sm">
                First row becomes{" "}
                <span className="font-medium">
                  {mapping.includes("name")
                    ? `${rows[0]?.[mapping.indexOf("name")] ?? "?"}`
                    : "— map a name column"}
                </span>
              </p>
            </div>
          </div>
        )}

        {importing && (
          <div aria-live="polite" className="flex flex-col gap-1.5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-gradient-to-r from-[#8B5CF6] to-[#A855F7] transition-all duration-300"
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
          {fileName && !importing && (
            <Button onClick={startImport}>
              {importing ? (
                <>
                  <Loader2 className="size-4 animate-spin" /> Importing…
                </>
              ) : (
                <>Import {rows.length} rows</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
