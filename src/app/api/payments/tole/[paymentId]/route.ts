import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow } from "@/lib/security/rate-limit";
import { reconcileTolePayment } from "@/lib/payments/tole/reconcile";

// Owner-only payment status for the checkout page poller. Returns no provider identifiers.
export async function GET(_req: NextRequest, { params }: { params: Promise<{ paymentId: string }> }) {
  const { paymentId } = await params;
  if (!z.string().uuid().safeParse(paymentId).success) return NextResponse.json({ ok: false }, { status: 404 });
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });

  const { data: pay } = await supabaseAdmin().from("payments")
    .select("id,status,provider,provider_payment_id,provider_outcome,orders!inner(user_id)").eq("id", paymentId).maybeSingle();
  const owner = pay && (Array.isArray(pay.orders) ? pay.orders[0]?.user_id : (pay.orders as { user_id: string } | null)?.user_id);
  if (!pay || owner !== user.id || (pay.provider !== "tole" && pay.provider !== "tole_sandbox")) {
    return NextResponse.json({ ok: false }, { status: 404 });
  }

  // Reconcile with Tole at a bounded rate; otherwise answer from our database.
  const view = pay.status === "pending" && (await allow("tole_reconcile", pay.id))
    ? await reconcileTolePayment(pay.id)
    : { status: pay.status, ready: !!pay.provider_payment_id, outcome: pay.provider_outcome };
  return NextResponse.json({ ok: true, status: view?.status ?? pay.status, ready: view?.ready ?? false },
    { headers: { "Cache-Control": "no-store" } });
}
