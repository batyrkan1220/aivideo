import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerApiAuthorized } from "@/lib/partners/api-auth";
import { CODE_RE } from "@/lib/partners";

/**
 * The Teliks cabinet records a payout it has made to a partner (its own admin approved the
 * request). Idempotent by `ref` (the Teliks request id). Lowers the partner's balance here.
 *
 * POST /api/partner-api/payouts  { code, amountKzt, ref, note? }
 */
const body = z.object({
  code: z.string().regex(CODE_RE),
  amountKzt: z.number().int().positive().max(100_000_000),
  ref: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/),
  note: z.string().trim().max(200).optional(),
});

export async function POST(req: NextRequest) {
  await connection();
  if (!partnerApiAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const db = supabaseAdmin();
  const { data: partner } = await db.from("partners").select("id").eq("code", p.data.code).maybeSingle();
  if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const { error } = await db.from("partner_payouts").insert({
    partner_id: partner.id, amount_kzt: p.data.amountKzt, external_ref: `teliks:${p.data.ref}`, note: p.data.note || "Teliks",
  });
  if (error && error.code !== "23505") { console.error("[partner-api.payout]", error.code); return NextResponse.json({ error: "failed" }, { status: 500 }); }
  return NextResponse.json({ ok: true, duplicate: !!error });
}
