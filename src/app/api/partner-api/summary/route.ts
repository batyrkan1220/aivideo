import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerApiAuthorized as authorized } from "@/lib/partners/api-auth";
import { botUsername, CODE_RE, partnerDaily, partnerLinks, partnerPeriodTotals, partnerTotals } from "@/lib/partners";

/**
 * Server-to-server API for the Teliks partner cabinet (teliks.ink).
 * Auth: `Authorization: Bearer <TELIKS_API_SECRET>`. Returns ONE partner's numbers only;
 * customers are never identified (order number, amounts and dates only).
 *
 * GET /api/partner-api/summary?code=<partner code>&from=YYYY-MM-DD&to=YYYY-MM-DD   (≤ 92 days)
 */
const q = z.object({
  code: z.string().regex(CODE_RE),
  from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export async function GET(req: NextRequest) {
  await connection(); // request-time only
  if (!authorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const fromMs = Date.parse(`${p.data.from}T00:00:00+05:00`);
  const toMs = Date.parse(`${p.data.to}T00:00:00+05:00`) + 86400_000;
  if (!(toMs > fromMs) || toMs - fromMs > 93 * 86400_000) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const fromIso = new Date(fromMs).toISOString(), toIso = new Date(toMs).toISOString();

  const db = supabaseAdmin();
  const { data: partner } = await db.from("partners").select("id,code,name,percent,active").eq("code", p.data.code).maybeSingle();
  if (!partner) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [period, all, daily, bot, { data: comms }] = await Promise.all([
    partnerPeriodTotals(fromIso, toIso),
    partnerTotals(),
    partnerDaily(partner.id, fromIso, toIso),
    botUsername(),
    db.from("partner_commissions").select("order_amount_kzt,percent,commission_kzt,status,created_at,orders(public_order_number)")
      .eq("partner_id", partner.id).gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).limit(2000),
  ]);
  const t = period.get(partner.id);
  const a = all.get(partner.id);
  const num = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { public_order_number?: string } | null)?.public_order_number ?? "";

  return NextResponse.json({
    partner: { code: partner.code, name: partner.name, percent: Number(partner.percent), active: partner.active },
    links: partnerLinks(partner.code, bot),
    currency: "KZT",
    period: t ?? { visits: 0, users: 0, buyers: 0, paidOrders: 0, revenueKzt: 0, earnedKzt: 0, reversedKzt: 0, paidOutKzt: 0 },
    lifetime: { earnedKzt: a?.earnedKzt ?? 0, reversedKzt: a?.reversedKzt ?? 0, paidOutKzt: a?.paidOutKzt ?? 0 },
    daily,
    commissions: (comms ?? []).map((c) => ({
      time: c.created_at, order: num(c.orders), amountKzt: c.order_amount_kzt, percent: Number(c.percent),
      commissionKzt: c.commission_kzt, status: c.status,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
