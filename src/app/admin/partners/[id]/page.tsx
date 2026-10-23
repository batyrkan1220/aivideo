import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { botUsername, partnerDaily, partnerLinks, partnerPeriod, partnerPeriodTotals, partnerTotals } from "@/lib/partners";
import { CopyLink, EditPartnerForm, PayoutForm, TeliksAccessForm } from "../forms";
import { processPayoutRequest } from "../actions";
import { teliksConfigured, teliksPayoutDetails, teliksPayoutRequests } from "@/lib/partners/teliks";
import { env } from "@/lib/env";
import { DailyTable, PeriodForm, Tile } from "../ui";

type SP = { from?: string; to?: string };

export default function PartnerPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <Content params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return <p className="py-16 text-center text-muted">{ru.admin.forbidden}</p>;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const T = ru.admin.partners;
  const per = partnerPeriod(await searchParams);
  const db = supabaseAdmin();
  const { data: p } = await db.from("partners").select("*").eq("id", id).maybeSingle();
  if (!p) notFound();

  const [period, all, daily, bot, { data: users }, { data: comms }, { data: payouts }, requests, payDetails] = await Promise.all([
    partnerPeriodTotals(per.fromIso, per.toIso),
    partnerTotals(),
    partnerDaily(id, per.fromIso, per.toIso),
    botUsername(),
    db.from("profiles").select("id,display_name,telegram_username,email,referred_at").eq("referred_by", id).order("referred_at", { ascending: false }).limit(100),
    db.from("partner_commissions").select("order_id,user_id,order_amount_kzt,percent,commission_kzt,status,created_at,orders(public_order_number)").eq("partner_id", id).order("created_at", { ascending: false }).limit(100),
    db.from("partner_payouts").select("amount_kzt,note,created_at").eq("partner_id", id).order("created_at", { ascending: false }).limit(50),
    teliksPayoutRequests(p.teliks_user_id).catch(() => []),
    teliksPayoutDetails(p.teliks_user_id).catch(() => null),
  ]);
  const t = period.get(id);
  const a = all.get(id);
  const links = partnerLinks(p.code, bot);
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Almaty" });
  const paidBy = new Map<string, { n: number; sum: number }>();
  for (const c of comms ?? []) if (c.status === "earned" && c.user_id) {
    const x = paidBy.get(c.user_id) ?? { n: 0, sum: 0 };
    paidBy.set(c.user_id, { n: x.n + 1, sum: x.sum + c.order_amount_kzt });
  }
  const who = (x: { display_name: string | null; telegram_username: string | null; email: string | null }) =>
    x.telegram_username ? `@${x.telegram_username}` : x.email && !x.email.endsWith("@telegram.trendme.kz") ? x.email : x.display_name ?? "—";
  const num = (o: unknown) => ((Array.isArray(o) ? o[0] : o) as { public_order_number?: string } | null)?.public_order_number ?? "—";

  return (
    <div className="space-y-6">
      <Link href="/admin/partners" className="text-sm text-muted hover:text-ink">← {T.title}</Link>
      <div className="flex flex-wrap items-baseline gap-3">
        <h1 className="font-display text-2xl font-bold">{p.name}</h1>
        <span className="text-sm text-muted">{Number(p.percent)}% · {p.code}{p.active ? "" : ` · ${T.inactive}`}</span>
      </div>

      <section className="space-y-2">
        <h2 className="font-semibold">{T.links}</h2>
        {links.bot && <CopyLink label={T.linkBot} url={links.bot} />}
        {links.app && <CopyLink label={T.linkApp} url={links.app} />}
        <CopyLink label={T.linkSite} url={links.site} />
        <p className="text-xs text-muted">{T.linksHint}</p>
        <p className="text-xs text-muted">{p.telegram_id ? T.tgLinked : p.telegram_username ? T.tgPending(p.telegram_username) : T.tgNone}</p>
      </section>

      <PeriodForm from={per.from} to={per.to} />
      <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Tile label={T.visits} value={String(t?.visits ?? 0)} />
        <Tile label={T.users} value={String(t?.users ?? 0)} />
        <Tile label={T.buyers} value={String(t?.buyers ?? 0)} />
        <Tile label={T.paidOrders} value={String(t?.paidOrders ?? 0)} />
        <Tile label={T.revenue} value={formatKzt(t?.revenueKzt ?? 0)} />
        <Tile label={T.earned} value={formatKzt(t?.earnedKzt ?? 0)} />
        <Tile label={T.paidOutAll} value={formatKzt(a?.paidOutKzt ?? 0)} />
        <Tile label={T.balance} value={formatKzt(a?.balanceKzt ?? 0)} />
      </dl>

      <section>
        <h2 className="mb-3 font-semibold">{T.byDay}</h2>
        <DailyTable rows={daily} />
      </section>

      <section>
        <h2 className="mb-1 font-semibold">{T.teliks}</h2>
        <p className="mb-3 text-sm text-muted">{T.teliksHint}</p>
        <div className="space-y-4 rounded-card border border-line bg-white p-5">
          {teliksConfigured() ? <TeliksAccessForm id={id} email={p.teliks_email} teliksUrl={env().TELIKS_URL} /> : <p className="text-sm text-danger">{T.teliksNotConfigured}</p>}
          {p.teliks_user_id && (
            <div>
              <h3 className="text-sm font-semibold">{T.requests}</h3>
              {payDetails?.method && <p className="mt-1 text-xs text-muted">{T.details}: {payDetails.method} · {payDetails.value}</p>}
              {requests.length ? (
                <ul className="mt-2 divide-y divide-line text-sm">
                  {requests.map((r) => (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
                      <span>{fmt.format(new Date(r.created_at))} · <b>{formatKzt(r.amount_kzt)}</b> · {r.method} {r.details}</span>
                      {r.status === "processing" ? (
                        <form action={processPayoutRequest} className="flex gap-2">
                          <input type="hidden" name="id" value={id} /><input type="hidden" name="request" value={r.id} />
                          <button name="action" value="paid" className="rounded-full bg-success px-3 py-1 text-xs font-semibold text-white">{T.markPaid}</button>
                          <button name="action" value="rejected" className="rounded-full border border-line px-3 py-1 text-xs font-semibold">{T.reject}</button>
                        </form>
                      ) : <span className={r.status === "paid" ? "text-success" : "text-muted"}>{T.requestStatus[r.status] ?? r.status}</span>}
                    </li>
                  ))}
                </ul>
              ) : <p className="mt-1 text-sm text-muted">{T.requestsNone}</p>}
            </div>
          )}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{T.payouts}</h2>
        <div className="rounded-card border border-line bg-white p-5">
          <PayoutForm id={id} />
          {payouts?.length ? (
            <ul className="mt-4 divide-y divide-line text-sm">
              {payouts.map((x, i) => <li key={i} className="flex justify-between gap-3 py-2"><span>{fmt.format(new Date(x.created_at))}{x.note ? ` · ${x.note}` : ""}</span><b>{formatKzt(x.amount_kzt)}</b></li>)}
            </ul>
          ) : <p className="mt-3 text-sm text-muted">{T.noPayouts}</p>}
        </div>
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{T.commissions}</h2>
        {comms?.length ? (
          <div className="overflow-x-auto rounded-card border border-line bg-white">
            <table className="w-full min-w-[36rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted"><tr>{[T.date, T.order, T.amount, T.percentShort, T.commission, T.status].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {comms.map((c) => (
                  <tr key={c.order_id} className={c.status === "reversed" ? "text-muted line-through" : ""}>
                    <td className="px-4 py-2">{fmt.format(new Date(c.created_at))}</td>
                    <td className="px-4 py-2"><Link href={`/admin/orders/${c.order_id}`} className="text-brand hover:underline">{num(c.orders)}</Link></td>
                    <td className="px-4 py-2">{formatKzt(c.order_amount_kzt)}</td>
                    <td className="px-4 py-2">{Number(c.percent)}%</td>
                    <td className="px-4 py-2 font-semibold">{formatKzt(c.commission_kzt)}</td>
                    <td className="px-4 py-2">{c.status === "earned" ? T.earnedStatus : T.reversedStatus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{T.noData}</p>}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{T.referredUsers(users?.length ?? 0)}</h2>
        {users?.length ? (
          <div className="overflow-x-auto rounded-card border border-line bg-white">
            <table className="w-full min-w-[30rem] text-left text-sm">
              <thead className="border-b border-line text-xs text-muted"><tr>{[T.client, T.joined, T.paidOrders, T.revenue].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">
                {users.map((x) => (
                  <tr key={x.id}>
                    <td className="px-4 py-2">{who(x)}</td>
                    <td className="px-4 py-2">{x.referred_at ? fmt.format(new Date(x.referred_at)) : "—"}</td>
                    <td className="px-4 py-2">{paidBy.get(x.id)?.n ?? 0}</td>
                    <td className="px-4 py-2">{formatKzt(paidBy.get(x.id)?.sum ?? 0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{T.noData}</p>}
      </section>

      <section>
        <h2 className="mb-3 font-semibold">{T.settings}</h2>
        <EditPartnerForm p={{ id: p.id, name: p.name, code: p.code, telegram_username: p.telegram_username, percent: Number(p.percent), contact: p.contact, notes: p.notes, active: p.active }} />
      </section>
    </div>
  );
}
