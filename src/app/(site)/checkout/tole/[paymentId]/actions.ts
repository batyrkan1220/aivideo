"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow } from "@/lib/security/rate-limit";
import { toleClient } from "@/lib/payments/tole/provider";
import { toleLog } from "@/lib/payments/tole/log";

/**
 * Tole sandbox only: asks Tole to move the TEST payment intent to a terminal status.
 * Tole then sends a signed webhook, processed exactly like a live one. Never available live.
 */
export async function simulateTolePayment(fd: FormData) {
  if (env().APP_ENV === "production" || env().PAYMENT_PROVIDER !== "tole_sandbox") redirect("/");
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const paymentId = z.string().uuid().safeParse(fd.get("paymentId"));
  const status = z.enum(["paid", "failed"]).safeParse(fd.get("status"));
  if (!paymentId.success || !status.success) redirect("/account");
  if (!(await allow("tole_simulate", user.id))) redirect(`/checkout/tole/${paymentId.data}`);

  const { data: pay } = await supabaseAdmin().from("payments")
    .select("id,provider,provider_payment_id,orders!inner(user_id)").eq("id", paymentId.data).maybeSingle();
  const owner = pay && (Array.isArray(pay.orders) ? pay.orders[0]?.user_id : (pay.orders as { user_id: string } | null)?.user_id);
  if (!pay || pay.provider !== "tole_sandbox" || owner !== user.id || !pay.provider_payment_id) redirect("/account");

  try {
    await toleClient("sandbox").simulateSandbox(pay.provider_payment_id, status.data);
    toleLog("sandbox_simulated", { paymentId: pay.id, status: status.data });
  } catch (err) {
    toleLog("sandbox_simulate_failed", { paymentId: pay.id, kind: err instanceof Error ? err.message : "error" }, "error");
  }
  redirect(`/checkout/tole/${pay.id}`);
}
