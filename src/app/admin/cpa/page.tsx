import { Suspense } from "react";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { cpaSettings } from "@/lib/cpa";
import { botUsername, partnerPeriod } from "@/lib/partners";
import { CopyLink } from "../partners/forms";
import { PeriodForm, Tile } from "../partners/ui";
import { CpaForm } from "./form";
import { retryPostback } from "./actions";

export const metadata = { title: ru.admin.cpa.title };
type SP = { from?: string; to?: string };

export default function CpaPage({ searchParams }: { searchParams: Promise<SP> }) {
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
  const C = ru.admin.cpa;
  const per = partnerPeriod(await searchParams);
  const db = supabaseAdmin();
  const [s, bot, clicks, users, { data: pbs }, { data: log }] = await Promise.all([
    cpaSettings(),
    botUsername(),
    db.from("cpa_touches").select("telegram_id", { count: "exact", head: true }).gte("created_at", per.fromIso).lt("created_at", per.toIso),
    db.from("profiles").select("id", { count: "exact", head: true }).not("cpa_click_id", "is", null).gte("cpa_at", per.fromIso).lt("cpa_at", per.toIso),
    db.from("cpa_postbacks").select("event,status,amount_kzt").gte("created_at", per.fromIso).lt("created_at", per.toIso),
    db.from("cpa_postbacks").select("id,event,click_id,amount_kzt,status,http_status,attempts,last_error,created_at,orders(public_order_number)").order("created_at", { ascending: false }).limit(50),
  ]);
  const sales = (pbs ?? []).filter((p) => p.event === "sale");
  const failed = (pbs ?? []).filter((p) => p.status === "failed").length;
  const site = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" });
  const num = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { public_order_number?: string } | null)?.public_order_number ?? "—";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold">{C.title}</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">{C.lead}</p>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">{C.offerUrls}</h2>
        {bot && <CopyLink label={C.urlBot} url={`https://t.me/${bot}?start=o18_{tid}`} />}
        <CopyLink label={C.urlSite} url={`${site}/?o18={tid}`} />
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
          {C.steps.map((x) => <li key={x}>{x}</li>)}
        </ol>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{C.settings}</h2>
        <CpaForm value={s} />
      </section>

      <PeriodForm from={per.from} to={per.to} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={C.clicks} value={String(clicks.count ?? 0)} />
        <Tile label={C.leads} value={String(users.count ?? 0)} />
        <Tile label={C.sales} value={String(sales.length)} />
        <Tile label={C.salesSum} value={formatKzt(sales.reduce((n, p) => n + (p.amount_kzt ?? 0), 0))} />
      </dl>
      {failed > 0 && <p role="alert" className="rounded-card bg-red-50 p-4 text-sm font-medium text-danger">{C.failedAlert(failed)}</p>}

      <section>
        <h2 className="mb-3 font-semibold">{C.log}</h2>
        {log?.length ? (
          <div className="overflow-x-auto rounded-card border border-line bg-white">
            <table className="w-full min-w-[44rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted"><tr>{[C.date, C.event, C.order, C.amount, C.clickId, C.status, ""].map((h, i) => <th key={i} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {log.map((p) => (
                  <tr key={p.id}>
                    <td className="px-4 py-2">{fmt.format(new Date(p.created_at))}</td>
                    <td className="px-4 py-2">{p.event === "sale" ? C.saleEvent : C.leadEvent}</td>
                    <td className="px-4 py-2">{num(p.orders)}</td>
                    <td className="px-4 py-2">{p.amount_kzt ? formatKzt(p.amount_kzt) : "—"}</td>
                    <td className="max-w-40 truncate px-4 py-2 font-mono text-xs">{p.click_id}</td>
                    <td className={`px-4 py-2 ${p.status === "sent" ? "text-success" : p.status === "failed" ? "text-danger" : "text-muted"}`}>
                      {C.statuses[p.status as keyof typeof C.statuses]}{p.http_status ? ` · ${p.http_status}` : ""}{p.last_error && p.status !== "sent" ? ` · ${p.last_error}` : ""}
                    </td>
                    <td className="px-4 py-2">
                      {p.status !== "sent" && (
                        <form action={retryPostback}><input type="hidden" name="id" value={p.id} /><button className="text-xs font-semibold text-brand">{C.retry}</button></form>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{C.empty}</p>}
      </section>
    </div>
  );
}
