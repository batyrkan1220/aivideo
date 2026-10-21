import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { audit } from "@/lib/auth/session";

/** CSV export of orders in a period (no photos, no payment card data). */
export async function GET(req: NextRequest) {
  const u = await getSessionUser();
  if (!u || !can(u.role, "dashboard.view")) return new NextResponse(null, { status: 403 });
  const sp = req.nextUrl.searchParams;
  const ok = (d: string | null) => !!d && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const from = ok(sp.get("from")) ? sp.get("from")! : "1970-01-01";
  const to = ok(sp.get("to")) ? sp.get("to")! : "2999-12-31";
  const fromIso = new Date(`${from}T00:00:00+05:00`).toISOString();
  const toIso = new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400_000).toISOString();

  const { data } = await supabaseAdmin().from("orders")
    .select("public_order_number,created_at,completed_at,quality,face_count,amount_kzt,currency,payment_status,generation_status,template_snapshot_json")
    .gte("created_at", fromIso).lt("created_at", toIso).order("created_at").limit(50_000);

  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? "" : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s; // neutralise spreadsheet formula injection
    return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  const header = ["order_number", "created_at", "completed_at", "template", "quality", "faces", "amount_kzt", "currency", "payment_status", "generation_status"];
  const rows = (data ?? []).map((o) => [
    o.public_order_number, o.created_at, o.completed_at, (o.template_snapshot_json as { title_kk?: string }).title_kk,
    o.quality, o.face_count, o.amount_kzt, o.currency, o.payment_status, o.generation_status,
  ].map(esc).join(","));
  await audit(u.id, "orders.export", "orders", null, { from, to, rows: rows.length });

  return new NextResponse("﻿" + [header.join(","), ...rows].join("\n"), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="orders_${from}_${to}.csv"`,
      "cache-control": "no-store",
    },
  });
}
