import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { toleLog } from "./log";

/**
 * Typed Tole Payments client for Kaspi invoices (https://api.tolepay.kz/v1, OpenAPI 3.1 at /v1/openapi.json).
 *
 * Only fields documented by Tole are used:
 *   POST /invoices              {phoneNumber:"+7XXXXXXXXXX", amount, comment?≤200}
 *                               → 201 {ok, data:{id, kind:"invoice", status, amount, clientPhoneLast4, receiptUrl?, orderNumber?}, commandId, replayed}
 *   POST /invoices/{operationId}/cancel  {}  → 200
 *   GET  /payment-intents/invoices/{id}  → {ok, data:{id, kind, status, amount, currency, revision, …}}
 *   GET  /commands/{commandId}              → {ok, data:{commandId, status, responseStatus, result, updatedAt}}
 *   POST /sandbox/payment-intents/{id}/simulate {status} (sandbox only)
 *   202 → {ok:false, kind:"in_progress"|"outcome_unknown", commandId, replayed}  + Retry-After, Location
 *   errors → {statusCode, code, message}
 *
 * Rules: mutations are sent ONCE with a stable Idempotency-Key and never auto-repeated;
 * only safe reads are retried (exponential backoff, Retry-After honoured). Timeouts are bounded.
 */

export type ToleMode = "live" | "sandbox";
export type ToleConfig = { baseUrl: string; apiKey: string; connectionId?: string; mode: ToleMode };

export type ToleErrorKind =
  | "validation" | "auth" | "forbidden" | "billing" | "not_found" | "conflict" | "rate_limited"
  | "upstream" | "unavailable" | "internal" | "timeout" | "network" | "bad_response";

export class ToleError extends Error {
  constructor(
    public kind: ToleErrorKind,
    public httpStatus: number | null,
    public code: string | null,
    public retryAfterSec: number | null = null,
  ) {
    super(`tole ${kind}${httpStatus ? ` ${httpStatus}` : ""}${code ? ` ${code}` : ""}`);
  }
}

export type PaymentIntentStatus = "pending" | "paid" | "cancelled" | "expired" | "failed" | "partially_refunded" | "refunded";
const INTENT_STATUSES: PaymentIntentStatus[] = ["pending", "paid", "cancelled", "expired", "failed", "partially_refunded", "refunded"];

export type InvoiceCreated = {
  id: string;               // Tole's local UUID (operationId / payment intent)
  status: string;
  amount: number;
  clientPhoneLast4: string | null;
};

export const KZ_PHONE_RE = /^\+7\d{10}$/;

/** Result of a payment mutation. Only "done" carries data; others must be reconciled, never repeated. */
export type MutationOutcome<T> =
  | { kind: "done"; data: T; commandId: string | null; replayed: boolean }
  | { kind: "in_progress"; commandId: string; retryAfterSec: number | null; location: string | null }
  | { kind: "outcome_unknown"; commandId: string };

export type CommandState =
  | { state: "succeeded"; result: unknown }
  | { state: "failed"; responseStatus: number | null }
  | { state: "pending"; retryAfterSec: number | null };

const MUTATION_TIMEOUT_MS = 15_000;
const READ_TIMEOUT_MS = 8_000;
const READ_ATTEMPTS = 3;
const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function retryAfter(h: Headers): number | null {
  const v = h.get("retry-after");
  if (!v) return null;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.min(n, 60);
  const d = Date.parse(v);
  return Number.isNaN(d) ? null : Math.max(0, Math.min(60, Math.round((d - Date.now()) / 1000)));
}

function kindFor(status: number): ToleErrorKind {
  if (status === 400) return "validation";
  if (status === 401) return "auth";
  if (status === 402) return "billing";
  if (status === 403) return "forbidden";
  if (status === 404) return "not_found";
  if (status === 409) return "conflict";
  if (status === 429) return "rate_limited";
  if (status === 502) return "upstream";
  if (status === 503) return "unavailable";
  return "internal";
}

type Raw = { status: number; headers: Headers; body: unknown };

export class ToleClient {
  constructor(private cfg: ToleConfig, private fetchImpl: typeof fetch = (...a) => fetch(...a)) {}

  /** Path prefix: sandbox mirrors live routes under /sandbox. */
  private p(path: string) { return this.cfg.mode === "sandbox" ? `/sandbox${path}` : path; }

  private async send(method: string, path: string, opts: { body?: unknown; idempotencyKey?: string; timeoutMs: number }): Promise<Raw> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.cfg.apiKey}`,
      Accept: "application/json",
    };
    if (opts.body !== undefined) headers["Content-Type"] = "application/json";
    if (this.cfg.connectionId) headers["X-Tole-Connection-Id"] = this.cfg.connectionId;
    if (opts.idempotencyKey) headers["Idempotency-Key"] = opts.idempotencyKey;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.cfg.baseUrl}${path}`, {
        method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
        signal: AbortSignal.timeout(opts.timeoutMs), cache: "no-store",
      });
    } catch (err) {
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      throw new ToleError(timedOut ? "timeout" : "network", null, null);
    }
    const text = await res.text();
    let body: unknown = null;
    try { body = text ? JSON.parse(text) : null; } catch { body = null; }
    return { status: res.status, headers: res.headers, body };
  }

  private fail(r: Raw): never {
    const code = (r.body as { code?: unknown } | null)?.code;
    throw new ToleError(kindFor(r.status), r.status, typeof code === "string" ? code : null, retryAfter(r.headers));
  }

  /** Safe GET with bounded retries on network errors, timeouts, 429 and 5xx. */
  async read(path: string): Promise<unknown> {
    let last: ToleError | null = null;
    for (let attempt = 0; attempt < READ_ATTEMPTS; attempt++) {
      try {
        const r = await this.send("GET", path, { timeoutMs: READ_TIMEOUT_MS });
        if (r.status >= 200 && r.status < 300) return r.body;
        this.fail(r);
      } catch (err) {
        if (!(err instanceof ToleError)) throw err;
        const retryable = err.kind === "timeout" || err.kind === "network" || err.kind === "rate_limited" ||
          (err.httpStatus !== null && err.httpStatus >= 500);
        if (!retryable || attempt === READ_ATTEMPTS - 1) throw err;
        last = err;
        const wait = err.retryAfterSec !== null ? err.retryAfterSec * 1000 : 300 * 2 ** attempt;
        toleLog("read_retry", { path: path.split("/")[1] ?? "", kind: err.kind, attempt: attempt + 1 });
        await sleep(Math.min(wait, 5_000));
      }
    }
    throw last ?? new ToleError("internal", null, null);
  }

  /** Payment mutation: sent once. 4xx/5xx/timeout are thrown, never retried here. */
  async mutate<T>(path: string, body: unknown, idempotencyKey: string, parse: (data: unknown) => T): Promise<MutationOutcome<T>> {
    if (!IDEMPOTENCY_KEY_RE.test(idempotencyKey)) throw new ToleError("validation", null, "LOCAL_BAD_IDEMPOTENCY_KEY");
    const r = await this.send("POST", path, { body, idempotencyKey, timeoutMs: MUTATION_TIMEOUT_MS });
    const b = (r.body ?? {}) as { ok?: boolean; data?: unknown; commandId?: unknown; replayed?: unknown; kind?: unknown };
    if (r.status === 200 || r.status === 201) {
      return { kind: "done", data: parse(b.data), commandId: typeof b.commandId === "string" ? b.commandId : null, replayed: b.replayed === true };
    }
    if (r.status === 202) {
      if (typeof b.commandId !== "string") throw new ToleError("bad_response", 202, null);
      if (b.kind === "outcome_unknown") return { kind: "outcome_unknown", commandId: b.commandId };
      return { kind: "in_progress", commandId: b.commandId, retryAfterSec: retryAfter(r.headers), location: r.headers.get("location") };
    }
    this.fail(r);
  }

  // ── Operations ──────────────────────────────────────────────────────────────

  /** Sends a Kaspi invoice to the customer's phone. The phone is never logged. */
  createInvoice(phoneNumber: string, amountKzt: number, comment: string, idempotencyKey: string) {
    if (!KZ_PHONE_RE.test(phoneNumber)) throw new ToleError("validation", null, "LOCAL_BAD_PHONE");
    if (!Number.isInteger(amountKzt) || amountKzt < 1 || amountKzt > 100_000_000) {
      throw new ToleError("validation", null, "LOCAL_BAD_AMOUNT");
    }
    return this.mutate(this.p("/invoices"), { phoneNumber, amount: amountKzt, comment: comment.slice(0, 200) }, idempotencyKey, parseInvoice);
  }

  /** Cancels an unpaid invoice (stable key per local operation). */
  cancelInvoice(operationId: string, idempotencyKey: string) {
    return this.mutate(this.p(`/invoices/${encodeURIComponent(operationId)}/cancel`), {}, idempotencyKey, (d) => d);
  }

  async getInvoicePaymentIntent(paymentIntentId: string): Promise<{ id: string; status: PaymentIntentStatus; amount: number; currency: string }> {
    // Durable intent reads are documented for live only (no sandbox mirror listed).
    const body = (await this.read(`/payment-intents/invoices/${encodeURIComponent(paymentIntentId)}`)) as { data?: Record<string, unknown> } | null;
    const d = body?.data ?? {};
    const status = d.status as PaymentIntentStatus;
    if (typeof d.id !== "string" || !INTENT_STATUSES.includes(status) || typeof d.amount !== "number") {
      throw new ToleError("bad_response", 200, null);
    }
    return { id: d.id, status, amount: d.amount, currency: typeof d.currency === "string" ? d.currency : "KZT" };
  }

  async getCommand(commandId: string): Promise<CommandState> {
    const body = (await this.read(this.p(`/commands/${encodeURIComponent(commandId)}`))) as { data?: Record<string, unknown> } | null;
    const d = body?.data ?? {};
    const responseStatus = typeof d.responseStatus === "number" ? d.responseStatus : null;
    if (d.status === "succeeded" && (responseStatus === null || responseStatus < 300)) return { state: "succeeded", result: d.result };
    if (responseStatus !== null && responseStatus >= 400) return { state: "failed", responseStatus };
    return { state: "pending", retryAfterSec: null };
  }

  /** Polls a 202 in_progress command for a bounded time, honouring Retry-After. */
  async awaitCommand(commandId: string, firstWaitSec: number | null, maxWaitMs = 10_000): Promise<CommandState> {
    const until = Date.now() + maxWaitMs;
    let wait = (firstWaitSec ?? 1) * 1000;
    while (true) {
      if (Date.now() + wait > until) return { state: "pending", retryAfterSec: null };
      await sleep(wait);
      const st = await this.getCommand(commandId);
      if (st.state !== "pending") return st;
      wait = Math.min(wait * 2, 4_000);
    }
  }

  /** Sandbox only: moves a test payment intent to a terminal status (Tole then sends a webhook). */
  async simulateSandbox(paymentIntentId: string, status: "paid" | "cancelled" | "expired" | "failed") {
    if (this.cfg.mode !== "sandbox") throw new ToleError("forbidden", null, "LOCAL_SANDBOX_ONLY");
    const r = await this.send("POST", `/sandbox/payment-intents/${encodeURIComponent(paymentIntentId)}/simulate`, { body: { status }, timeoutMs: READ_TIMEOUT_MS });
    if (r.status !== 200) this.fail(r);
  }
}

export function parseInvoice(data: unknown): InvoiceCreated {
  const d = (data ?? {}) as Record<string, unknown>;
  if (typeof d.id !== "string") throw new ToleError("bad_response", 201, null);
  return {
    id: d.id,
    status: typeof d.status === "string" ? d.status : "created",
    amount: typeof d.amount === "number" ? d.amount : NaN,
    clientPhoneLast4: typeof d.clientPhoneLast4 === "string" ? d.clientPhoneLast4.slice(-4) : null,
  };
}

/** Extracts the created invoice from a succeeded command's stored original response. */
export function invoiceFromCommandResult(result: unknown): InvoiceCreated | null {
  try { return parseInvoice((result as { data?: unknown } | null)?.data); } catch { return null; }
}

// ── Webhooks ─────────────────────────────────────────────────────────────────

export const WEBHOOK_TOLERANCE_SEC = 5 * 60;

/**
 * Verifies `webhook-signature: v1=<hex>` = HMAC-SHA256(secret, "<webhook-id>.<webhook-timestamp>.<exact raw body>")
 * over the EXACT raw body, before any JSON parsing. Several space/comma separated signatures are accepted
 * (secret rotation). Stale or future timestamps are rejected (replay guard).
 */
export function verifyToleSignature(rawBody: string, headers: Headers, secret: string, nowSec = Math.floor(Date.now() / 1000)):
  { ok: true; webhookId: string; timestamp: number } | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" } {
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sigHeader = headers.get("webhook-signature");
  if (!id || !ts || !sigHeader || !secret) return { ok: false, reason: "missing_headers" };
  const t = Number(ts);
  if (!Number.isInteger(t) || Math.abs(nowSec - t) > WEBHOOK_TOLERANCE_SEC) return { ok: false, reason: "stale" };
  const expected = createHmac("sha256", secret).update(`${id}.${ts}.${rawBody}`).digest();
  const candidates = sigHeader.split(/[\s,]+/).filter((s) => s.startsWith("v1="));
  for (const c of candidates) {
    const hex = c.slice(3);
    if (!/^[0-9a-fA-F]{64}$/.test(hex)) continue;
    const got = Buffer.from(hex, "hex");
    if (got.length === expected.length && timingSafeEqual(got, expected)) return { ok: true, webhookId: id, timestamp: t };
  }
  return { ok: false, reason: "bad_signature" };
}
