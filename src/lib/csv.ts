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

// ── Validation + deduplication (production hardening §5) ───────────────────
//
// One source of truth for import dedup keys, shared by the client preview and
// the server-side bulkImport re-check, so what the user confirms is what the
// server actually does. Duplicate keys (any match marks the row a duplicate):
//   • email  — lowercased/trimmed
//   • phone  — digits only, ≥7 digits
//   • company + name — both lowercased/trimmed, only when company is present

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email.trim());
}

export function normalizeEmail(email?: string): string | null {
  const e = email?.trim().toLowerCase();
  return e ? e : null;
}

/** Digits-only phone key; null when missing or too short to be meaningful. */
export function normalizePhone(phone?: string): string | null {
  const digits = (phone ?? "").replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

export function normalizeCompanyName(company?: string): string | null {
  const c = company?.trim().toLowerCase();
  return c ? c : null;
}

export interface LeadKeyInput {
  name: string;
  email?: string;
  phone?: string;
  company?: string;
}

/** The dedup keys for one lead — used for in-file and against-CRM checks. */
export function leadDedupKeys(lead: LeadKeyInput): {
  email: string | null;
  phone: string | null;
  companyName: string | null;
} {
  const companyName = normalizeCompanyName(lead.company)
    ? `${normalizeCompanyName(lead.company)}|${lead.name.trim().toLowerCase()}`
    : null;
  return {
    email: normalizeEmail(lead.email),
    phone: normalizePhone(lead.phone),
    companyName,
  };
}

/** Key sets over the user's existing CRM leads, for against-CRM dedupe. */
export interface ExistingLeadKeys {
  emails: Set<string>;
  phones: Set<string>;
  companyNames: Set<string>;
}

export function buildExistingKeys(
  leads: LeadKeyInput[],
): ExistingLeadKeys {
  const keys: ExistingLeadKeys = { emails: new Set(), phones: new Set(), companyNames: new Set() };
  for (const lead of leads) {
    const k = leadDedupKeys(lead);
    if (k.email) keys.emails.add(k.email);
    if (k.phone) keys.phones.add(k.phone);
    if (k.companyName) keys.companyNames.add(k.companyName);
  }
  return keys;
}

export type RowStatus = "new" | "duplicate" | "invalid";

export interface AnalyzedRow {
  rowNumber: number; // 1-based data row (header not counted)
  lead: NormalizedLead | null;
  status: RowStatus;
  /** Why the row was marked duplicate/invalid (empty for new rows). */
  reason?: string;
}

export interface ImportAnalysis {
  /** All data rows in the file (what "total rows" means in the preview). */
  totalRows: number;
  newCount: number;
  duplicateCount: number;
  invalidCount: number;
  /** "Skipped" = everything not imported = duplicates + invalid. */
  skippedCount: number;
  /** Only the rows that will actually be inserted. */
  newLeads: NormalizedLead[];
  /** Human-readable reasons, capped for display. */
  duplicateReasons: string[];
  invalidReasons: string[];
}

/** Turn mapped CSV rows into per-row candidates (rows without a name → null lead). */
export function buildRowCandidates(
  rows: string[][],
  mapping: (LeadField | "skip")[],
): { rowNumber: number; lead: NormalizedLead | null }[] {
  return rows.map((cells, i) => {
    const lead: Record<string, string> = {};
    mapping.forEach((field, col) => {
      if (field === "skip") return;
      const value = (cells[col] ?? "").trim();
      if (value) lead[field] = value;
    });
    const rowNumber = i + 1;
    if (!lead.name) return { rowNumber, lead: null };
    return { rowNumber, lead: lead as unknown as NormalizedLead };
  });
}

/**
 * Full import analysis: validate required fields, detect duplicates within
 * the file AND against the existing CRM, and classify every row. First
 * occurrence wins — later rows matching an earlier row are duplicates.
 */
export function analyzeImportRows(
  candidates: { rowNumber: number; lead: NormalizedLead | null }[],
  existing: ExistingLeadKeys,
): ImportAnalysis {
  const analysis: ImportAnalysis = {
    totalRows: candidates.length,
    newCount: 0,
    duplicateCount: 0,
    invalidCount: 0,
    skippedCount: 0,
    newLeads: [],
    duplicateReasons: [],
    invalidReasons: [],
  };

  // In-file dedup state — starts empty, grows as new rows are accepted.
  const seenEmails = new Set<string>();
  const seenPhones = new Set<string>();
  const seenCompanyNames = new Set<string>();

  for (const { rowNumber, lead } of candidates) {
    // Validation first: required name + sane email/phone when present.
    if (!lead) {
      analysis.invalidCount++;
      if (analysis.invalidReasons.length < 5)
        analysis.invalidReasons.push(`Row ${rowNumber}: missing name (required)`);
      continue;
    }
    if (lead.email && !isValidEmail(lead.email)) {
      analysis.invalidCount++;
      if (analysis.invalidReasons.length < 5)
        analysis.invalidReasons.push(`Row ${rowNumber}: invalid email “${lead.email}”`);
      continue;
    }
    if (lead.phone && !normalizePhone(lead.phone)) {
      analysis.invalidCount++;
      if (analysis.invalidReasons.length < 5)
        analysis.invalidReasons.push(`Row ${rowNumber}: phone number too short`);
      continue;
    }

    const keys = leadDedupKeys(lead);

    // Against-CRM duplicates.
    if (keys.email && existing.emails.has(keys.email)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: email already in your CRM`);
      continue;
    }
    if (keys.phone && existing.phones.has(keys.phone)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: phone already in your CRM`);
      continue;
    }
    if (keys.companyName && existing.companyNames.has(keys.companyName)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: same company + name already in your CRM`);
      continue;
    }

    // Within-file duplicates (later rows matching an earlier row).
    if (keys.email && seenEmails.has(keys.email)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: duplicate email in this file`);
      continue;
    }
    if (keys.phone && seenPhones.has(keys.phone)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: duplicate phone in this file`);
      continue;
    }
    if (keys.companyName && seenCompanyNames.has(keys.companyName)) {
      analysis.duplicateCount++;
      if (analysis.duplicateReasons.length < 5)
        analysis.duplicateReasons.push(`Row ${rowNumber}: duplicate company + name in this file`);
      continue;
    }

    // Genuinely new — record its keys so later rows dedupe against it.
    if (keys.email) seenEmails.add(keys.email);
    if (keys.phone) seenPhones.add(keys.phone);
    if (keys.companyName) seenCompanyNames.add(keys.companyName);
    analysis.newCount++;
    analysis.newLeads.push(lead);
  }

  analysis.skippedCount = analysis.duplicateCount + analysis.invalidCount;
  return analysis;
}
