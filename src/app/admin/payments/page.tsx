import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { ru } from "@/lib/i18n/ru";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { ToleCheckPanel } from "../tole/check";
import { Badge, Card, Chips, PageHead, REASONS, Stat, fmtDate, nowMs } from "../ui";

export const metadata = { title: "Платежи" };

type SP = { s?: string; mode?: string; page?: string };
const PAGE = 40;
const TEST = ["free", "sandbox", "tole_sandbox"];
const STATUS: Record<string, { label: string; color: "green" | "amber" | "red" | "gray" }> = {
  succeeded: { label: "Оплачено", color: "green" },
  pending: { label: "Ждёт оплаты", color: "amber" },
  failed: { label: "Не прошла", color: "red" },
  cancelled: { label: "Отменено", color: "gray" },
  refunded: { label: "Возврат", color: "gray" },
};
const PROVIDER: Record<string, string> = { tole: "Kaspi · Tolepay", tole_sandbox: "Tolepay тест", sandbox: "Тест", free: "Бесплатно", kaspi: "Kaspi" };

export default function PaymentsPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <PageHead title="Платежи · Tolepay" lead="Счета Kaspi через Tolepay: что оплачено, что ждёт, что не прошло и почему." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function Body({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const mode = sp.mode === "all" ? "all" : "real";
  const status = sp.s && STATUS[sp.s] ? sp.s : "";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = supabaseAdmin();
  const since = new Date(nowMs() - 30 * 86400_000).toISOString();

  const scope = <Q,>(q: Q): Q => (mode === "real" ? (q as unknown as { not: (c: string, op: string, v: string) => Q }).not("provider", "in", `(${TEST.join(",")})`) : q);
  let list = scope(db.from("payments")
    .select("id,order_id,provider,status,amount_kzt,failure_reason,provider_outcome,provider_phone_last4,created_at,verified_at,orders(public_order_number,template_snapshot_json)", { count: "exact" })
    .order("created_at", { ascending: false }));
  if (status) list = list.eq("status", status);

  const counts = await Promise.all(["", ...Object.keys(STATUS)].map(async (k) => {
    let q = scope(db.from("payments").select("id", { count: "exact", head: true }));
    if (k) q = q.eq("status", k);
    const { count } = await q;
    return [k, count ?? 0] as const;
  }));
  const [{ data: rows, count }, { data: month }, { data: hooks }] = await Promise.all([
    list.range((page - 1) * PAGE, page * PAGE - 1),
    scope(db.from("payments").select("status,amount_kzt").gte("created_at", since)),
    db.from("webhook_events").select("provider,event_type,created_at,processed_at").order("created_at", { ascending: false }).limit(8),
  ]);
  const c = Object.fromEntries(counts);
  const m = month ?? [];
  const paid = m.filter((x) => x.status === "succeeded");
  const sum = paid.reduce((n, x) => n + x.amount_kzt, 0);
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const href = (o: Partial<SP>) => `/admin/payments?${new URLSearchParams(Object.entries({ mode: mode === "all" ? "all" : "", s: status, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const e = env();

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat tone="dark" label="Оплачено за 30 дней" value={formatKzt(sum)} sub={`${paid.length} оплат`} />
        <Stat label="Конверсия счёт → оплата" value={m.length ? `${Math.round((paid.length / m.length) * 100)}%` : "—"} sub={`${m.length} счетов за 30 дней`} />
        <Stat tone="warn" label="Ждут оплаты" value={c.pending} href={href({ s: "pending", page: "" })} />
        <Stat tone="bad" label="Не прошли" value={c.failed} href={href({ s: "failed", page: "" })} />
      </div>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Chips active={status || "all"} items={[
              { key: "all", label: "Все", count: c[""], href: href({ s: "", page: "" }) },
              ...Object.entries(STATUS).map(([k, v]) => ({ key: k, label: v.label, count: c[k], href: href({ s: k, page: "" }) })),
            ]} />
            <Link href={href({ mode: mode === "all" ? "" : "all", page: "" })} className="mb-4 text-sm font-semibold text-muted hover:text-ink">
              {mode === "all" ? "✓ Включая бесплатные и тест" : "Показать бесплатные и тест"}
            </Link>
          </div>
          {!rows?.length ? <p className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-muted">Платежей нет</p> : (
            <div className="overflow-x-auto rounded-2xl border border-line bg-white">
              <table className="w-full min-w-[40rem] text-left text-sm">
                <thead className="border-b border-line text-xs text-muted"><tr>
                  <th className="px-4 py-3 font-medium">Заказ</th><th className="px-4 py-3 font-medium">Дата</th><th className="px-4 py-3 font-medium">Способ</th>
                  <th className="px-4 py-3 font-medium">Телефон</th><th className="px-4 py-3 text-right font-medium">Сумма</th><th className="px-4 py-3 font-medium">Статус</th>
                </tr></thead>
                <tbody className="divide-y divide-line">
                  {rows.map((p) => {
                    const o = (Array.isArray(p.orders) ? p.orders[0] : p.orders) as { public_order_number?: string; template_snapshot_json?: { title_kk?: string } } | null;
                    const st = STATUS[p.status] ?? { label: p.status, color: "gray" as const };
                    const reason = p.failure_reason || (p.status === "failed" ? p.provider_outcome : null);
                    return (
                      <tr key={p.id} className="hover:bg-paper">
                        <td className="px-4 py-3"><Link href={`/admin/orders/${p.order_id}`} className="font-semibold hover:underline">{o?.public_order_number ?? "—"}</Link><span className="block max-w-[12rem] truncate text-xs text-muted">{o?.template_snapshot_json?.title_kk}</span></td>
                        <td className="px-4 py-3 text-muted">{fmtDate.format(new Date(p.created_at))}</td>
                        <td className="px-4 py-3">{PROVIDER[p.provider] ?? p.provider}</td>
                        <td className="px-4 py-3 font-mono text-xs">{p.provider_phone_last4 ? `•• ${p.provider_phone_last4}` : "—"}</td>
                        <td className="px-4 py-3 text-right font-semibold">{formatKzt(p.amount_kzt)}</td>
                        <td className="px-4 py-3"><Badge color={st.color}>{st.label}</Badge>{reason && <span className="mt-0.5 block text-xs text-red-700">{REASONS[reason] ?? reason}</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {pages > 1 && (
            <nav className="mt-4 flex items-center justify-center gap-3 text-sm">
              {page > 1 && <Link href={href({ page: String(page - 1) })} className="rounded-full border border-line bg-white px-4 py-2">←</Link>}
              <span className="text-muted">{page} / {pages}</span>
              {page < pages && <Link href={href({ page: String(page + 1) })} className="rounded-full border border-line bg-white px-4 py-2">→</Link>}
            </nav>
          )}
        </div>

        <div className="space-y-4">
          <Card title="Подключение">
            <ul className="space-y-1.5 text-sm">
              <li className="flex justify-between gap-3"><span className="text-muted">Режим</span>{e.PAYMENT_PROVIDER === "tole" ? <Badge color="green">боевой</Badge> : <Badge color="amber">{e.PAYMENT_PROVIDER}</Badge>}</li>
              <li className="flex justify-between gap-3"><span className="text-muted">Ключ API</span>{e.TOLE_API_KEY ? <Badge color={e.TOLE_API_KEY.startsWith("tole_sk_live_") ? "green" : "amber"}>{e.TOLE_API_KEY.startsWith("tole_sk_live_") ? "live" : "test"}</Badge> : <Badge color="red">нет</Badge>}</li>
              <li className="flex justify-between gap-3"><span className="text-muted">Connection ID</span>{e.TOLE_CONNECTION_ID ? <Badge color="green">есть</Badge> : <Badge color="red">нет</Badge>}</li>
              <li className="flex justify-between gap-3"><span className="text-muted">Webhook secret</span>{e.TOLE_WEBHOOK_SECRET ? <Badge color="green">есть</Badge> : <Badge color="red">нет</Badge>}</li>
            </ul>
          </Card>
          <ToleCheckPanel />
          <Card title="Последние вебхуки">
            {!hooks?.length ? <p className="text-sm text-muted">Пока не приходили</p> : (
              <ul className="space-y-1.5 text-xs">
                {hooks.map((h, i) => (
                  <li key={i} className="flex justify-between gap-2"><span className="truncate font-mono">{h.event_type}</span><span className="shrink-0 text-muted">{fmtDate.format(new Date(h.created_at))}{h.processed_at ? " ✓" : " …"}</span></li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
