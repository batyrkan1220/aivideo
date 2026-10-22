import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";
import { ToleError, invoiceFromCommandResult } from "./client";
import { mapIntentStatus, toleClient } from "./provider";
import { toleLog } from "./log";

export type TolePaymentView = {
  status: "pending" | "succeeded" | "failed" | "cancelled" | "refunded";
  ready: boolean;                // invoice was issued to the customer's Kaspi
  outcome: string | null;        // in_progress | outcome_unknown | timeout | null
};

/**
 * Brings one Tole payment up to date with authenticated reads only (never a new mutation):
 *  1. pending command (202) → GET /commands/{id}; a succeeded command yields the invoice;
 *  2. live mode with a known intent → GET /payment-intents/invoices/{id}; a terminal state is applied
 *     through the same state machine as webhooks (covers missed webhooks).
 */
export async function reconcileTolePayment(paymentId: string): Promise<TolePaymentView | null> {
  const db = supabaseAdmin();
  const { data: p } = await db.from("payments")
    .select("id,order_id,provider,status,provider_payment_id,provider_command_id,provider_outcome")
    .eq("id", paymentId).maybeSingle();
  if (!p || (p.provider !== "tole" && p.provider !== "tole_sandbox")) return null;
  const mode = p.provider === "tole" ? "live" : "sandbox";

  try {
    if (p.status === "pending" && p.provider_command_id && (p.provider_outcome === "in_progress" || p.provider_outcome === "outcome_unknown")) {
      const st = await toleClient(mode).getCommand(p.provider_command_id);
      if (st.state === "succeeded") {
        const inv = invoiceFromCommandResult(st.result);
        if (inv) {
          await db.from("payments").update({
            provider_payment_id: inv.id, provider_operation_id: inv.id, provider_phone_last4: inv.clientPhoneLast4,
            provider_outcome: null,
          }).eq("id", p.id).eq("status", "pending");
          toleLog("reconcile_command_ok", { paymentId: p.id, commandId: p.provider_command_id, paymentIntentId: inv.id });
          return { status: "pending", ready: true, outcome: null };
        }
      } else if (st.state === "failed") {
        await db.from("payments").update({ status: "failed", failure_reason: "provider_rejected", provider_outcome: null })
          .eq("id", p.id).eq("status", "pending");
        toleLog("reconcile_command_failed", { paymentId: p.id, commandId: p.provider_command_id, httpStatus: st.responseStatus }, "error");
        return { status: "failed", ready: false, outcome: null };
      }
      return { status: "pending", ready: false, outcome: p.provider_outcome };
    }

    if (mode === "live" && p.status === "pending" && p.provider_payment_id) {
      const intent = await toleClient("live").getInvoicePaymentIntent(p.provider_payment_id);
      const mapped = mapIntentStatus(intent.status);
      if (mapped) {
        const { data: result } = await db.rpc("apply_payment_event", {
          p_provider: p.provider, p_provider_payment_id: intent.id, p_status: mapped.status,
          p_amount_kzt: intent.amount, p_currency: intent.currency, p_reason: mapped.reason ?? null,
        });
        toleLog("reconcile_intent", { paymentId: p.id, paymentIntentId: intent.id, status: intent.status, result: String(result) });
        if (result === "applied" && mapped.status === "succeeded") await track("payment_succeeded", { orderId: p.order_id });
        return { status: result === "applied" ? mapped.status : "pending", ready: true, outcome: null };
      }
    }
  } catch (err) {
    toleLog("reconcile_error", { paymentId: p.id, kind: err instanceof ToleError ? err.kind : "error" }, "error");
  }
  return { status: p.status, ready: !!p.provider_payment_id, outcome: p.provider_outcome };
}
