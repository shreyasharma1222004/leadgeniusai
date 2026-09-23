/** Minimal RFC-4180-style CSV parser (handles quoted fields and newlines). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  const src = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  const pushField = () => {
    row.push(field);
    field = "";
  };
  const pushRow = () => {
    pushField();
    rows.push(row);
    row = [];
  };

  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (inQuotes) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      pushField();
    } else if (ch === "\n") {
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field.length > 0 || row.length > 0) pushRow();
  return rows.filter((r) => r.some((c) => c.trim().length > 0));
}

/** Lead field options for CSV column mapping. */
export const LEAD_FIELD_OPTIONS = [
  { value: "name", label: "Full name (required)" },
  { value: "jobTitle", label: "Job title" },
  { value: "company", label: "Company" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "industry", label: "Industry" },
  { value: "location", label: "Location" },
  { value: "linkedin", label: "LinkedIn" },
  { value: "notes", label: "Notes" },
] as const;

export type LeadField = (typeof LEAD_FIELD_OPTIONS)[number]["value"];

/** Suggest a lead field for a CSV header label. */
export function suggestField(header: string): LeadField | "skip" {
  const h = header.toLowerCase().replace(/[^a-z]/g, "");
  const map: [RegExp, LeadField | "skip"][] = [
    [/lastname$/, "name"],
    [/^(first|last|full)?name$|^fullname$|^contactname$|^leadname$/, "name"],
    [/^(job)?title$|role|position|designation/, "jobTitle"],
    [/compan|organi|account|business/, "company"],
    [/mail/, "email"],
    [/phone|mobile|tel|cell/, "phone"],
    [/website|url|domain|site/, "website"],
    [/industr|segment|vertical|category/, "industry"],
    [/locat|city|country|region|place/, "location"],
    [/linkedin/, "linkedin"],
    [/note|comment|context/, "notes"],
  ];
  for (const [re, field] of map) {
    if (re.test(h)) return field;
  }
  return "skip";
}

export interface NormalizedLead {
  name: string;
  email?: string;
  phone?: string;
  jobTitle?: string;
  company?: string;
  website?: string;
  industry?: string;
  location?: string;
  linkedin?: string;
  notes?: string;
}

/** Turn mapped CSV rows into lead objects; skips rows without a name. */
export function buildLeadsFromMapping(
  rows: string[][],
  mapping: (LeadField | "skip")[],
): { leads: NormalizedLead[]; skipped: number } {
  const leads: NormalizedLead[] = [];
  let skipped = 0;
  for (const cells of rows) {
    const lead: Record<string, string> = {};
    mapping.forEach((field, col) => {
      if (field === "skip") return;
      const value = (cells[col] ?? "").trim();
      if (value) lead[field] = value;
    });
    if (!lead.name) {
      skipped++;
      continue;
    }
    leads.push(lead as unknown as NormalizedLead);
  }
  return { leads, skipped };
}
