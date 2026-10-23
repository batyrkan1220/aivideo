import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { partnerDaily, partnerDefaults, partnerPeriod, partnerPeriodTotals, partnerTotals } from "@/lib/partners";
import { CreatePartnerForm, PartnerDefaultsForm } from "./forms";
import { PeriodForm, DailyTable, Tile } from "./ui";

export const metadata = { title: ru.admin.partners.title };
type SP = { from?: string; to?: string };

export default function PartnersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return <p className="py-16 text-center text-muted">{ru.admin.forbidden}</p>;
  const T = ru.admin.partners;
  const per = partnerPeriod(await searchParams);
  const [{ data: partners }, period, all, daily, defaults] = await Promise.all([
    supabaseAdmin().from("partners").select("id,name,code,percent,active,telegram_username,telegram_id").order("created_at", { ascending: false }),
    partnerPeriodTotals(per.fromIso, per.toIso),
    partnerTotals(),
    partnerDaily(null, per.fromIso, per.toIso),
    partnerDefaults(),
  ]);
  const sum = (k: "visits" | "users" | "buyers" | "paidOrders" | "revenueKzt" | "earnedKzt") => [...period.values()].reduce((n, t) => n + t[k], 0);
  const balance = [...all.values()].reduce((n, t) => n + t.balanceKzt, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold">{T.title}</h1>
          <p className="mt-1 max-w-2xl text-sm text-muted">{T.lead}</p>
        </div>
        <CreatePartnerForm />
      </div>

      <PartnerDefaultsForm value={defaults} />

      <PeriodForm from={per.from} to={per.to} />

      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={T.visits} value={String(sum("visits"))} />
        <Tile label={T.users} value={String(sum("users"))} />
        <Tile label={T.buyers} value={String(sum("buyers"))} />
        <Tile label={T.paidOrders} value={String(sum("paidOrders"))} />
        <Tile label={T.revenue} value={formatKzt(sum("revenueKzt"))} />
        <Tile label={T.earned} value={formatKzt(sum("earnedKzt"))} />
        <Tile label={T.conversion} value={sum("users") ? `${Math.round((sum("buyers") / sum("users")) * 1000) / 10}%` : "—"} />
        <Tile label={T.balanceAll} value={formatKzt(balance)} />
      </dl>

      {!partners?.length ? (
        <p className="rounded-card border border-dashed border-line bg-white p-10 text-center text-muted">{T.empty}</p>
      ) : (
        <div className="overflow-x-auto rounded-card border border-line bg-white">
          <table className="w-full min-w-[56rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>{[T.partner, T.percentShort, T.visits, T.users, T.buyers, T.paidOrders, T.revenue, T.earned, T.balance].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
            </thead>
            <tbody className="divide-y divide-line">
              {partners.map((p) => {
                const t = period.get(p.id);
                const a = all.get(p.id);
                return (
                  <tr key={p.id} className={`hover:bg-paper ${p.active ? "" : "opacity-50"}`}>
                    <td className="px-4 py-3">
                      <Link href={`/admin/partners/${p.id}?from=${per.from}&to=${per.to}`} className="font-semibold text-brand hover:underline">{p.name}</Link>
                      <span className="block text-xs text-muted">{p.code}{p.telegram_username ? ` · @${p.telegram_username}${p.telegram_id ? " ✓" : ""}` : ""}</span>
                    </td>
                    <td className="px-4 py-3">{Number(p.percent)}%</td>
                    <td className="px-4 py-3">{t?.visits ?? 0}</td>
                    <td className="px-4 py-3">{t?.users ?? 0}</td>
                    <td className="px-4 py-3">{t?.buyers ?? 0}</td>
                    <td className="px-4 py-3">{t?.paidOrders ?? 0}</td>
                    <td className="px-4 py-3">{formatKzt(t?.revenueKzt ?? 0)}</td>
                    <td className="px-4 py-3">{formatKzt(t?.earnedKzt ?? 0)}</td>
                    <td className="px-4 py-3 font-semibold">{formatKzt(a?.balanceKzt ?? 0)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <section>
        <h2 className="mb-3 font-semibold">{T.byDay}</h2>
        <DailyTable rows={daily} />
      </section>
    </div>
  );
}
