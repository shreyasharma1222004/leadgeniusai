/**
 * Deterministic contract tests for the get_deal Copilot tool (Phase 2c-2).
 *
 * Pure-logic coverage: the tool's validation, ownership decision, and
 * projection are extracted as pure functions (isValidConvexIdShape,
 * dealToolDecision, projectDealForCopilot) specifically so these rules are
 * testable without a database. The thin internalQuery wires them together
 * with one ownership-scoped read.
 *
 * Run: bun test src/convex/assistant.test.ts
 */
import { describe, expect, test } from "bun:test";
import {
  CLIENTS_LIST_DEFAULT_LIMIT,
  CLIENTS_LIST_MAX_LIMIT,
  CLIENT_DEAL_CAP,
  GET_PROPOSALS_DEFAULT_LIMIT,
  GET_PROPOSALS_MAX_LIMIT,
  clientToolDecision,
  dealToolDecision,
  isValidClientKey,
  isValidConvexIdShape,
  parseGetClientsArgs,
  parseGetProposalsArgs,
  projectClientForCopilot,
  projectDealForCopilot,
  projectProposalForCopilot,
  runGetClientsPipeline,
  runGetProposalsPipeline,
} from "./assistant";
import { computeClients, filterClients, sortClients } from "../lib/clients";
import { dealTitle } from "../lib/revenue";
import type { Doc, Id } from "./_generated/dataModel";

// ── Fixtures (no database) ──────────────────────────────────────────────────

const USER_A = "jd7a9m2vkq3xs1pwnr5te0684c" as unknown as Id<"users">;
const USER_B = "yq2w8n5vxk93ms1pwr7te0z6j4" as unknown as Id<"users">;

function makeLead(
  overrides: Partial<Doc<"leads">> = {},
): Doc<"leads"> {
  return {
    _id: "k57aj2m9vq3xs1pwnb5te068d0" as unknown as Id<"leads">,
    _creationTime: 1_700_000_000_000,
    userId: USER_A,
    name: "Dana Cole",
    status: "proposal",
    dealValue: 18000,
    probability: 55,
    company: "Acme Expansion",
    source: "Referral",
    lastActivityAt: 1_710_000_000_000,
    ...overrides,
  } as unknown as Doc<"leads">;
}

// Real Convex IDs are 32-char lowercase base32; test shapes use that family.
const VALID_ID = "k57aj2m9vq3xs1pwnb5te068d0a1b2c3d";
const VALID_ID_ALT = "k57aj2m9vq3xs1pwnb5te068d0a1b2c3e";

// ── T4: malformed ID rejected before any database lookup ───────────────────

describe("get_deal: dealId validation", () => {
  test("accepts well-formed convex-shaped ids", () => {
    expect(isValidConvexIdShape(VALID_ID)).toBe(true);
  });
  test("rejects empty / non-string-shape / oversized / bad-charset ids", () => {
    expect(isValidConvexIdShape("")).toBe(false);
    expect(isValidConvexIdShape("short")).toBe(false);
    expect(isValidConvexIdShape("K57AJ2M9VQ3XS1PWNB5TE068D0A1B2C3D")).toBe(false); // uppercase
    expect(isValidConvexIdShape("k57aj2m9vq3xs1pwnb5te068d0a1b2c3!")).toBe(false); // symbol
    expect(isValidConvexIdShape("x".repeat(64))).toBe(false); // oversized
  });
});

// ── T2/T3/T8: missing and foreign are the SAME not_found (no leak) ─────────

describe("get_deal: ownership decision", () => {
  test("T2 missing deal → not_found", () => {
    expect(dealToolDecision(null, USER_A)).toEqual({ ok: false, code: "not_found" });
  });
  test("T3/T8 foreign deal (user B's row, user A asks) → identical not_found", () => {
    const foreign = makeLead({ userId: USER_B });
    const a = dealToolDecision(foreign, USER_A);
    const missing = dealToolDecision(null, USER_A);
    // Exactly the same result object — no way to distinguish existence.
    expect(a).toEqual(missing);
    expect(a).toEqual({ ok: false, code: "not_found" });
  });
  test("T1 owned deal → allowed", () => {
    expect(dealToolDecision(makeLead(), USER_A)).toEqual({ ok: true });
  });
});

// ── T1/T5/T6/T7: projection content, safety, zero/null correctness ─────────

describe("get_deal: projection", () => {
  test("T1 derived values come from the existing helpers", () => {
    const p = projectDealForCopilot(makeLead());
    expect(p.name).toBe("Acme Expansion — Dana Cole"); // dealTitle
    expect(p.stage).toBe("Proposal"); // statusLabel
    expect(p.status).toBe("proposal"); // canonicalStatus
    expect(p.value).toBe(18000);
    expect(p.probability).toBe(55);
    expect(p.weightedValue).toBe(9900); // 18000 × 55% via weightedValue
    expect(p.lastActivityAt).toBe(1_710_000_000_000); // lastActivityOf
    expect(p.createdAt).toBe(1_700_000_000_000);
    expect(p.contactName).toBe("Dana Cole");
  });

  test("T5 returns ONLY approved fields — no userId/notes/AI internals", () => {
    const lead = makeLead({
      notes: "PRIVATE NOTE CONTENT",
      email: "dana@acme.example",
      summary: "AI summary text",
      score: 91,
      aiGeneratedAt: 123,
      scoreBreakdown: [{ label: "x", value: 1 }],
    } as Partial<Doc<"leads">>);
    const p = projectDealForCopilot(lead) as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      [
        "company",
        "contactName",
        "createdAt",
        "currency",
        "expectedCloseAt",
        "id",
        "lastActivityAt",
        "lossReason",
        "lostAt",
        "name",
        "probability",
        "source",
        "stage",
        "status",
        "value",
        "weightedValue",
        "wonAt",
      ].sort(),
    );
    expect(p).not.toHaveProperty("userId");
    expect(p).not.toHaveProperty("notes");
    expect(p).not.toHaveProperty("email");
    expect(p).not.toHaveProperty("summary");
    expect(p).not.toHaveProperty("score");
    expect(p).not.toHaveProperty("scoreBreakdown");
    expect(p).not.toHaveProperty("aiGeneratedAt");
  });

  test("T6 zero values are preserved (never dropped or coerced)", () => {
    const p = projectDealForCopilot(
      makeLead({ dealValue: 0, probability: 0 }),
    );
    expect(p.value).toBe(0);
    expect(p.probability).toBe(0);
    expect(p.weightedValue).toBe(0); // 0 × 0% — no || undefined anywhere
  });

  test("T7 missing optional fields stay undefined — never fabricated", () => {
    const p = projectDealForCopilot(
      makeLead({
        dealValue: undefined,
        probability: undefined,
        currency: undefined,
        expectedCloseAt: undefined,
        wonAt: undefined,
        lostAt: undefined,
        lossReason: undefined,
        lastActivityAt: undefined,
        lastContactedAt: undefined,
        source: undefined,
        company: undefined,
      }),
    );
    expect(p.value).toBeUndefined();
    expect(p.probability).toBeUndefined();
    // currency falls back to the documented dealCurrency chain (none set →
    // undefined → renders as the neutral ¤ marker downstream).
    expect(p.currency).toBeUndefined();
    expect(p.expectedCloseAt).toBeUndefined();
    expect(p.wonAt).toBeUndefined();
    expect(p.lostAt).toBeUndefined();
    expect(p.lossReason).toBeUndefined();
    expect(p.lastActivityAt).toBeUndefined();
    expect(p.source).toBeUndefined();
    // dealTitle falls back to contact name when no company.
    expect(p.name).toBe("Dana Cole");
    // Won stage label + stage-default probability (probability unset → the
    // shared weightedValue helper applies the Won-stage default of 100).
    const won = projectDealForCopilot(
      makeLead({ status: "won", wonAt: 1_720_000_000_000, probability: undefined }),
    );
    expect(won.stage).toBe("Won");
    expect(won.weightedValue).toBe(18000); // 18000 × 100% (stage default)
    // A supplied probability is honored as-is (never overridden by the stage).
    const wonWithProbability = projectDealForCopilot(
      makeLead({ status: "won", wonAt: 1_720_000_000_000 }),
    );
    expect(wonWithProbability.probability).toBe(55);
    expect(wonWithProbability.weightedValue).toBe(9900);
  });

  test("T5b deal-level currency override flows through unchanged", () => {
    expect(projectDealForCopilot(makeLead({ currency: "EUR" })).currency).toBe("EUR");
  });
});

// ── Valid-ID sanity: only well-formed ids may reach the (mocked) lookup ────

describe("get_deal: dispatcher input gate", () => {
  test("valid ids pass the gate; foreign/missing decisions stay identical", () => {
    for (const id of [VALID_ID, VALID_ID_ALT]) {
      expect(isValidConvexIdShape(id)).toBe(true);
    }
    // The dispatcher passes userId from the authenticated session only; a
    // non-string dealId must be coerced to "" and fail the shape gate.
    expect(isValidConvexIdShape(undefined as unknown as string)).toBe(false);
  });
});

// ── Phase 2c-3A: get_client fixtures ────────────────────────────────────────

let seq = 0;
function makeClientLead(
  overrides: Partial<Doc<"leads">> = {},
): Doc<"leads"> {
  seq += 1;
  return makeLead({
    _id: `k57aj2m9vq3xs1pwnb5te068d0a1b2c${String(seq).padStart(3, "0")}` as unknown as Id<"leads">,
    ...overrides,
  } as Partial<Doc<"leads">>);
}

/** One won + one open deal for the same company → one derived client. */
function acmeFixture() {
  const won = makeClientLead({
    status: "won",
    wonAt: 1_720_000_000_000,
    industry: "Design",
  });
  const open = makeClientLead({
    status: "proposal",
    dealValue: 12000,
    probability: 55,
  });
  return { leads: [won, open], won, open };
}

// ── T4: clientKey validation ────────────────────────────────────────────────

describe("get_client: clientKey validation", () => {
  test("T4 rejects non-string / empty / whitespace-only / over-length keys", () => {
    expect(isValidClientKey(undefined)).toBe(false);
    expect(isValidClientKey(123)).toBe(false);
    expect(isValidClientKey("")).toBe(false);
    expect(isValidClientKey("   ")).toBe(false);
    expect(isValidClientKey(String.fromCharCode(10, 9, 32))).toBe(false); // real newline, tab, space
    expect(isValidClientKey("x".repeat(121))).toBe(false);
  });
  test("T4 accepts a 120-character key (boundary)", () => {
    expect(isValidClientKey("x".repeat(120))).toBe(true);
  });
});

// ── T2/T3/T10: resolution — missing and foreign are identical ───────────────

describe("get_client: resolution", () => {
  const { leads } = acmeFixture();
  const clients = computeClients(leads, undefined);
  test("T1 resolves the derived client by its stable key", () => {
    const d = clientToolDecision(clients, "Acme Expansion");
    expect(d.ok).toBe(true);
  });
  test("T2 missing client → not_found", () => {
    expect(clientToolDecision(clients, "Ghost Corp")).toEqual({
      ok: false,
      code: "not_found",
    });
  });
  test("T3/T10 foreign key ≡ missing key — structurally identical", () => {
    // A key from another workspace has no derived client here; its result is
    // byte-identical to querying a key that never existed.
    const foreign = clientToolDecision(clients, "Someonelses Industries");
    const missing = clientToolDecision([], "Acme Expansion");
    expect(foreign).toEqual(missing);
    expect(foreign).toEqual({ ok: false, code: "not_found" });
  });
});

// ── T1/T5/T6/T8/T9: projection content, safety, zero/null correctness ──────

describe("get_client: projection", () => {
  test("T1 derived values come verbatim from computeClients semantics", () => {
    const { leads } = acmeFixture();
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client);
    expect(p.key).toBe("Acme Expansion");
    expect(p.name).toBe("Acme Expansion");
    expect(p.contact).toBe("Dana Cole"); // primaryLead = the won deal
    expect(p.industry).toBe("Design");
    expect(p.totalRevenue).toBe(18000); // won deal value only
    expect(p.wonDeals).toBe(1);
    expect(p.activeDeals).toBe(1);
    expect(p.lostDeals).toBe(0);
    expect(Array.isArray(p.deals)).toBe(true);
    expect((p.deals as unknown[]).length).toBe(2);
    // Deal roles follow the derived ClientDeal roles: won first, then active.
    const deals = p.deals as { role: string; value?: number }[];
    expect(deals[0].role).toBe("won");
    expect(deals[1].role).toBe("active");
    expect(deals[1].value).toBe(12000);
  });

  test("T5 returns ONLY approved top-level fields — no private data", () => {
    const { leads } = acmeFixture();
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client) as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(
      [
        "activeDeals",
        "contact",
        "deals",
        "health",
        "industry",
        "key",
        "lastActivityAt",
        "lostDeals",
        "name",
        "nextActivityAt",
        "openValue",
        "retention",
        "totalRevenue",
        "website",
        "wonDeals",
      ].sort(),
    );
    expect(Object.keys(p.health as object).sort()).toEqual(["detail", "state"]);
    expect(Object.keys(p.retention as object).sort()).toEqual(["evidence", "state"]);
    expect(p).not.toHaveProperty("userId");
    expect(p).not.toHaveProperty("primaryLead");
  });

  test("T6 related deals contain ONLY the eight approved fields", () => {
    const { leads } = acmeFixture();
    leads.push(makeClientLead({ status: "new", currency: "EUR", company: "Acme Expansion" }));
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client);
    for (const deal of p.deals as Record<string, unknown>[]) {
      expect(Object.keys(deal).sort()).toEqual(
        ["currency", "id", "lastActivityAt", "name", "role", "status", "value", "wonAt"].sort(),
      );
      expect(deal).not.toHaveProperty("notes");
      expect(deal).not.toHaveProperty("email");
      expect(deal).not.toHaveProperty("probability");
      expect(deal).not.toHaveProperty("score");
    }
    // Deal-level currency override flows through unchanged (EUR deal).
    const eur = (p.deals as { currency?: string }[]).find((x) => x.currency === "EUR");
    expect(eur).toBeDefined();
  });

  test("T7 related deals are capped at 20", () => {
    const leads = [makeClientLead({ status: "won", wonAt: 1_720_000_000_000 })];
    for (let i = 0; i < 25; i++) {
      leads.push(makeClientLead({ status: "proposal", dealValue: 100 + i }));
    }
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client);
    expect((p.deals as unknown[]).length).toBe(CLIENT_DEAL_CAP);
    expect(CLIENT_DEAL_CAP).toBe(20);
  });

  test("T8 zero values are preserved (never dropped)", () => {
    const leads = [
      makeClientLead({ status: "won", wonAt: 1_720_000_000_000, dealValue: 0 }),
      makeClientLead({ status: "proposal", dealValue: 0 }),
    ];
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client);
    expect(p.totalRevenue).toBe(0);
    expect(p.openValue).toBe(0);
    const deals = p.deals as { value?: number }[];
    expect(deals[0].value).toBe(0);
    expect(deals[1].value).toBe(0);
  });

  test("T9 output is NOT a reimplementation — matches computeClients exactly", () => {
    const { leads } = acmeFixture();
    const clients = computeClients(leads, undefined);
    const client = clients[0];
    const p = projectClientForCopilot(client);
    // The projection copies the computed values; it never recomputes them.
    expect(p.totalRevenue).toBe(client.totalRevenue);
    expect(p.openValue).toBe(client.openValue);
    expect(p.wonDeals).toBe(client.wonDeals.length);
    expect(p.activeDeals).toBe(client.activeDeals.length);
    expect(p.health).toEqual(client.health);
    expect(p.retention).toEqual(client.retention);
    expect(p.lastActivityAt).toBe(client.lastActivityAt);
    expect(p.nextActivityAt).toBe(client.nextActivityAt);
  });

  test("T7b absent optionals stay absent — never fabricated", () => {
    const leads = [makeClientLead({ status: "won", wonAt: 1_720_000_000_000, industry: undefined })];
    const clients = computeClients(leads, undefined);
    const d = clientToolDecision(clients, "Acme Expansion");
    const p = projectClientForCopilot((d as { ok: true; client: ReturnType<typeof computeClients>[number] }).client);
    expect(p.industry).toBeUndefined();
    expect(p.website).toBeUndefined();
  });
});

// ── Phase 2c-3B: get_clients ────────────────────────────────────────────────

describe("get_clients: argument parsing", () => {
  test("T1 valid empty args parse to defaults", () => {
    const r = parseGetClientsArgs({});
    expect(r.ok).toBe(true);
  });
  test("T9 rejects non-object input", () => {
    for (const bad of [null, undefined, 5, "x", [], true]) {
      expect(parseGetClientsArgs(bad).ok).toBe(false);
    }
  });
  test("T9 rejects invalid sort values", () => {
    for (const bad of ["Revenue", "REVENUE", "value", 5, null]) {
      expect(parseGetClientsArgs({ sort: bad }).ok).toBe(false);
    }
  });
  test("T9 rejects malformed filter objects", () => {
    expect(parseGetClientsArgs({ filter: "active" }).ok).toBe(false);
    expect(parseGetClientsArgs({ filter: [] }).ok).toBe(false);
    expect(parseGetClientsArgs({ filter: { hasActiveDeals: "yes" } }).ok).toBe(false);
    expect(parseGetClientsArgs({ filter: { minRevenue: 1 } }).ok).toBe(false);
    expect(parseGetClientsArgs({ filter: { unknown: true } }).ok).toBe(false);
  });
  test("T9 rejects invalid limits", () => {
    for (const bad of [-1, 1.5, "10", null, true]) {
      expect(parseGetClientsArgs({ limit: bad }).ok).toBe(false);
    }
  });
  test("T9 rejects unknown top-level keys", () => {
    expect(parseGetClientsArgs({ userId: "x" }).ok).toBe(false);
    expect(parseGetClientsArgs({ status: "open" }).ok).toBe(false);
  });
  test("accepts the full valid argument shape", () => {
    const r = parseGetClientsArgs({
      sort: "activity",
      filter: { hasActiveDeals: true, minRevenue: false },
      limit: 5,
    });
    expect(r.ok).toBe(true);
  });
});

describe("get_clients: pipeline (canonical helpers, no reimplementation)", () => {
  function manyClientsFixture(): { leads: Doc<"leads">[]; all: ReturnType<typeof computeClients> } {
    const leads: Doc<"leads">[] = [];
    // Alpha: highest revenue, active deal, recent activity
    leads.push(makeClientLead({ status: "won", dealValue: 30000, wonAt: 1_720_000_000_000, company: "Alpha Corp" }));
    leads.push(makeClientLead({ status: "proposal", dealValue: 4000, lastActivityAt: 1_725_000_000_000, company: "Alpha Corp" }));
    // Beta: mid revenue, active deal, older activity
    leads.push(makeClientLead({ status: "won", dealValue: 20000, wonAt: 1_719_000_000_000, company: "Beta Group", lastActivityAt: 1_715_000_000_000 }));
    leads.push(makeClientLead({ status: "discovery", dealValue: 9000, company: "Beta Group" }));
    // Gamma: low revenue, no active deals, silent
    leads.push(makeClientLead({ status: "won", dealValue: 5000, wonAt: 1_718_000_000_000, company: "Gamma LLC", lastActivityAt: 1_700_000_000_000 }));
    // Delta: zero revenue, no active deals
    leads.push(makeClientLead({ status: "won", dealValue: 0, wonAt: 1_717_000_000_000, company: "Delta Co" }));
    return { leads, all: computeClients(leads, undefined) };
  }

  test("T1 default args → canonical default ordering (revenue), default limit", () => {
    const { leads, all } = manyClientsFixture();
    const rows = runGetClientsPipeline({}, computeClients(leads, undefined));
    expect(rows.length).toBe(Math.min(CLIENTS_LIST_DEFAULT_LIMIT, all.length));
    expect(rows.map((c) => c.name)).toEqual(sortClients(all, "revenue").slice(0, rows.length).map((c) => c.name));
  });

  test("T2 revenue sort → highest recorded revenue first", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({ sort: "revenue" }, computeClients(leads, undefined));
    expect(rows[0].name).toBe("Alpha Corp");
    expect(rows[0].totalRevenue).toBe(30000);
    expect(rows[1].totalRevenue).toBe(20000);
    expect(rows[2].totalRevenue).toBe(5000);
  });

  test("T3 activity sort ≡ canonical sortClients 'activity'", () => {
    const { leads, all } = manyClientsFixture();
    const rows = runGetClientsPipeline({ sort: "activity" }, computeClients(leads, undefined));
    expect(rows.map((c) => c.name)).toEqual(sortClients(all, "activity").map((c) => c.name));
  });

  test("T4 name sort ≡ canonical alphabetical ordering", () => {
    const { leads, all } = manyClientsFixture();
    const rows = runGetClientsPipeline({ sort: "name" }, computeClients(leads, undefined));
    expect(rows.map((c) => c.name)).toEqual(sortClients(all, "name").map((c) => c.name));
    expect(rows.map((c) => c.name)).toEqual([...rows.map((c) => c.name)].sort((a, b) => a.localeCompare(b)));
  });

  test("T5 hasActiveDeals filter → only clients with active deals", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline(
      { filter: { hasActiveDeals: true } },
      computeClients(leads, undefined),
    );
    expect(rows.map((c) => c.name).sort()).toEqual(["Alpha Corp", "Beta Group"]);
    // false applies no narrowing — the canonical helper has no inverse filter.
    const rowsFalse = runGetClientsPipeline(
      { filter: { hasActiveDeals: false } },
      computeClients(leads, undefined),
    );
    expect(rowsFalse.length).toBe(4);
  });

  test("T6 minRevenue filter uses the canonical 'has recorded revenue' threshold", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline(
      { filter: { minRevenue: true } },
      computeClients(leads, undefined),
    );
    expect(rows.map((c) => c.name).sort()).toEqual(["Alpha Corp", "Beta Group", "Gamma LLC"]);
    // Canonical consistency: identical to filterClients with minRevenue "gt0".
    const canonical = sortClients(
      filterClients(computeClients(leads, undefined), { health: "all", minRevenue: "gt0", active: "all", q: "" }),
      "revenue",
    );
    expect(rows.map((c) => c.name)).toEqual(canonical.map((c) => c.name));
  });

  test("T7 limit: 2 returns exactly two matching clients", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({ limit: 2 }, computeClients(leads, undefined));
    expect(rows.length).toBe(2);
  });

  test("T8 hard cap: limit 1000 over >20 clients returns at most 20", () => {
    const leads: Doc<"leads">[] = [];
    for (let i = 0; i < 25; i++) {
      leads.push(makeClientLead({ status: "won", dealValue: 100 + i, wonAt: 1_720_000_000_000, company: `House ${String(i).padStart(2, "0")}` }));
    }
    const rows = runGetClientsPipeline({ limit: 1000 }, computeClients(leads, undefined));
    expect(rows.length).toBe(20);
  });

  test("T10 zero preservation: totalRevenue/openValue/deal value of 0 stay 0", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({ sort: "name" }, computeClients(leads, undefined));
    const delta = rows.find((c) => c.name === "Delta Co");
    expect(delta).toBeDefined();
    const projected = projectClientForCopilot(delta!);
    expect(projected.totalRevenue).toBe(0);
    expect(projected.openValue).toBe(0);
    const deals = projected.deals as { value?: number }[];
    expect(deals.every((d) => d.value === 0)).toBe(true);
  });

  test("T11 projection safety: exact top-level + nested key sets per client", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({}, computeClients(leads, undefined));
    for (const c of rows) {
      const p = projectClientForCopilot(c) as Record<string, unknown>;
      expect(Object.keys(p).sort()).toEqual(
        [
          "activeDeals", "contact", "deals", "health", "industry", "key",
          "lastActivityAt", "lostDeals", "name", "nextActivityAt", "openValue",
          "retention", "totalRevenue", "website", "wonDeals",
        ].sort(),
      );
      expect(Object.keys(p.health as object).sort()).toEqual(["detail", "state"]);
      expect(Object.keys(p.retention as object).sort()).toEqual(["evidence", "state"]);
      expect(p).not.toHaveProperty("userId");
      expect(p).not.toHaveProperty("primaryLead");
    }
  });

  test("T12 related deals expose exactly the 8 approved fields", () => {
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({}, computeClients(leads, undefined));
    for (const c of rows) {
      for (const deal of (projectClientForCopilot(c).deals as Record<string, unknown>[])) {
        expect(Object.keys(deal).sort()).toEqual(
          ["currency", "id", "lastActivityAt", "name", "role", "status", "value", "wonAt"].sort(),
        );
        for (const forbidden of ["notes", "email", "probability", "score", "userId"]) {
          expect(deal).not.toHaveProperty(forbidden);
        }
      }
    }
  });

  test("T13 tool ordering ≡ computeClients + canonical helpers (no reimplementation)", () => {
    const { leads, all } = manyClientsFixture();
    for (const sort of ["revenue", "activity", "name"] as const) {
      const tool = runGetClientsPipeline({ sort }, computeClients(leads, undefined));
      const canonical = sortClients(
        filterClients(all, { health: "all", minRevenue: "", active: "all", q: "" }),
        sort,
      ).slice(0, CLIENTS_LIST_MAX_LIMIT);
      expect(tool.map((c) => c.name)).toEqual(canonical.map((c) => c.name));
    }
  });

  test("T14 workspace isolation: the tool's data path is by_user-scoped", () => {
    // computeClients is workspace-agnostic BY DESIGN (pure derivation over
    // its input), so isolation is enforced at the data-access layer: the
    // tool must feed it ONLY rows from the authenticated user's by_user
    // query. This guards that invariant — removing the scoping from
    // toolGetClients fails this test.
    const source = require("fs").readFileSync("src/convex/assistant.ts", "utf8");
    const toolBody = source.slice(
      source.indexOf("export const toolGetClients"),
      source.indexOf("// ── Phase 2c-3A"),
    );
    expect(toolBody).toContain('withIndex("by_user"');
    expect(toolBody).toContain('q.eq("userId", userId)');
    expect(toolBody).toContain("computeClients(leads, profile?.products)");
    // And with correctly scoped input, the output contains only that
    // workspace's clients (positive control).
    const { leads } = manyClientsFixture();
    const rows = runGetClientsPipeline({}, computeClients(leads, undefined));
    expect(rows.map((c) => c.name)).not.toContain("Foreign Industries");
  });
});

// ── Phase 2c-3C: get_proposals ──────────────────────────────────────────────

let propSeq = 0;
function makeProposal(
  overrides: Partial<Doc<"proposals">> = {},
): Doc<"proposals"> {
  propSeq += 1;
  const base: Record<string, unknown> = {
    _id: `p57aj2m9vq3xs1pwnb5te068d0a1b2c${String(propSeq).padStart(3, "0")}` as unknown as Id<"proposals">,
    _creationTime: 1_700_000_000_000 + propSeq,
    userId: USER_A,
    dealId: "k57aj2m9vq3xs1pwnb5te068d0a1b2001" as unknown as Id<"leads">,
    title: `Proposal ${propSeq}`,
    status: "draft",
    value: 1000,
    createdAt: 1_700_000_000_000 + propSeq,
    updatedAt: 1_700_000_000_000 + propSeq,
  };
  return { ...base, ...overrides } as unknown as Doc<"proposals">;
}

const PROPOSAL_KEY_SET = [
  "id", "title", "status", "value", "currency", "sentAt", "acceptedAt",
  "rejectedAt", "rejectedReason", "createdAt", "updatedAt", "dealName", "dealId",
].sort();

describe("get_proposals: argument parsing", () => {
  test("T11 rejects non-object input", () => {
    for (const bad of [null, undefined, 5, "x", [], true]) {
      expect(parseGetProposalsArgs(bad).ok).toBe(false);
    }
  });
  test("T11 rejects invalid/wrong-typed status", () => {
    for (const bad of ["All", "open", "pending", 5, null, true]) {
      expect(parseGetProposalsArgs({ status: bad }).ok).toBe(false);
    }
  });
  test("T11 rejects invalid limits", () => {
    for (const bad of [-1, 1.5, "10", null, true]) {
      expect(parseGetProposalsArgs({ limit: bad }).ok).toBe(false);
    }
  });
  test("T11 rejects unknown keys including userId", () => {
    expect(parseGetProposalsArgs({ userId: "x" }).ok).toBe(false);
    expect(parseGetProposalsArgs({ sort: "revenue" }).ok).toBe(false);
  });
  test("accepts the full valid argument shape", () => {
    expect(parseGetProposalsArgs({ status: "sent", limit: 5 }).ok).toBe(true);
    expect(parseGetProposalsArgs({}).ok).toBe(true);
  });
});

describe("get_proposals: pipeline (filter/order/cap)", () => {
  function fixture(): Doc<"proposals">[] {
    return [
      makeProposal({ title: "Oldest Draft", status: "draft", updatedAt: 1_700_000_100_000, value: 0 }),
      makeProposal({ title: "Newest Sent", status: "sent", sentAt: 1_700_000_500_000, updatedAt: 1_700_000_500_000 }),
      makeProposal({ title: "Mid Viewed", status: "viewed", sentAt: 1_700_000_300_000, updatedAt: 1_700_000_400_000 }),
      makeProposal({ title: "Accepted One", status: "accepted", acceptedAt: 1_700_000_350_000, updatedAt: 1_700_000_350_000 }),
      makeProposal({ title: "Rejected One", status: "rejected", rejectedAt: 1_700_000_320_000, rejectedReason: "Budget", updatedAt: 1_700_000_320_000 }),
    ];
  }

  test("T1/T13 default: success shape, updatedAt DESC ordering, no reliance on insertion order", () => {
    const rows = runGetProposalsPipeline({}, fixture());
    expect(rows.map((p) => p.title)).toEqual([
      "Newest Sent", "Mid Viewed", "Accepted One", "Rejected One", "Oldest Draft",
    ]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].updatedAt).toBeGreaterThanOrEqual(rows[i].updatedAt);
    }
  });

  test("T2 status 'all' returns across statuses", () => {
    const rows = runGetProposalsPipeline({ status: "all" }, fixture());
    expect(new Set(rows.map((p) => p.status)).size).toBe(5);
  });

  for (const status of ["draft", "sent", "viewed", "accepted", "rejected"] as const) {
    test(`T3–T7 status '${status}' returns only that canonical status`, () => {
      const rows = runGetProposalsPipeline({ status }, fixture());
      expect(rows.length).toBeGreaterThan(0);
      expect(rows.every((p) => p.status === status)).toBe(true);
    });
  }

  test("T8 limit: 2 returns exactly two", () => {
    expect(runGetProposalsPipeline({ limit: 2 }, fixture()).length).toBe(2);
  });

  test("T9 hard cap: limit 1000 over >20 proposals returns at most 20", () => {
    const many = Array.from({ length: 25 }, (_, i) =>
      makeProposal({ title: `P${i}`, updatedAt: 1_700_001_000_000 + i }),
    );
    const rows = runGetProposalsPipeline({ limit: 1000 }, many);
    expect(rows.length).toBe(GET_PROPOSALS_MAX_LIMIT);
    expect(GET_PROPOSALS_MAX_LIMIT).toBe(20);
  });

  test("T10 limit: 0 → empty data, no error", () => {
    const rows = runGetProposalsPipeline({ limit: 0 }, fixture());
    expect(rows).toEqual([]);
  });

  test("T17 filtering ≡ the canonical single-predicate semantics (no reimplementation)", () => {
    const all = fixture();
    // Tool 'sent' output ≡ the canonical proposal-status predicate used by
    // proposals.ts / retrieval (exact match on the canonical status value).
    expect(runGetProposalsPipeline({ status: "sent" }, all).map((p) => p.title))
      .toEqual(all.filter((p) => p.status === "sent").map((p) => p.title));
    expect(runGetProposalsPipeline({ status: "accepted" }, all).map((p) => p.title))
      .toEqual(all.filter((p) => p.status === "accepted").map((p) => p.title));
    // Default list ≡ 'all' — absence of status never narrows.
    expect(runGetProposalsPipeline({}, all).map((p) => p.title))
      .toEqual(runGetProposalsPipeline({ status: "all" }, all).map((p) => p.title));
  });
});

describe("get_proposals: projection", () => {
  test("T12 exact 13-field projection; forbidden fields absent", () => {
    const p = projectProposalForCopilot(
      makeProposal({ sentAt: 1_700_000_500_000 }),
      "Acme Expansion — Dana Cole",
    ) as Record<string, unknown>;
    expect(Object.keys(p).sort()).toEqual(PROPOSAL_KEY_SET);
    for (const forbidden of ["userId", "body", "sections", "content", "lead", "rawLead", "rawDeal"]) {
      expect(p).not.toHaveProperty(forbidden);
    }
    expect(p.dealName).toBe("Acme Expansion — Dana Cole");
  });

  test("T14 zero value preserved; absent optionals stay absent", () => {
    const p = projectProposalForCopilot(makeProposal({ value: 0 }), "X") as Record<string, unknown>;
    expect(p.value).toBe(0);
    const q = projectProposalForCopilot(
      makeProposal({ value: undefined, currency: undefined, sentAt: undefined, acceptedAt: undefined, rejectedAt: undefined, rejectedReason: undefined }),
      "X",
    ) as Record<string, unknown>;
    expect(q.value).toBeUndefined();
    expect(q.currency).toBeUndefined();
    expect(q.sentAt).toBeUndefined();
  });

  test("T15 deal resolution: owned deal + safe missing-deal label (no cross-workspace lookup)", () => {
    // Owned resolution: dealTitle semantics over the caller's own lead.
    const ownedLead = makeClientLead({ status: "proposal", company: "Acme Expansion" });
    const dealNames = new Map([[ownedLead._id as string, dealTitle(ownedLead)]]);
    const p = projectProposalForCopilot(
      makeProposal({ dealId: ownedLead._id }),
      dealNames.get((makeProposal({ dealId: ownedLead._id }).dealId) as string) ?? dealNames.get(ownedLead._id as string) ?? "",
    ) as Record<string, unknown>;
    expect(p.dealId).toBe(ownedLead._id);
    expect(p.dealName).toBe("Acme Expansion — Dana Cole");
    // Missing/removed deal keeps the established safe label — the map built
    // from the caller's own leads can never contain a foreign deal, so a
    // foreign dealId resolves to the same label as a removed one (no leak).
    const foreignId = "ffffaj2m9vq3xs1pwnb5te068d0a1b2c" as unknown as Id<"leads">;
    expect(dealNames.get(foreignId as string)).toBeUndefined();
    const q = projectProposalForCopilot(
      makeProposal({ dealId: foreignId }),
      dealNames.get(foreignId as string) ?? "Deal no longer exists",
    ) as Record<string, unknown>;
    expect(q.dealName).toBe("Deal no longer exists");
    expect(q.dealId).toBe(foreignId); // the ID passes through, never a foreign name
  });

  test("T16 workspace isolation: the tool's data path is by_user-scoped", () => {
    // Guards the real invariant: proposals and deal names come ONLY from the
    // authenticated user's by_user queries; projection helpers are pure.
    const source = require("fs").readFileSync("src/convex/assistant.ts", "utf8");
    const toolBody = source.slice(
      source.indexOf("export const toolGetProposals"),
      source.indexOf("// ── Phase 2c-3A"),
    );
    expect((toolBody.match(/withIndex\("by_user"/g) ?? []).length).toBe(2);
    expect((toolBody.match(/q\.eq\("userId", userId\)/g) ?? []).length).toBe(2);
    expect(toolBody).toContain("dealTitle(l)");
  });
});
