import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { runWorker } from "@/lib/generation/worker";

const ACTIVE = ["queued", "processing", "postprocessing"];

/** Owner-only status for polling. Also nudges the queue so progress never depends on cron alone. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false }, { status: 404 });
  const sb = await supabaseServer();
  const { data: o } = await sb.from("orders").select("id,payment_status,generation_status").eq("id", id).maybeSingle();
  if (!o) return NextResponse.json({ ok: false }, { status: 404 });

  if (o.payment_status === "succeeded" && ACTIVE.includes(o.generation_status)) {
    await runWorker({ limit: 2, budgetMs: 6_000 });
  }
  const db = supabaseAdmin();
  const [{ data: fresh }, { data: job }] = await Promise.all([
    db.from("orders").select("payment_status,generation_status").eq("id", id).single(),
    db.from("generation_jobs").select("status,progress,safe_error_message")
      .eq("order_id", id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  return NextResponse.json(
    {
      ok: true,
      paymentStatus: fresh?.payment_status,
      generationStatus: fresh?.generation_status,
      progress: job?.progress ?? null,
      error: job?.status === "failed" ? job.safe_error_message : null,
    },
    { headers: { "cache-control": "no-store" } },
  );
}
