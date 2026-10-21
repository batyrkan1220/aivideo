"use server";
import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { calculatePrice } from "@/lib/pricing";
import { pricingConfigSchema, qualitySchema } from "@/lib/templates/schema";
import { activePaymentProvider } from "./index";
import { handlePaymentWebhook } from "./process";
import { signSandbox } from "./sandbox";
import { PaymentProviderNotConfigured } from "./types";

export type CheckoutState = { error?: "unauthorized" | "not_payable" | "price_changed" | "provider_unavailable" | "generic" };

/**
 * Starts (or resumes) payment for an order. Safe to call repeatedly:
 * an unexpired pending payment is reused instead of creating a second charge.
 */
export async function startCheckout(_: CheckoutState, fd: FormData): Promise<CheckoutState> {
  const user = await getSessionUser();
  if (!user) return { error: "unauthorized" };
  const orderId = z.string().uuid().safeParse(fd.get("orderId"));
  if (!orderId.success) return { error: "generic" };

  const db = supabaseAdmin();
  const { data: o } = await db.from("orders")
    .select("id,user_id,public_order_number,amount_kzt,currency,payment_status,generation_status,face_count,template_snapshot_json,pricing_breakdown_json,created_at")
    .eq("id", orderId.data).eq("user_id", user.id).maybeSingle();
  if (!o) return { error: "generic" };
  if (!["pending", "failed", "cancelled"].includes(o.payment_status) || o.generation_status !== "awaiting_payment") {
    return { error: "not_payable" };
  }

  // Re-validate the amount from the order's own snapshot right before charging.
  const snap = o.template_snapshot_json as Record<string, unknown>;
  const pricing = pricingConfigSchema.safeParse(snap.pricing_config_json);
  const quality = qualitySchema.safeParse(snap.quality);
  if (!pricing.success || !quality.success) return { error: "generic" };
  const recomputed = calculatePrice(pricing.data, quality.data, o.face_count, new Date(o.created_at)).totalKzt;
  if (recomputed !== o.amount_kzt || o.currency !== "KZT") {
    console.error("[checkout] amount mismatch", o.id, recomputed, o.amount_kzt);
    return { error: "price_changed" };
  }

  const provider = activePaymentProvider();

  // Resume an existing, still-valid pending payment (page refresh, double click, back button).
  const { data: existing } = await db.from("payments")
    .select("id,redirect_url,expires_at,provider").eq("order_id", o.id).eq("status", "pending")
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (existing?.redirect_url && existing.provider === provider.key &&
      (!existing.expires_at || new Date(existing.expires_at).getTime() > Date.now() + 60_000)) {
    redirect(existing.redirect_url);
  }

  const paymentId = randomUUID();
  const idempotencyKey = `${o.id}:${paymentId}`;
  const { error: insErr } = await db.from("payments").insert({
    id: paymentId, order_id: o.id, provider: provider.key, amount_kzt: o.amount_kzt,
    currency: "KZT", status: "pending", idempotency_key: idempotencyKey,
  });
  if (insErr) { console.error("[checkout.insert]", insErr.code); return { error: "generic" }; }

  let created;
  try {
    created = await provider.createPayment({
      paymentId, orderId: o.id, orderNumber: o.public_order_number, amountKzt: o.amount_kzt,
      description: `TrendVideo ${o.public_order_number}`,
      returnUrl: `${env().NEXT_PUBLIC_APP_URL}/orders/${o.id}`,
      idempotencyKey,
    });
  } catch (err) {
    await db.from("payments").update({ status: "failed", failure_reason: "create_failed" }).eq("id", paymentId);
    console.error("[checkout.provider]", err instanceof Error ? err.message : err);
    return { error: err instanceof PaymentProviderNotConfigured ? "provider_unavailable" : "generic" };
  }

  await db.from("payments").update({
    provider_payment_id: created.providerPaymentId,
    redirect_url: created.redirectUrl,
    expires_at: created.expiresAt ?? null,
  }).eq("id", paymentId);
  await db.from("orders").update({ payment_status: "pending" }).eq("id", o.id);

  redirect(created.redirectUrl);
}

/**
 * Sandbox only: simulates the gateway's server-to-server callback. The event is signed and
 * then verified + processed by the same code path as a real webhook.
 */
export async function completeSandboxPayment(fd: FormData) {
  if (env().APP_ENV === "production") throw new Error("sandbox disabled in production");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const paymentId = z.string().uuid().safeParse(fd.get("paymentId"));
  const outcome = z.enum(["succeeded", "failed", "cancelled"]).safeParse(fd.get("outcome"));
  if (!paymentId.success || !outcome.success) redirect("/account");

  const db = supabaseAdmin();
  const { data: pay } = await db.from("payments")
    .select("id,order_id,provider,provider_payment_id,amount_kzt,currency,orders!inner(user_id)")
    .eq("id", paymentId.data).maybeSingle();
  const owner = pay && (Array.isArray(pay.orders) ? pay.orders[0]?.user_id : (pay.orders as { user_id: string } | null)?.user_id);
  if (!pay || pay.provider !== "sandbox" || owner !== user.id || !pay.provider_payment_id) redirect("/account");

  const body = JSON.stringify({
    eventId: `evt_${randomUUID()}`,
    eventType: `payment.${outcome.data}`,
    providerPaymentId: pay.provider_payment_id,
    status: outcome.data,
    amountKzt: pay.amount_kzt,
    currency: pay.currency,
    ts: Date.now(),
  });
  const headers = new Headers({ "x-sandbox-signature": signSandbox(body) });
  await handlePaymentWebhook("sandbox", body, headers);
  redirect(`/orders/${pay.order_id}`);
}
