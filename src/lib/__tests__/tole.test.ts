import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "node:crypto";

// ── Fake Supabase (only what the Tole paths touch) ───────────────────────────
const db = {
  inserts: [] as unknown[],
  insertError: null as null | { code: string },
  rpcCalls: [] as unknown[],
  payment: { amount_kzt: 1990, currency: "KZT" } as Record<string, unknown> | null,
};
function builder() {
  const b: Record<string, unknown> = {};
  const chain = () => b;
  Object.assign(b, {
    select: chain, eq: chain, order: chain, limit: chain, delete: chain,
    update: () => b,
    insert: (row: unknown) => { db.inserts.push(row); return Promise.resolve({ error: db.insertError }); },
    maybeSingle: () => Promise.resolve({ data: db.payment }),
    single: () => Promise.resolve({ data: { order_id: "o1" } }),
    then: (r: (v: unknown) => void) => r({ error: null }),
  });
  return b;
}
vi.mock("@/lib/supabase/server", () => ({
  supabaseAdmin: () => ({
    from: () => builder(),
    rpc: (name: string, args: unknown) => { db.rpcCalls.push({ name, args }); return Promise.resolve({ data: "applied", error: null }); },
  }),
}));
vi.mock("@/lib/analytics", () => ({ track: async () => {} }));

import { ToleClient, ToleError, verifyToleSignature, WEBHOOK_TOLERANCE_SEC } from "../payments/tole/client";
import { toleSandboxProvider } from "../payments/tole/provider";
import { handlePaymentWebhook } from "../payments/process";
import { normalizeKzPhone } from "../payments/phone";

const BASE = "https://api.tolepay.kz/v1";
const CONN = "11111111-2222-4333-8444-555555555555";
const SECRET = "whsec_unit_test_secret_0123456789";
const PHONE = "+77001234567";

type Call = { url: string; method: string; headers: Headers; body: unknown };
function mockFetch(responses: Array<{ status: number; body?: unknown; headers?: Record<string, string> } | Error>) {
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    calls.push({ url, method: init.method ?? "GET", headers: new Headers(init.headers), body: init.body ? JSON.parse(String(init.body)) : null });
    const r = responses.shift();
    if (!r) throw new Error("no more responses");
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status: r.status, headers: r.headers });
  });
  return { fn: fn as unknown as typeof fetch, calls };
}
const client = (f: typeof fetch, mode: "live" | "sandbox" = "sandbox") =>
  new ToleClient({ baseUrl: BASE, apiKey: "tole_sk_test_unit_only", connectionId: CONN, mode }, f);
const invoice201 = { ok: true, data: { id: "pi-1", kind: "invoice", status: "created", amount: 1990, clientPhoneLast4: "4567" }, commandId: "cmd-1", replayed: false };
const timeoutErr = () => Object.assign(new Error("timeout"), { name: "TimeoutError" });

beforeEach(() => { db.inserts = []; db.insertError = null; db.rpcCalls = []; db.payment = { amount_kzt: 1990, currency: "KZT" }; });
afterEach(() => vi.unstubAllGlobals());

describe("Tole client — invoices", () => {
  it("201: creates a Kaspi invoice with auth, connection and stable idempotency headers", async () => {
    const m = mockFetch([{ status: 201, body: invoice201 }]);
    const out = await client(m.fn).createInvoice(PHONE, 1990, "TrendMe TV-1", "order-1:pay-1");
    expect(out).toEqual({ kind: "done", commandId: "cmd-1", replayed: false, data: { id: "pi-1", status: "created", amount: 1990, clientPhoneLast4: "4567" } });
    const c = m.calls[0];
    expect(c.url).toBe(`${BASE}/sandbox/invoices`);
    expect(c.method).toBe("POST");
    expect(c.headers.get("authorization")).toBe("Bearer tole_sk_test_unit_only");
    expect(c.headers.get("content-type")).toBe("application/json");
    expect(c.headers.get("x-tole-connection-id")).toBe(CONN);
    expect(c.headers.get("idempotency-key")).toBe("order-1:pay-1");
    expect(c.body).toEqual({ phoneNumber: PHONE, amount: 1990, comment: "TrendMe TV-1" });
  });

  it("live mode uses live routes", async () => {
    const m = mockFetch([{ status: 201, body: invoice201 }]);
    await client(m.fn, "live").createInvoice(PHONE, 1990, "x", "k1");
    expect(m.calls[0].url).toBe(`${BASE}/invoices`);
  });

  it("local validation: bad phone / amount / idempotency key never hit the network", async () => {
    const m = mockFetch([]);
    const c = client(m.fn);
    expect(() => c.createInvoice("87001234567", 1990, "x", "k")).toThrow(ToleError);
    expect(() => c.createInvoice(PHONE, 0, "x", "k")).toThrow(ToleError);
    await expect(c.createInvoice(PHONE, 1990, "x", "bad key with spaces")).rejects.toMatchObject({ code: "LOCAL_BAD_IDEMPOTENCY_KEY" });
    expect(m.calls).toHaveLength(0);
  });

  it("400 validation error is thrown once, with Tole's error code", async () => {
    const m = mockFetch([{ status: 400, body: { statusCode: 400, code: "VALIDATION_ERROR", message: "x" } }]);
    await expect(client(m.fn).createInvoice(PHONE, 1990, "x", "k")).rejects.toMatchObject({ kind: "validation", httpStatus: 400, code: "VALIDATION_ERROR" });
    expect(m.calls).toHaveLength(1);
  });

  it("401 / 403 map to auth / forbidden and are not retried", async () => {
    let m = mockFetch([{ status: 401, body: { code: "UNAUTHORIZED" } }]);
    await expect(client(m.fn).createInvoice(PHONE, 1990, "x", "k")).rejects.toMatchObject({ kind: "auth" });
    m = mockFetch([{ status: 403, body: { code: "FORBIDDEN" } }]);
    await expect(client(m.fn).read("/commands/c")).rejects.toMatchObject({ kind: "forbidden" });
    expect(m.calls).toHaveLength(1);
  });

  it("409 idempotency conflict is surfaced, not retried", async () => {
    const m = mockFetch([{ status: 409, body: { statusCode: 409, code: "PUBLIC_API_IDEMPOTENCY_CONFLICT", message: "x" } }]);
    await expect(client(m.fn).createInvoice(PHONE, 1990, "x", "k")).rejects.toMatchObject({ kind: "conflict", code: "PUBLIC_API_IDEMPOTENCY_CONFLICT" });
    expect(m.calls).toHaveLength(1);
  });

  it("429: reads honour Retry-After and retry; mutations do not", async () => {
    let m = mockFetch([
      { status: 429, body: { code: "RATE_LIMIT_EXCEEDED" }, headers: { "Retry-After": "0" } },
      { status: 200, body: { ok: true, data: { commandId: "c", status: "succeeded", responseStatus: 201, result: invoice201 } } },
    ]);
    expect((await client(m.fn).getCommand("c")).state).toBe("succeeded");
    expect(m.calls).toHaveLength(2);

    m = mockFetch([{ status: 429, body: { code: "RATE_LIMIT_EXCEEDED" }, headers: { "Retry-After": "7" } }]);
    await expect(client(m.fn).createInvoice(PHONE, 1990, "x", "k")).rejects.toMatchObject({ kind: "rate_limited", retryAfterSec: 7 });
    expect(m.calls).toHaveLength(1);
  });

  it("202 in_progress: returns command + Retry-After/Location, then polling yields the invoice", async () => {
    const m = mockFetch([
      { status: 202, body: { ok: false, kind: "in_progress", commandId: "cmd-9", replayed: true }, headers: { "Retry-After": "0", Location: "/v1/commands/cmd-9" } },
      { status: 200, body: { ok: true, data: { commandId: "cmd-9", status: "running" } } },
      { status: 200, body: { ok: true, data: { commandId: "cmd-9", status: "succeeded", responseStatus: 201, result: invoice201 } } },
    ]);
    const c = client(m.fn);
    const out = await c.createInvoice(PHONE, 1990, "x", "k");
    expect(out).toEqual({ kind: "in_progress", commandId: "cmd-9", retryAfterSec: 0, location: "/v1/commands/cmd-9" });
    const st = await c.awaitCommand("cmd-9", 0, 10_000);
    expect(st.state).toBe("succeeded");
    expect(m.calls.filter((x) => x.method === "POST")).toHaveLength(1);   // never re-posted
    expect(m.calls[1].url).toBe(`${BASE}/sandbox/commands/cmd-9`);
  });

  it("202 outcome_unknown is reported and never repeated", async () => {
    const m = mockFetch([{ status: 202, body: { ok: false, kind: "outcome_unknown", commandId: "cmd-u", replayed: false } }]);
    expect(await client(m.fn).createInvoice(PHONE, 1990, "x", "k")).toEqual({ kind: "outcome_unknown", commandId: "cmd-u" });
    expect(m.calls).toHaveLength(1);
  });

  it("timeout: a mutation is not retried; a read is retried with backoff, then gives up", async () => {
    let m = mockFetch([timeoutErr()]);
    await expect(client(m.fn).createInvoice(PHONE, 1990, "x", "k")).rejects.toMatchObject({ kind: "timeout" });
    expect(m.calls).toHaveLength(1);
    m = mockFetch([timeoutErr(), timeoutErr(), timeoutErr()]);
    await expect(client(m.fn).getCommand("c")).rejects.toMatchObject({ kind: "timeout" });
    expect(m.calls).toHaveLength(3);
  });

  it("failed command (responseStatus ≥ 400) is terminal", async () => {
    const m = mockFetch([{ status: 200, body: { ok: true, data: { commandId: "c", status: "failed", responseStatus: 502 } } }]);
    expect(await client(m.fn).getCommand("c")).toEqual({ state: "failed", responseStatus: 502 });
  });
});

describe("Tole provider createPayment (sandbox)", () => {
  const input = { paymentId: "pay-1", orderId: "order-1", orderNumber: "TV-1", amountKzt: 1990, description: "TrendMe TV-1", returnUrl: "x", idempotencyKey: "order-1:pay-1", customerPhone: PHONE };

  it("success → stores intent id, command id and phone last 4", async () => {
    const m = mockFetch([{ status: 201, body: invoice201 }]);
    vi.stubGlobal("fetch", m.fn);
    const r = await toleSandboxProvider.createPayment(input);
    expect(r).toMatchObject({ providerPaymentId: "pi-1", providerOperationId: "pi-1", providerCommandId: "cmd-1", phoneLast4: "4567", redirectUrl: "/checkout/tole/pay-1" });
  });

  it("outcome_unknown → pending reconciliation, not an error and not repeated", async () => {
    const m = mockFetch([{ status: 202, body: { ok: false, kind: "outcome_unknown", commandId: "cmd-u", replayed: false } }]);
    vi.stubGlobal("fetch", m.fn);
    expect(await toleSandboxProvider.createPayment(input)).toMatchObject({ providerCommandId: "cmd-u", providerOutcome: "outcome_unknown" });
    expect(m.calls).toHaveLength(1);
  });

  it("timeout → 'timeout' outcome (the customer's retry replays the same key)", async () => {
    const m = mockFetch([timeoutErr()]);
    vi.stubGlobal("fetch", m.fn);
    expect(await toleSandboxProvider.createPayment(input)).toMatchObject({ providerOutcome: "timeout" });
  });

  it("phone is required", async () => {
    await expect(toleSandboxProvider.createPayment({ ...input, customerPhone: undefined })).rejects.toMatchObject({ code: "LOCAL_PHONE_REQUIRED" });
  });
});

// ── Webhooks ─────────────────────────────────────────────────────────────────
function signed(body: string, opts: { id?: string; ts?: number; secret?: string } = {}) {
  const id = opts.id ?? "evt-1";
  const ts = String(opts.ts ?? Math.floor(Date.now() / 1000));
  const sig = createHmac("sha256", opts.secret ?? SECRET).update(`${id}.${ts}.${body}`).digest("hex");
  return new Headers({ "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1=${sig}` });
}
const paidBody = JSON.stringify({ id: "evt-1", type: "payment.paid", createdAt: "2026-10-22T00:00:00Z", data: { paymentIntentId: "pi-1", connectionId: CONN, providerStatus: "Processed" } });

describe("Tole webhook signature", () => {
  it("valid signature over the exact raw body", () => {
    expect(verifyToleSignature(paidBody, signed(paidBody), SECRET)).toMatchObject({ ok: true, webhookId: "evt-1" });
  });
  it("rejects wrong secret, tampered body, missing headers", () => {
    expect(verifyToleSignature(paidBody, signed(paidBody, { secret: "other_secret_value_123456" }), SECRET)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyToleSignature(paidBody + " ", signed(paidBody), SECRET)).toEqual({ ok: false, reason: "bad_signature" });
    expect(verifyToleSignature(paidBody, new Headers(), SECRET)).toEqual({ ok: false, reason: "missing_headers" });
  });
  it("rejects replayed (stale) and future timestamps", () => {
    const old = Math.floor(Date.now() / 1000) - WEBHOOK_TOLERANCE_SEC - 5;
    expect(verifyToleSignature(paidBody, signed(paidBody, { ts: old }), SECRET)).toEqual({ ok: false, reason: "stale" });
    const future = Math.floor(Date.now() / 1000) + WEBHOOK_TOLERANCE_SEC + 5;
    expect(verifyToleSignature(paidBody, signed(paidBody, { ts: future }), SECRET)).toEqual({ ok: false, reason: "stale" });
  });
  it("accepts any matching signature in a rotated list", () => {
    const h = signed(paidBody);
    h.set("webhook-signature", `v1=${"0".repeat(64)} ${h.get("webhook-signature")}`);
    expect(verifyToleSignature(paidBody, h, SECRET).ok).toBe(true);
  });
});

describe("Tole webhook processing", () => {
  it("payment.paid (sandbox) → succeeded with the payment's own amount, applied once", async () => {
    const out = await handlePaymentWebhook("tole_sandbox", paidBody, signed(paidBody));
    expect(out).toEqual({ http: 200, result: "applied" });
    expect(db.inserts[0]).toMatchObject({ provider: "tole_sandbox", event_id: "evt-1", event_type: "payment.paid" });
    expect(db.rpcCalls[0]).toMatchObject({ name: "apply_payment_event", args: { p_provider: "tole_sandbox", p_provider_payment_id: "pi-1", p_status: "succeeded", p_amount_kzt: 1990 } });
  });

  it("invalid signature → 401, nothing stored", async () => {
    const out = await handlePaymentWebhook("tole_sandbox", paidBody, signed(paidBody, { secret: "nope_nope_nope_nope_nope" }));
    expect(out.http).toBe(401);
    expect(db.inserts).toHaveLength(0);
  });

  it("duplicate webhook-id → acknowledged as duplicate, not applied again", async () => {
    db.insertError = { code: "23505" };
    expect(await handlePaymentWebhook("tole_sandbox", paidBody, signed(paidBody))).toEqual({ http: 200, result: "duplicate" });
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("informational events (payment.created) are stored and acknowledged without state change", async () => {
    const body = JSON.stringify({ id: "evt-2", type: "payment.created", createdAt: "x", data: { paymentIntentId: "pi-1" } });
    expect(await handlePaymentWebhook("tole_sandbox", body, signed(body, { id: "evt-2" }))).toEqual({ http: 200, result: "noop" });
    expect(db.inserts).toHaveLength(1);
    expect(db.rpcCalls).toHaveLength(0);
  });

  it("live: when the authoritative intent read fails, answer 503 so Tole redelivers", async () => {
    const out = await handlePaymentWebhook("tole", paidBody, signed(paidBody));
    expect(out).toEqual({ http: 503, result: "retry" });
    expect(db.inserts).toHaveLength(0);
  });
});

describe("phone normalisation", () => {
  it("accepts common Kazakh formats and rejects others", () => {
    expect(normalizeKzPhone("8 700 123 45 67")).toBe(PHONE);
    expect(normalizeKzPhone("+7 (700) 123-45-67")).toBe(PHONE);
    expect(normalizeKzPhone("7001234567")).toBe(PHONE);
    expect(normalizeKzPhone("+7 495 123 45 67")).toBeNull();
    expect(normalizeKzPhone("12345")).toBeNull();
  });
});
