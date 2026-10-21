import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { paymentProvider } from "./index";

export type WebhookOutcome =
  | { http: 200; result: "applied" | "noop" | "duplicate" }
  | { http: 400 | 401 | 404 | 409; result: string };

/**
 * Single entry point for provider callbacks:
 * 1) authenticate (signature) → 2) dedupe by provider event id → 3) apply in one DB transaction.
 * A browser redirect to a "success" page never reaches this path.
 */
export async function handlePaymentWebhook(providerKey: string, rawBody: string, headers: Headers): Promise<WebhookOutcome> {
  const provider = paymentProvider(providerKey);
  if (!provider) return { http: 404, result: "unknown_provider" };

  const event = await provider.verifyWebhook(rawBody, headers);
  if (!event) return { http: 401, result: "invalid_signature" };

  const db = supabaseAdmin();
  // Idempotency: the unique (provider, event_id) constraint rejects replays.
  const { error: dupErr } = await db.from("webhook_events")
    .insert({ provider: provider.key, event_id: event.eventId, event_type: event.eventType });
  if (dupErr) {
    if (dupErr.code === "23505") return { http: 200, result: "duplicate" };
    console.error("[webhook.insert]", dupErr.code);
    return { http: 409, result: "retry" };
  }

  const { data: result, error } = await db.rpc("apply_payment_event", {
    p_provider: provider.key,
    p_provider_payment_id: event.providerPaymentId,
    p_status: event.status,
    p_amount_kzt: event.amountKzt,
    p_currency: event.currency,
    p_reason: event.reason ?? null,
  });
  if (error) {
    // Let the provider retry: forget the event so the retry isn't treated as a duplicate.
    await db.from("webhook_events").delete().eq("provider", provider.key).eq("event_id", event.eventId);
    console.error("[webhook.apply]", error.code, error.message);
    return { http: 409, result: "retry" };
  }
  await db.from("webhook_events").update({ processed_at: new Date().toISOString() })
    .eq("provider", provider.key).eq("event_id", event.eventId);

  if (result === "applied") {
    const { data: pay } = await db.from("payments").select("order_id")
      .eq("provider", provider.key).eq("provider_payment_id", event.providerPaymentId).single();
    if (event.status === "succeeded") await track("payment_succeeded", { orderId: pay?.order_id });
    if (event.status === "failed") await track("payment_failed", { orderId: pay?.order_id });
    return { http: 200, result: "applied" };
  }
  if (result === "noop" || result === "invalid_transition") return { http: 200, result: "noop" };
  if (result === "duplicate_charge") {
    console.error("[webhook] duplicate charge — refund required", event.providerPaymentId);
    return { http: 200, result: "noop" }; // acknowledged; flagged in audit_logs for a manual refund
  }
  if (result === "not_found") return { http: 404, result };
  console.error("[webhook.reject]", result, event.providerPaymentId);
  return { http: 400, result: String(result) };
}
