import { Suspense } from "react";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { Chips, PageHead, nowMs } from "../ui";

export const metadata = { title: "Воронка по рекламе" };
type SP = { d?: string };
const RANGES = { "1": "Сегодня", "7": "7 дней", "30": "30 дней" } as const;

export default function FunnelPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <PageHead title="Воронка по рекламе" lead="Сколько людей с каждой рекламы дошли до каждого шага. Источник — utm_source / utm_campaign в ссылке (или ttclid / fbclid)." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Row = { key: string; src: string; cmp: string; visitors: Set<string>; photo: Set<string>; orders: Set<string>; paid: number; revenue: number };

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "dashboard.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const d = sp.d && sp.d in RANGES ? sp.d : "7";
  const from = d === "1"
    ? new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00+05:00`).toISOString()
    : new Date(nowMs() - Number(d) * 86400_000).toISOString();
  const db = supabaseAdmin();
  const [{ data: ev }, { data: paid }] = await Promise.all([
    db.from("analytics_events").select("event_name,user_id,order_id,properties")
      .in("event_name", ["template_viewed", "upload_completed", "checkout_initiated"]).gte("created_at", from).limit(50000),
    db.from("orders").select("id,amount_kzt,ad_ctx").eq("payment_status", "succeeded").is("parent_order_id", null).gte("created_at", from).limit(20000),
  ]);

  const rows = new Map<string, Row>();
  const row = (src?: string, cmp?: string) => {
    const s = src || "", c = cmp || "";
    const key = `${s}|${c}`;
    let r = rows.get(key);
    if (!r) { r = { key, src: s, cmp: c, visitors: new Set(), photo: new Set(), orders: new Set(), paid: 0, revenue: 0 }; rows.set(key, r); }
    return r;
  };
  for (const e of ev ?? []) {
    const p = (e.properties ?? {}) as { src?: string; cmp?: string; vid?: string };
    const who = p.vid ?? e.user_id ?? "";
    if (!who && e.event_name !== "checkout_initiated") continue;
    const r = row(p.src, p.cmp);
    if (e.event_name === "template_viewed") r.visitors.add(who);
    else if (e.event_name === "upload_completed") r.photo.add(who);
    else if (e.order_id) r.orders.add(e.order_id);
  }
  for (const o of paid ?? []) {
    const c = (o.ad_ctx ?? {}) as { src?: string; cmp?: string };
    const r = row(c.src, c.cmp);
    r.paid += 1;
    r.revenue += Number(o.amount_kzt) || 0;
  }
  const list = [...rows.values()].sort((a, b) => b.revenue - a.revenue || b.visitors.size - a.visitors.size);
  const total = list.reduce((t, r) => ({ v: t.v + r.visitors.size, p: t.p + r.photo.size, o: t.o + r.orders.size, paid: t.paid + r.paid, rev: t.rev + r.revenue }), { v: 0, p: 0, o: 0, paid: 0, rev: 0 });
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "—");

  return (
    <>
      <Chips active={d} items={Object.entries(RANGES).map(([k, v]) => ({ key: k, label: v, href: `/admin/funnel?d=${k}` }))} />
      <div className="-mx-4 overflow-x-auto px-4">
        <table className="w-full min-w-[46rem] text-sm">
          <thead className="text-left text-xs text-muted"><tr>
            <th className="py-2 pr-3 font-medium">Источник · кампания</th>
            <th className="py-2 pr-3 text-right font-medium">Открыли шаблон</th>
            <th className="py-2 pr-3 text-right font-medium">Загрузили фото</th>
            <th className="py-2 pr-3 text-right font-medium">Нажали «Оплатить»</th>
            <th className="py-2 pr-3 text-right font-medium">Оплатили</th>
            <th className="py-2 pr-3 text-right font-medium">Выручка</th>
            <th className="py-2 text-right font-medium">Конверсия</th>
          </tr></thead>
          <tbody className="divide-y divide-line bg-white">
            <tr className="font-bold">
              <td className="py-2.5 pl-3 pr-3">Всего</td>
              <td className="pr-3 text-right">{total.v}</td>
              <td className="pr-3 text-right">{total.p} <span className="text-xs font-normal text-muted">{pct(total.p, total.v)}</span></td>
              <td className="pr-3 text-right">{total.o} <span className="text-xs font-normal text-muted">{pct(total.o, total.p)}</span></td>
              <td className="pr-3 text-right">{total.paid} <span className="text-xs font-normal text-muted">{pct(total.paid, total.o)}</span></td>
              <td className="pr-3 text-right">{formatKzt(total.rev)}</td>
              <td className="pr-3 text-right">{pct(total.paid, total.v)}</td>
            </tr>
            {list.map((r) => (
              <tr key={r.key}>
                <td className="py-2.5 pl-3 pr-3">
                  <span className="font-semibold">{r.src ? r.src : "Без метки (прямые, поиск)"}</span>
                  {r.cmp && <span className="block text-xs text-muted">{r.cmp}</span>}
                </td>
                <td className="pr-3 text-right">{r.visitors.size}</td>
                <td className="pr-3 text-right">{r.photo.size} <span className="text-xs text-muted">{pct(r.photo.size, r.visitors.size)}</span></td>
                <td className="pr-3 text-right">{r.orders.size} <span className="text-xs text-muted">{pct(r.orders.size, r.photo.size)}</span></td>
                <td className="pr-3 text-right">{r.paid} <span className="text-xs text-muted">{pct(r.paid, r.orders.size)}</span></td>
                <td className="pr-3 text-right font-semibold">{formatKzt(r.revenue)}</td>
                <td className="pr-3 text-right">{pct(r.paid, r.visitors.size)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <section className="mt-6 rounded-card border border-line bg-white p-5 text-sm">
        <h2 className="font-semibold">Как размечать рекламу</h2>
        <p className="mt-1 text-muted">Добавьте к ссылке источник и название объявления — каждая строка выше станет отдельной рекламой:</p>
        <code className="mt-2 block break-all rounded-xl bg-paper p-3 text-xs">https://trendme.kz/go/&lt;id шаблона&gt;?utm_source=tiktok&amp;utm_campaign=gangnam_v1</code>
        <p className="mt-2 text-xs text-muted">Процент рядом с числом — переход с предыдущего шага. «Конверсия» — от открывших шаблон до оплативших. Люди считаются по анонимному id браузера; данные о том, кто открыл шаблон, собираются с момента этого обновления.</p>
      </section>
    </>
  );
}
