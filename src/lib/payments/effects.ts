import "server-only";
import { after } from "next/server";
import { track } from "@/lib/analytics";
import { markDiscountUsed } from "@/lib/engage/discount";
import { sendServerPurchase } from "@/lib/pixels/server";
import { notifyOrderOwner } from "@/lib/telegram/bot";
import { notifyAdmins } from "@/lib/telegram/admin";
import { notifyPartnerCommission } from "@/lib/partners";
import type { PaymentStatus } from "./types";

/**
 * Side effects of a payment state change that was just APPLIED (apply_payment_event === "applied").
 * One place for every path that can confirm a payment (webhook, status polling, checkout page), so none
 * of them forgets a step — previously the polling path skipped the Telegram and partner notifications.
 *
 * Split by what the customer is waiting for:
 *  - cheap DB-only work runs inline (it needs the request's cookies for analytics attribution);
 *  - slow external calls (ad pixels, Telegram) run AFTER the response, so the browser sees "paid"
 *    without waiting for TikTok / Meta / GA4 / Telegram round trips.
 * Callers must invoke this only when the RPC returned "applied", so each effect runs once per payment.
 */
export async function onPaymentApplied(orderId: string | null | undefined, status: PaymentStatus): Promise<void> {
  if (!orderId) return;

  if (status === "failed") {
    await track("payment_failed", { orderId });
    return;
  }
  if (status !== "succeeded") return;

  await track("payment_succeeded", { orderId });
  await markDiscountUsed(orderId);

  const slow = async () => {
    // Each helper never throws; allSettled keeps one slow/broken target from blocking the others.
    await Promise.allSettled([
      sendServerPurchase(orderId),
      notifyOrderOwner(orderId, "paid"),
      notifyAdmins(orderId, "paid"),
      notifyPartnerCommission(orderId),
    ]);
  };
  try {
    after(slow);
  } catch {
    // Outside a request scope (scripts, tests): fire and forget rather than block the caller.
    void slow();
  }
}
