import { connection, NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { partnerApiAuthorized } from "@/lib/partners/api-auth";
import { botUsername, partnerDaily, partnerLinks, partnerPeriodTotals, partnerTotals } from "@/lib/partners";

/**
 * Network-wide numbers for the Teliks admin (like a CPA network dashboard): every partner's
 * period and lifetime totals, the per-day series and the latest commissions.
 * Customers are never identified (order number, amounts and dates only).
 *
 * GET /api/partner-api/overview?from=YYYY-MM-DD&to=YYYY-MM-DD   (≤ 93 days)
 */
const q = z.object({ from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) });

export async function GET(req: NextRequest) {
  await connection();
  if (!partnerApiAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const p = q.safeParse(Object.fromEntries(req.nextUrl.searchParams));
  if (!p.success) return NextResponse.json({ error: "bad_request" }, { status: 400 });
  const fromMs = Date.parse(`${p.data.from}T00:00:00+05:00`);
  const toMs = Date.parse(`${p.data.to}T00:00:00+05:00`) + 86400_000;
  if (!(toMs > fromMs) || toMs - fromMs > 93 * 86400_000) return NextResponse.json({ error: "invalid_range" }, { status: 400 });
  const fromIso = new Date(fromMs).toISOString(), toIso = new Date(toMs).toISOString();

  const db = supabaseAdmin();
  const [{ data: partners }, period, all, daily, bot, { data: comms }, { data: orders }] = await Promise.all([
    db.from("partners").select("id,code,name,percent,active,telegram_username,created_at").order("created_at", { ascending: false }),
    partnerPeriodTotals(fromIso, toIso),
    partnerTotals(),
    partnerDaily(null, fromIso, toIso),
    botUsername(),
    db.from("partner_commissions").select("partner_id,order_amount_kzt,percent,commission_kzt,status,created_at,orders(public_order_number)")
      .gte("created_at", fromIso).lt("created_at", toIso).order("created_at", { ascending: false }).limit(1000),
    db.rpc("partner_orders", { p_from: fromIso, p_to: toIso }),
  ]);
  const codeOf = new Map((partners ?? []).map((x) => [x.id, x.code]));
  const num = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { public_order_number?: string } | null)?.public_order_number ?? "";

  return NextResponse.json({
    currency: "KZT",
    partners: (partners ?? []).map((x) => {
      const t = period.get(x.id);
      const a = all.get(x.id);
      return {
        code: x.code, name: x.name, percent: Number(x.percent), active: x.active, telegram: x.telegram_username, createdAt: x.created_at,
        link: partnerLinks(x.code, bot).bot,
        period: t ?? { visits: 0, users: 0, buyers: 0, paidOrders: 0, revenueKzt: 0, earnedKzt: 0, reversedKzt: 0, paidOutKzt: 0 },
        lifetime: { visits: a?.visits ?? 0, users: a?.users ?? 0, paidOrders: a?.paidOrders ?? 0, revenueKzt: a?.revenueKzt ?? 0, earnedKzt: a?.earnedKzt ?? 0, reversedKzt: a?.reversedKzt ?? 0, paidOutKzt: a?.paidOutKzt ?? 0, balanceKzt: a?.balanceKzt ?? 0 },
      };
    }),
    daily,
    commissions: (comms ?? []).map((c) => ({
      time: c.created_at, code: codeOf.get(c.partner_id) ?? "", order: num(c.orders), amountKzt: c.order_amount_kzt,
      percent: Number(c.percent), commissionKzt: c.commission_kzt, status: c.status,
    })),
    // Every order of a partner-referred customer (any payment status) — the conversions log in Teliks.
    orders: (Array.isArray(orders) ? orders : []) as unknown[],
  }, { headers: { "Cache-Control": "no-store" } });
}
