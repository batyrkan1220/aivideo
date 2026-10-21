import { Suspense } from "react";
import { redirect } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { env } from "@/lib/env";

const S = kk.admin.stats;
type SP = { from?: string; to?: string };

type Stats = {
  orders_total: number; orders_paid: number; generations_completed: number; generations_failed: number;
  revenue_kzt: number; refunds_kzt: number; refunds_count: number; avg_generation_sec: number | null;
  provider_cost: number | null; template_views: number; active_templates: number; duplicate_charges: number;
  top_templates: { id: string; title: string; paid: number }[];
  by_quality: { quality: string; orders: number; paid: number }[];
};

export default function AdminHome({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <Overview searchParams={searchParams} />
    </Suspense>
  );
}

/** Default period: last 30 days (Asia/Almaty calendar dates). */
function period(sp: SP) {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(d);
  const to = sp.to && /^\d{4}-\d{2}-\d{2}$/.test(sp.to) ? sp.to : day(new Date());
  const from = sp.from && /^\d{4}-\d{2}-\d{2}$/.test(sp.from) ? sp.from : day(new Date(Date.parse(to) - 29 * 86400_000));
  return {
    from, to,
    fromIso: new Date(`${from}T00:00:00+05:00`).toISOString(),
    toIso: new Date(new Date(`${to}T00:00:00+05:00`).getTime() + 86400_000).toISOString(),
  };
}

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 1000) / 10}%` : "—");

async function Overview({ searchParams }: { searchParams: Promise<SP> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin");
  if (!can(u.role, "dashboard.view")) redirect("/admin/templates");
  const p = period(await searchParams);

  const { data, error } = await supabaseAdmin().rpc("admin_stats", { p_from: p.fromIso, p_to: p.toIso });
  if (error || !data) return <p className="text-danger">{kk.errors.generic}</p>;
  const s = data as Stats;
  const finished = s.generations_completed + s.generations_failed;
  const cost = s.provider_cost === null ? null : Number(s.provider_cost);

  const tile = (label: string, value: string) => (
    <div className="rounded-card border border-line bg-white p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
    </div>
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-2xl font-bold">{kk.admin.nav.overview}</h1>
        <form className="flex flex-wrap items-end gap-2 text-sm">
          <label><span className="block text-xs text-muted">{S.from}</span><input type="date" name="from" defaultValue={p.from} className="rounded-xl border border-line px-3 py-2 text-base sm:text-sm" /></label>
          <label><span className="block text-xs text-muted">{S.to}</span><input type="date" name="to" defaultValue={p.to} className="rounded-xl border border-line px-3 py-2 text-base sm:text-sm" /></label>
          <button className="rounded-full bg-ink px-4 py-2 font-semibold text-white">{S.apply}</button>
          <a href={`/api/admin/orders/export?from=${p.from}&to=${p.to}`} className="rounded-full border border-line px-4 py-2 font-semibold hover:border-ink">{S.export}</a>
        </form>
      </div>

      {env().PAYMENT_PROVIDER === "sandbox" && (
        <p className="rounded-card bg-flash/20 p-4 text-sm font-medium">{S.sandboxNote}</p>
      )}
      {s.duplicate_charges > 0 && (
        <p role="alert" className="rounded-card bg-red-50 p-4 text-sm font-medium text-danger">{S.duplicateAlert(s.duplicate_charges)}</p>
      )}

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tile(S.ordersTotal, String(s.orders_total))}
        {tile(S.ordersPaid, String(s.orders_paid))}
        {tile(S.revenue, formatKzt(s.revenue_kzt))}
        {tile(S.refunds, `${formatKzt(s.refunds_kzt)} (${s.refunds_count})`)}
        {tile(S.completed, String(s.generations_completed))}
        {tile(S.failed, String(s.generations_failed))}
        {tile(S.successRate, pct(s.generations_completed, finished))}
        {tile(S.avgTime, s.avg_generation_sec === null ? "—" : S.sec(s.avg_generation_sec))}
        {tile(S.conversion, pct(s.orders_paid, s.template_views))}
        {tile(S.refundRate, pct(s.refunds_count, s.orders_paid))}
        {tile(S.providerCost, cost === null ? "—" : `$${cost.toFixed(2)}`)}
        {tile(S.costPerGen, cost === null || !s.generations_completed ? "—" : `$${(cost / s.generations_completed).toFixed(2)}`)}
        {tile(S.activeTemplates, String(s.active_templates))}
      </dl>
      <p className="-mt-4 text-xs text-muted">{S.margin}: {cost === null ? "—" : S.marginNote}</p>

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-card border border-line bg-white p-5">
          <h2 className="mb-3 font-semibold">{S.topTemplates}</h2>
          {!s.top_templates.length ? <p className="text-sm text-muted">{S.noData}</p> : (
            <ol className="space-y-2 text-sm">
              {s.top_templates.map((t, i) => (
                <li key={t.id} className="flex justify-between gap-3"><span>{i + 1}. {t.title}</span><span className="font-semibold">{t.paid}</span></li>
              ))}
            </ol>
          )}
        </section>
        <section className="rounded-card border border-line bg-white p-5">
          <h2 className="mb-3 font-semibold">{S.byQuality}</h2>
          {!s.by_quality.length ? <p className="text-sm text-muted">{S.noData}</p> : (
            <ul className="space-y-2 text-sm">
              {s.by_quality.map((q) => (
                <li key={q.quality} className="flex justify-between gap-3"><span>{q.quality}</span><span>{q.paid} / {q.orders}</span></li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
