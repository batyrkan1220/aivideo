import "server-only";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import {
  PaymentProviderNotConfigured, PaymentRetryLater,
  type CreatePaymentResult, type PaymentProvider, type PaymentStatus, type VerifiedPaymentEvent,
} from "../types";
import { ToleClient, ToleError, invoiceFromCommandResult, verifyToleSignature, type PaymentIntentStatus, type ToleMode } from "./client";
import { toleLog } from "./log";

/**
 * Tole Payments (Kaspi invoice) as a PaymentProvider.
 *  - `tole`          → live routes, live key;
 *  - `tole_sandbox`  → /v1/sandbox/* routes, test key (tole_sk_test_…) and required X-Tole-Connection-Id.
 * The customer enters a Kaspi phone number; Tole sends a Kaspi invoice to it and the customer pays
 * in the Kaspi app. Our /checkout/tole/{paymentId} page waits for the result.
 * Payment state is changed only by a verified webhook or an authenticated read from Tole.
 */

export function toleClient(mode: ToleMode, fetchImpl?: typeof fetch): ToleClient {
  const e = env();
  if (!e.TOLE_API_KEY) throw new PaymentProviderNotConfigured(mode === "sandbox" ? "tole_sandbox" : "tole");
  const isTestKey = e.TOLE_API_KEY.startsWith("tole_sk_test_");
  if (mode === "sandbox" && (!isTestKey || !e.TOLE_CONNECTION_ID)) {
    throw new PaymentProviderNotConfigured("tole_sandbox (needs a tole_sk_test_ key and TOLE_CONNECTION_ID)");
  }
  if (mode === "live" && isTestKey) throw new PaymentProviderNotConfigured("tole (test key cannot be used in live mode)");
  return new ToleClient({ baseUrl: e.TOLE_API_BASE_URL, apiKey: e.TOLE_API_KEY, connectionId: e.TOLE_CONNECTION_ID, mode }, fetchImpl);
}

/** Tole payment-intent status → our payment status (null = no state change). */
export function mapIntentStatus(s: PaymentIntentStatus): { status: PaymentStatus; reason?: string } | null {
  switch (s) {
    case "paid": return { status: "succeeded" };
    case "failed": return { status: "failed" };
    case "cancelled": return { status: "cancelled" };
    case "expired": return { status: "cancelled", reason: "expired" };
    case "refunded": return { status: "refunded" };
    default: return null; // pending, partially_refunded
  }
}

const EVENT_TO_INTENT: Record<string, PaymentIntentStatus> = {
  "payment.paid": "paid",
  "payment.failed": "failed",
  "payment.cancelled": "cancelled",
  "payment.expired": "expired",
  "payment.refunded": "refunded",
};

function makeProvider(mode: ToleMode): PaymentProvider {
  const key = mode === "sandbox" ? "tole_sandbox" : "tole";
  return {
    key,
    isLive: mode === "live",

    async createPayment(input): Promise<CreatePaymentResult> {
      if (!input.customerPhone) throw new ToleError("validation", null, "LOCAL_PHONE_REQUIRED");
      const client = toleClient(mode);
      const redirectUrl = `/checkout/tole/${input.paymentId}`;
      let out;
      try {
        // Stable key derived from OUR payment id: a replay returns the original invoice, never a second one.
        out = await client.createInvoice(input.customerPhone, input.amountKzt, input.description, input.idempotencyKey);
      } catch (err) {
        if (err instanceof ToleError && (err.kind === "timeout" || err.kind === "network")) {
          // We can't know whether Tole accepted it. Don't repeat now; the customer's retry replays
          // the SAME idempotency key, which returns the original result if it was created.
          toleLog("create_invoice_unknown", { paymentId: input.paymentId, kind: err.kind }, "error");
          return { redirectUrl, providerOutcome: "timeout" };
        }
        if (err instanceof ToleError) {
          toleLog("create_invoice_failed", { paymentId: input.paymentId, kind: err.kind, httpStatus: err.httpStatus, code: err.code }, "error");
        }
        throw err;
      }

      if (out.kind === "in_progress") {
        const st = await client.awaitCommand(out.commandId, out.retryAfterSec, 8_000).catch(() => ({ state: "pending" as const }));
        if (st.state === "failed") throw new ToleError("upstream", st.responseStatus, "COMMAND_FAILED");
        const inv = st.state === "succeeded" ? invoiceFromCommandResult(st.result) : null;
        if (!inv) {
          toleLog("create_invoice_pending", { paymentId: input.paymentId, commandId: out.commandId });
          return { redirectUrl, providerCommandId: out.commandId, providerOutcome: "in_progress" };
        }
        out = { kind: "done" as const, data: inv, commandId: out.commandId, replayed: false };
      }
      if (out.kind === "outcome_unknown") {
        // Never auto-repeat: Kaspi may have issued it. Reconcile via the command later.
        toleLog("create_invoice_outcome_unknown", { paymentId: input.paymentId, commandId: out.commandId }, "error");
        return { redirectUrl, providerCommandId: out.commandId, providerOutcome: "outcome_unknown" };
      }

      toleLog("create_invoice_ok", { paymentId: input.paymentId, paymentIntentId: out.data.id, commandId: out.commandId, result: out.replayed ? "replayed" : "created" });
      return {
        // Tole documents data.id as its local UUID of the invoice payment intent (operationId).
        providerPaymentId: out.data.id,
        providerOperationId: out.data.id,
        providerCommandId: out.commandId ?? undefined,
        phoneLast4: out.data.clientPhoneLast4 ?? undefined,
        redirectUrl,
      };
    },

    async verifyWebhook(rawBody, headers): Promise<VerifiedPaymentEvent | null> {
      const secret = env().TOLE_WEBHOOK_SECRET;
      if (!secret) { toleLog("webhook_no_secret", {}, "error"); return null; }
      const sig = verifyToleSignature(rawBody, headers, secret);
      if (!sig.ok) { toleLog("webhook_rejected", { reason: sig.reason }, "error"); return null; }

      // Signature verified over the exact raw body — only now parse it.
      let body: { type?: unknown; data?: { paymentIntentId?: unknown } };
      try { body = JSON.parse(rawBody); } catch { return null; }
      const type = typeof body.type === "string" ? body.type : "unknown";
      const intentId = typeof body.data?.paymentIntentId === "string" ? body.data.paymentIntentId : null;
      const base = { eventId: sig.webhookId, eventType: type, currency: "KZT" };
      const ignore = (): VerifiedPaymentEvent => ({ ...base, providerPaymentId: intentId ?? "", status: "pending", amountKzt: 0, ignore: true });

      const fromType = EVENT_TO_INTENT[type];
      if (!fromType || !intentId) {
        toleLog("webhook_ignored", { webhookId: sig.webhookId, eventType: type });
        return ignore();
      }

      if (mode === "live") {
        // Authoritative state and amount come from Tole's durable payment intent.
        let intent;
        try { intent = await toleClient("live").getInvoicePaymentIntent(intentId); }
        catch (err) {
          toleLog("webhook_intent_read_failed", { webhookId: sig.webhookId, kind: err instanceof ToleError ? err.kind : "error" }, "error");
          throw new PaymentRetryLater("intent read failed");
        }
        const mapped = mapIntentStatus(intent.status);
        if (!mapped) return ignore();
        return { ...base, providerPaymentId: intent.id, amountKzt: intent.amount, currency: intent.currency, ...mapped };
      }

      // Sandbox: no documented intent read — the signed event type decides; the amount is the one we
      // created this payment with (Tole created the intent from it).
      const mapped = mapIntentStatus(fromType)!;
      const { data: pay } = await supabaseAdmin().from("payments").select("amount_kzt,currency")
        .eq("provider", key).eq("provider_payment_id", intentId).maybeSingle();
      return { ...base, providerPaymentId: intentId, amountKzt: pay?.amount_kzt ?? -1, currency: pay?.currency ?? "KZT", ...mapped };
    },
  };
}

export const toleProvider = makeProvider("live");
export const toleSandboxProvider = makeProvider("sandbox");

/** Cancels an unpaid Tole invoice (e.g. the customer wants to use another phone number). */
export async function cancelToleInvoice(mode: ToleMode, operationId: string, localPaymentId: string) {
  const out = await toleClient(mode).cancelInvoice(operationId, `cancel:${localPaymentId}`);
  toleLog("cancel_invoice", { paymentId: localPaymentId, outcome: out.kind });
  return out.kind;
}
