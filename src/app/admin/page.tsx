import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { env } from "@/lib/env";
import { isTestPaymentProvider } from "@/lib/payments/types";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { klingStatus } from "@/lib/generation/kling";
import { Badge, Card, PageHead, REASONS, Stat, fmtDate, usd } from "./ui";

type SP = { from?: string; to?: string; p?: string };

type Dash = {
  orders_total: number; orders_paid: number; orders_free: number; orders_test: number;
  revenue_kzt: number; refunds_kzt: number; refunds_count: number; buyers: number; new_users: number; template_views: number;
  gen_completed: number; gen_failed: number; avg_gen_sec: number | null;
  cost_usd: number; cost_video_usd: number; cost_photo_usd: number; cost_free_usd: number;
  pay_invoices: number; pay_succeeded: number; pay_pending: number; pay_failed: number;
  pay_reasons: { reason: string; n: number }[];
  daily: { day: string; orders: number; paid: number; revenue: number; cost_usd: number }[];
  top_templates: { id: string; title: string; orders: number; paid: number; revenue: number; cost_usd: number }[];
  attn_paid_failed: { id: string; number: string; amount_kzt: number; created_at: string }[];
  attn_stuck: { id: string; number: string; status: string; created_at: string }[];
  attn_pending_old: number; attn_duplicates: number;
};

export default function AdminHome({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
const PRESETS = [
  { key: "today", label: "Сегодня" },
  { key: "7", label: "7 дней" },
  { key: "30", label: "30 дней" },
  { key: "month", label: "Этот месяц" },
] as const;

/** Period in Asia/Almaty calendar days: a preset (?p=) or a custom range (?from=&to=). Default 30 days. */
function period(sp: SP) {
  const today = day(new Date());
  const valid = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  let from: string, to = today, key: string = sp.p ?? "30";
  if (valid(sp.from) || valid(sp.to)) {
    to = valid(sp.to) ? sp.to! : today;
    from = valid(sp.from) ? sp.from! : to;
    key = "custom";
  } else if (key === "today") from = today;
  else if (key === "7") from = day(new Date(Date.parse(today) - 6 * 86400_000));
  else if (key === "month") from = `${today.slice(0, 8)}01`;
  else { key = "30"; from = day(new Date(Date.parse(today) - 29 * 86400_000)); }
  return {
    key, from, to,
    fromIso: new Date(`${from}T00:00:00+05:00`).toISOString(),
    toIso: new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400_000).toISOString(),
  };
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");

async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!can(u.role, "dashboard.view")) redirect("/admin/templates");
  const p = period(await searchParams);

  const [{ data, error }, ap] = await Promise.all([
    supabaseAdmin().rpc("admin_dashboard", { p_from: p.fromIso, p_to: p.toIso }),
    seedancePricingSettings(),
  ]);
  if (error || !data) return <p className="text-danger">{ru.errors.generic}</p>;
  const s = data as Dash;
  const rate = ap.tengePerUsd;
  const costKzt = Math.round(Number(s.cost_usd) * rate);
  const profit = s.revenue_kzt - costKzt;
  const finished = s.gen_completed + s.gen_failed;
  const attention = s.attn_paid_failed.length + s.attn_stuck.length + (s.attn_pending_old > 0 ? 1 : 0) + (s.attn_duplicates > 0 ? 1 : 0);

  return (
    <div className="space-y-6">
      <PageHead title="Обзор" lead={`${p.from.split("-").reverse().join(".")} — ${p.to.split("-").reverse().join(".")} · курс ${rate} ₸/$`}>
        <a href={`/api/admin/orders/export?from=${p.from}&to=${p.to}`} className="rounded-full border border-line bg-white px-4 py-2 text-sm font-semibold hover:border-ink">⬇ CSV</a>
      </PageHead>

      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        {PRESETS.map((x) => (
          <Link key={x.key} href={`/admin?p=${x.key}`} className={`rounded-full px-3.5 py-2 text-sm font-semibold ${p.key === x.key ? "bg-night text-white" : "border border-line bg-white hover:border-ink"}`}>{x.label}</Link>
        ))}
        <form className="flex flex-wrap items-center gap-1.5 text-sm">
          <input type="date" name="from" defaultValue={p.from} aria-label="С" className="h-9 rounded-full border border-line bg-white px-3" />
          <span className="text-muted">—</span>
          <input type="date" name="to" defaultValue={p.to} aria-label="По" className="h-9 rounded-full border border-line bg-white px-3" />
          <button className={`h-9 rounded-full px-3.5 font-semibold ${p.key === "custom" ? "bg-night text-white" : "border border-line bg-white hover:border-ink"}`}>Показать</button>
        </form>
      </div>

      {isTestPaymentProvider(env().PAYMENT_PROVIDER) && (
        <p className="rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-900 ring-1 ring-amber-200">🧪 Тестовый режим оплаты: деньги не настоящие.</p>
      )}

      {/* Money */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="dark" label="Выручка" value={formatKzt(s.revenue_kzt)} sub={`${s.pay_succeeded} оплат · ${s.buyers} покупателей`} />
        <Stat label="Расход на AI" value={formatKzt(costKzt)} sub={`${usd(Number(s.cost_usd))}${Number(s.cost_free_usd) > 0 ? ` · из них бесплатные/тест ${usd(Number(s.cost_free_usd))}` : ""}`} href="/admin/services" />
        <Stat tone={profit >= 0 ? "good" : "bad"} label="Прибыль (выручка − AI)" value={formatKzt(profit)} sub={s.revenue_kzt > 0 ? `маржа ${pct(profit, s.revenue_kzt)}` : "оплат пока нет"} />
        <Stat label="Средний чек" value={s.pay_succeeded ? formatKzt(Math.round(s.revenue_kzt / s.pay_succeeded)) : "—"} sub={s.refunds_count ? `возвраты: ${s.refunds_count} · ${formatKzt(s.refunds_kzt)}` : "возвратов нет"} />
      </div>

      {/* Funnel */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Stat label="Просмотры шаблонов" value={s.template_views} />
        <Stat label="Заказы" value={s.orders_total} sub={`конверсия ${pct(s.orders_total, s.template_views)}`} href="/admin/orders" />
        <Stat label="Счета Kaspi" value={s.pay_invoices} sub={`оплачено ${pct(s.pay_succeeded, s.pay_invoices)}`} href="/admin/payments" />
        <Stat label="Оплачено" value={s.orders_paid} sub={`бесплатно ${s.orders_free} · тест ${s.orders_test}`} />
        <Stat label="Готовые видео" value={s.gen_completed} sub={`успех ${pct(s.gen_completed, finished)} · ~${s.avg_gen_sec ? Math.round(s.avg_gen_sec / 60 * 10) / 10 : "—"} мин`} />
        <Stat label="Новые пользователи" value={s.new_users} href="/admin/users" />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <Card title="По дням" action={<span className="flex gap-3 text-xs text-muted"><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#b5d420]" />выручка</span><span><i className="mr-1 inline-block h-2 w-2 rounded-full bg-[#f08f8f]" />AI</span></span>}>
          <Daily rows={s.daily} rate={rate} />
        </Card>

        <Card title={<>Требует внимания {attention > 0 ? <Badge color="red">{attention}</Badge> : <Badge color="green">всё в порядке</Badge>}</>}>
          <ul className="space-y-3 text-sm">
            {s.attn_duplicates > 0 && <li className="rounded-xl bg-red-50 p-3 font-semibold text-red-700">Двойные списания: {s.attn_duplicates} — верните через Tolepay</li>}
            {s.attn_paid_failed.length > 0 && (
              <li>
                <p className="font-semibold">Оплачено, но видео не получилось ({s.attn_paid_failed.length})</p>
                <p className="text-xs text-muted">Перезапустите генерацию или верните деньги</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.attn_paid_failed.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-red-50 px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-100">{o.number} · {formatKzt(o.amount_kzt)}</Link>)}
                </div>
              </li>
            )}
            {s.attn_stuck.length > 0 && (
              <li>
                <p className="font-semibold">Генерация висит дольше 30 мин ({s.attn_stuck.length})</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {s.attn_stuck.map((o) => <Link key={o.id} href={`/admin/orders/${o.id}`} className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-semibold text-amber-800 hover:bg-amber-100">{o.number} · {fmtDate.format(new Date(o.created_at))}</Link>)}
                </div>
              </li>
            )}
            {s.attn_pending_old > 0 && <li><Link href="/admin/orders?state=pending" className="font-semibold hover:underline">Неоплаченные счета старше 2 ч: {s.attn_pending_old}</Link></li>}
            {attention === 0 && <li className="text-muted">Ошибок и зависших заказов нет.</li>}
          </ul>
          {can(u.role, "templates.manage") && (
            <Suspense fallback={null}><KlingMini /></Suspense>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="Шаблоны: что продаётся" action={<Link href="/admin/templates" className="text-sm font-semibold text-muted hover:text-ink">Все →</Link>}>
          {!s.top_templates.length ? <p className="text-sm text-muted">Нет заказов за период</p> : (
            <div className="-mx-5 overflow-x-auto px-5">
              <table className="w-full min-w-[28rem] text-sm">
                <thead className="text-left text-xs text-muted"><tr><th className="py-1.5 font-medium">Шаблон</th><th className="py-1.5 text-right font-medium">Заказы</th><th className="py-1.5 text-right font-medium">Оплачено</th><th className="py-1.5 text-right font-medium">Выручка</th><th className="py-1.5 text-right font-medium">AI</th></tr></thead>
                <tbody className="divide-y divide-line">
                  {s.top_templates.map((t) => (
                    <tr key={t.id}>
                      <td className="py-2 pr-2"><Link href={`/admin/orders?template=${t.id}`} className="font-semibold hover:underline">{t.title}</Link></td>
                      <td className="py-2 text-right">{t.orders}</td>
                      <td className="py-2 text-right">{t.paid}</td>
                      <td className="py-2 text-right font-semibold">{formatKzt(t.revenue)}</td>
                      <td className="py-2 text-right text-muted">{formatKzt(Math.round(Number(t.cost_usd) * rate))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="Оплаты Kaspi (Tolepay)" action={<Link href="/admin/payments" className="text-sm font-semibold text-muted hover:text-ink">Подробнее →</Link>}>
          <div className="grid grid-cols-3 gap-2 text-center text-sm">
            <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xl font-extrabold">{s.pay_succeeded}</p><p className="text-xs text-muted">оплачено</p></div>
            <div className="rounded-xl bg-amber-50 p-3"><p className="text-xl font-extrabold">{s.pay_pending}</p><p className="text-xs text-muted">ждут</p></div>
            <div className="rounded-xl bg-red-50 p-3"><p className="text-xl font-extrabold">{s.pay_failed}</p><p className="text-xs text-muted">не прошли</p></div>
          </div>
          {s.pay_reasons.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm">
              {s.pay_reasons.map((r) => <li key={r.reason} className="flex justify-between gap-3"><span className="text-muted">{REASONS[r.reason] ?? r.reason}</span><b>{r.n}</b></li>)}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}


function Daily({ rows, rate }: { rows: Dash["daily"]; rate: number }) {
  const data = rows.map((r) => ({ ...r, cost: Math.round(Number(r.cost_usd) * rate) }));
  const max = Math.max(1, ...data.map((r) => Math.max(r.revenue, r.cost)));
  if (!data.length) return <p className="text-sm text-muted">Нет данных</p>;
  return (
    <div>
      <div className="flex h-40 items-end gap-[3px]">
        {data.map((r) => (
          <div key={r.day} className="group relative flex h-full min-w-0 flex-1 items-end justify-center gap-px">
            <span className="w-1/2 rounded-t bg-[#b5d420]" style={{ height: `${(r.revenue / max) * 100}%`, minHeight: r.revenue ? 2 : 0 }} />
            <span className="w-1/2 rounded-t bg-[#f08f8f]" style={{ height: `${(r.cost / max) * 100}%`, minHeight: r.cost ? 2 : 0 }} />
            <span className="pointer-events-none absolute bottom-full z-10 mb-1 hidden whitespace-nowrap rounded-lg bg-night px-2 py-1 text-[11px] text-white group-hover:block">
              {r.day.slice(8, 10)}.{r.day.slice(5, 7)} · заказов {r.orders} · оплат {r.paid} · {formatKzt(r.revenue)} · AI {formatKzt(r.cost)}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-muted">
        <span>{data[0].day.slice(8, 10)}.{data[0].day.slice(5, 7)}</span>
        <span>{data[data.length - 1].day.slice(8, 10)}.{data[data.length - 1].day.slice(5, 7)}</span>
      </div>
    </div>
  );
}

/** Kling resource packs, compact (details on the AI page). */
async function KlingMini() {
  const k = await klingStatus();
  if (k.state === "none") return null;
  const packs = k.packs ?? [];
  return (
    <Link href="/admin/services" className="mt-4 block rounded-xl bg-paper p-3 text-sm ring-1 ring-line hover:ring-ink">
      <p className="font-semibold">🤖 Kling {k.state === "ok" ? <Badge color="green">подключено</Badge> : <Badge color="red">{k.state === "auth" ? "ключ отклонён" : "нет связи"}</Badge>}</p>
      {k.state === "ok" && (packs.length ? packs.slice(0, 3).map((p) => (
        <div key={p.name} className="mt-2">
          <div className="flex justify-between text-xs"><span className="truncate">{p.name}</span><b>{p.remaining} / {p.total}</b></div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-line"><div className={`h-full rounded-full ${p.remaining / Math.max(1, p.total) < 0.15 ? "bg-red-400" : "bg-[#b5d420]"}`} style={{ width: `${Math.min(100, (p.remaining / Math.max(1, p.total)) * 100)}%` }} /></div>
        </div>
      )) : <p className="mt-1 text-xs text-red-700">Нет активных пакетов — генерация не пойдёт</p>)}
    </Link>
  );
}
