import { Suspense } from "react";
import { notFound } from "next/navigation";
import { z } from "zod";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { requireUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { completeSandboxPayment } from "@/lib/payments/actions";

export const metadata = { title: kk.sandbox.title };

export default function SandboxCheckout({ params }: { params: Promise<{ paymentId: string }> }) {
  return (
    <main className="mx-auto max-w-md px-4 pt-12">
      <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
        <Inner params={params} />
      </Suspense>
    </main>
  );
}

async function Inner({ params }: { params: Promise<{ paymentId: string }> }) {
  if (env().APP_ENV === "production") notFound();
  const { paymentId } = await params;
  const user = await requireUser(`/checkout/sandbox/${paymentId}`);
  if (!z.string().uuid().safeParse(paymentId).success) notFound();

  const { data: pay } = await supabaseAdmin().from("payments")
    .select("id,status,amount_kzt,provider,orders!inner(user_id,public_order_number)")
    .eq("id", paymentId).maybeSingle();
  const order = pay && (Array.isArray(pay.orders) ? pay.orders[0] : pay.orders) as { user_id: string; public_order_number: string } | null;
  if (!pay || pay.provider !== "sandbox" || order?.user_id !== user.id) notFound();

  if (pay.status !== "pending") {
    return <p className="rounded-card border border-line bg-white p-6 text-center text-muted">{kk.sandbox.unavailable}</p>;
  }

  const btn = "h-12 w-full rounded-full font-semibold";
  return (
    <div className="overflow-hidden rounded-card border-2 border-dashed border-flash bg-white">
      <p className="bg-flash px-4 py-2 text-center text-sm font-bold tracking-wide text-ink">{kk.sandbox.badge}</p>
      <div className="p-6">
        <h1 className="font-display text-xl font-bold">{kk.sandbox.title}</h1>
        <p className="mt-2 text-sm text-muted">{kk.sandbox.text}</p>
        <dl className="mt-5 flex items-baseline justify-between border-y border-line py-4">
          <dt className="text-sm text-muted">{kk.order.number}: {order?.public_order_number}</dt>
          <dd className="font-display text-2xl font-bold">{formatKzt(pay.amount_kzt)}</dd>
        </dl>
        <form action={completeSandboxPayment} className="mt-5 space-y-3">
          <input type="hidden" name="paymentId" value={pay.id} />
          <button name="outcome" value="succeeded" className={`${btn} bg-brand text-white hover:bg-brand-dark`}>{kk.sandbox.succeed}</button>
          <button name="outcome" value="failed" className={`${btn} border border-line hover:border-ink`}>{kk.sandbox.fail}</button>
          <button name="outcome" value="cancelled" className={`${btn} text-muted hover:text-ink`}>{kk.sandbox.cancel}</button>
        </form>
      </div>
    </div>
  );
}
