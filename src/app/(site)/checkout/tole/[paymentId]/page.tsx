import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { reconcileTolePayment } from "@/lib/payments/tole/reconcile";
import { cancelToleInvoiceAction } from "@/lib/payments/actions";
import { PayButton } from "@/components/pay-button";
import { ToleStatus } from "./status";
import { simulateTolePayment } from "./actions";

export const metadata = { title: kk.tole.title };

export default function ToleCheckout({ params }: { params: Promise<{ paymentId: string }> }) {
  return (
    <main className="mx-auto max-w-md px-4 pb-16 pt-10">
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <Inner params={params} />
      </Suspense>
    </main>
  );
}

async function Inner({ params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  const user = await requireUser(`/checkout/tole/${paymentId}`);
  if (!z.string().uuid().safeParse(paymentId).success) notFound();

  const db = supabaseAdmin();
  const load = () => db.from("payments")
    .select("id,status,amount_kzt,provider,provider_outcome,provider_payment_id,provider_phone_last4,order_id,orders!inner(user_id,public_order_number)")
    .eq("id", paymentId).maybeSingle();
  let { data: pay } = await load();
  const order = pay && (Array.isArray(pay.orders) ? pay.orders[0] : pay.orders) as { user_id: string; public_order_number: string } | null;
  if (!pay || (pay.provider !== "tole" && pay.provider !== "tole_sandbox") || order?.user_id !== user.id) notFound();

  // Catch up with Tole (pending command / missed webhook) before rendering.
  if (pay.status === "pending") {
    await reconcileTolePayment(pay.id);
    ({ data: pay } = await load());
    if (!pay) notFound();
  }
  if (pay.status === "succeeded") redirect(`/orders/${pay.order_id}`);

  const sandbox = pay.provider === "tole_sandbox";
  const card = "rounded-card border border-line bg-surface p-6";

  if (pay.status !== "pending") {
    return (
      <div className={`${card} text-center`}>
        <p className="font-medium">{kk.tole.failed}</p>
        <Link href={`/orders/${pay.order_id}`} className="mt-4 inline-block font-semibold text-brand hover:underline">{kk.tole.backToOrder}</Link>
      </div>
    );
  }

  const header = (
    <>
      {sandbox && <p className="-mx-6 -mt-6 mb-5 rounded-t-card bg-flash px-4 py-2 text-center text-sm font-bold text-night">{kk.sandbox.badge}</p>}
      <h1 className="font-display text-xl font-bold">{kk.tole.title}</h1>
      <dl className="mt-4 flex items-baseline justify-between border-y border-line py-4">
        <dt className="text-sm text-muted">{kk.order.number}: {order?.public_order_number}</dt>
        <dd className="font-display text-2xl font-bold">{formatKzt(pay.amount_kzt)}</dd>
      </dl>
    </>
  );

  // Create timed out: the retry replays the SAME idempotency key, so no second invoice is issued.
  if (pay.provider_outcome === "timeout") {
    return (
      <div className={card}>
        {header}
        <p className="mt-5 text-sm">{kk.tole.timeout}</p>
        <PayButton orderId={pay.order_id} label={kk.tole.retry} sandbox={sandbox} askPhone />
      </div>
    );
  }

  // 202 in progress / outcome unknown: the status poller reconciles and refreshes.
  if (!pay.provider_payment_id) {
    return (
      <div className={card}>
        {header}
        {pay.provider_outcome === "outcome_unknown" && <p className="mt-5 text-sm text-muted">{kk.tole.unknown}</p>}
        <ToleStatus paymentId={pay.id} orderId={pay.order_id} ready={false} />
      </div>
    );
  }

  return (
    <div className={card}>
      {header}
      <p className="mt-5 rounded-xl bg-brand-soft px-4 py-3 font-semibold">
        {pay.provider_phone_last4 ? kk.tole.sent(pay.provider_phone_last4) : kk.tole.sentNoPhone}
      </p>
      <p className="mt-3 text-sm text-muted">{kk.tole.howToPay}</p>
      <ToleStatus paymentId={pay.id} orderId={pay.order_id} ready />

      <form action={cancelToleInvoiceAction} className="mt-4 text-center">
        <input type="hidden" name="paymentId" value={pay.id} />
        <button className="text-sm font-medium text-muted underline underline-offset-2 hover:text-ink">{kk.tole.otherPhone}</button>
      </form>

      {sandbox && env().APP_ENV !== "production" && (
        <form action={simulateTolePayment} className="mt-6 rounded-xl border-2 border-dashed border-flash p-4">
          <p className="text-sm font-semibold">{kk.tole.simulateTitle}</p>
          <input type="hidden" name="paymentId" value={pay.id} />
          <div className="mt-3 flex gap-2">
            <button name="status" value="paid" className="h-10 flex-1 rounded-full bg-brand text-sm font-semibold text-night">{kk.tole.simulatePaid}</button>
            <button name="status" value="failed" className="h-10 flex-1 rounded-full border border-line text-sm font-semibold">{kk.tole.simulateFailed}</button>
          </div>
          <p className="mt-2 text-xs text-muted">{kk.tole.simulateDone}</p>
        </form>
      )}
    </div>
  );
}
