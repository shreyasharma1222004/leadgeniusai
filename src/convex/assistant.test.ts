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
  CLIENT_DEAL_CAP,
  clientToolDecision,
  dealToolDecision,
  isValidClientKey,
  isValidConvexIdShape,
  projectClientForCopilot,
  projectDealForCopilot,
} from "./assistant";
import { computeClients } from "../lib/clients";
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
