import { randomBytes } from "node:crypto";
import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerApiAuthorized } from "@/lib/partners/api-auth";
import { partnerDefaults } from "@/lib/partners";

/**
 * Self-registration from the Teliks cabinet: creates the TrendMe partner (default % from the
 * admin settings) and returns its code. Teliks has already created the login in its Supabase.
 *
 * Teliks keeps the account data (email, phone, payout details) in its own Supabase; TrendMe
 * stores only what it needs: name, code, %, Telegram username (self-referral check) and an
 * opaque Teliks id (so a retried sign-up returns the same partner).
 *
 * POST /api/partner-api/partners  { name, teliksUserId, telegram? }
 */
const body = z.object({
  name: z.string().trim().min(1).max(80),
  teliksUserId: z.string().uuid(),
  telegram: z.string().trim().max(40).optional(),
});

export async function POST(req: NextRequest) {
  await connection();
  if (!partnerApiAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = body.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const db = supabaseAdmin();

  // Same Teliks login again (retry) → return the existing partner.
  const { data: existing } = await db.from("partners").select("code,active").eq("teliks_user_id", p.data.teliksUserId).maybeSingle();
  if (existing) return NextResponse.json({ code: existing.code, active: existing.active });

  const d = await partnerDefaults();
  const tgRaw = (p.data.telegram ?? "").replace(/^@/, "").replace(/^https?:\/\/t\.me\//i, "");
  const telegram = /^[A-Za-z0-9_]{3,32}$/.test(tgRaw) ? tgRaw : null;
  for (let i = 0; i < 3; i++) {
    const code = randomBytes(4).toString("hex");
    const { error } = await db.from("partners").insert({
      code, name: p.data.name, percent: d.percent, active: d.autoActivate,
      telegram_username: telegram,
      teliks_user_id: p.data.teliksUserId, notes: "Регистрация через Teliks",
    });
    if (!error) return NextResponse.json({ code, active: d.autoActivate });
    if (error.code !== "23505") { console.error("[partner-api.create]", error.code); break; }
  }
  return NextResponse.json({ error: "failed" }, { status: 500 });
}
