import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { unitsFromUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { Badge, Chips, PageHead, fmtDate, orderState } from "../ui";

type SP = { q?: string; state?: string; template?: string; from?: string; to?: string; page?: string };
const PAGE = 30;

/** One filter per thing the team actually asks: what's waiting, what's running, what broke. */
const STATES = {
  all: { label: "Все" },
  pending: { label: "Ждут оплаты" },
  working: { label: "В работе" },
  done: { label: "Готово" },
  failed: { label: "Ошибка" },
  payfail: { label: "Оплата не прошла" },
  refunded: { label: "Возврат" },
} as const;
type StateKey = keyof typeof STATES;

export default function AdminOrdersPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <PageHead title="Заказы" lead="Поиск по номеру (TM-100014), e-mail, @telegram или телефону." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type F = { eq: (c: string, v: string) => F; in: (c: string, v: string[]) => F };
function applyState<Q>(query: Q, s: StateKey): Q {
  const q = query as unknown as F;
  const r = ((): F => { switch (s) {
    case "pending": return q.eq("payment_status", "pending");
    case "working": return q.eq("payment_status", "succeeded").in("generation_status", ["queued", "processing", "postprocessing"]);
    case "done": return q.eq("payment_status", "succeeded").eq("generation_status", "completed");
    case "failed": return q.eq("payment_status", "succeeded").in("generation_status", ["failed", "cancelled"]);
    case "payfail": return q.in("payment_status", ["failed", "cancelled"]);
    case "refunded": return q.eq("payment_status", "refunded");
    default: return q;
  } })();
  return r as unknown as Q;
}

async function List({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/orders");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const state: StateKey = sp.state && sp.state in STATES ? (sp.state as StateKey) : "all";
  const page = Math.max(1, Number(sp.page) || 1);
  const db = supabaseAdmin();
  const ap = await seedancePricingSettings();

  // Search → order number, or matching users (e-mail, @telegram, name, phone).
  const term = (sp.q ?? "").trim().slice(0, 80);
  let userIds: string[] | null = null;
  let number: string | null = null;
  if (term) {
    const m = /^(?:t[vm]-?)?(\d{3,9})$/i.exec(term);
    if (m) number = `TM-${m[1]}`;
    else {
      const t = term.replace(/^@/, "").replace(/[%_,()]/g, "");
      const digits = t.replace(/\D/g, "");
      const ors = [`email.ilike.%${t}%`, `telegram_username.ilike.%${t}%`, `display_name.ilike.%${t}%`];
      if (digits.length >= 4) ors.push(`phone.ilike.%${digits}%`);
      const { data: ps } = await db.from("profiles").select("id").or(ors.join(",")).limit(100);
      userIds = (ps ?? []).map((p) => p.id);
    }
  }

  const base = () => {
    let q = db.from("orders").select("id", { count: "exact", head: true }).is("parent_order_id", null);
    if (number) q = q.eq("public_order_number", number);
    if (userIds) q = q.in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
    if (sp.template) q = q.eq("template_id", sp.template);
    if (sp.from) q = q.gte("created_at", new Date(`${sp.from}T00:00:00+05:00`).toISOString());
    if (sp.to) q = q.lt("created_at", new Date(new Date(`${sp.to}T00:00:00+05:00`).getTime() + 86400_000).toISOString());
    return q;
  };

  let q = db.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json,profiles(email,telegram_username,display_name,phone),generation_jobs(provider,provider_cost),payments(provider,status)", { count: "exact" })
    .is("parent_order_id", null)
    .order("created_at", { ascending: false });
  if (number) q = q.eq("public_order_number", number);
  if (userIds) q = q.in("user_id", userIds.length ? userIds : ["00000000-0000-0000-0000-000000000000"]);
  if (sp.template) q = q.eq("template_id", sp.template);
  if (sp.from) q = q.gte("created_at", new Date(`${sp.from}T00:00:00+05:00`).toISOString());
  if (sp.to) q = q.lt("created_at", new Date(new Date(`${sp.to}T00:00:00+05:00`).getTime() + 86400_000).toISOString());
  q = applyState(q, state);

  const [{ data: orders, count }, { data: templates }, ...counts] = await Promise.all([
    q.range((page - 1) * PAGE, page * PAGE - 1),
    db.from("templates").select("id,title_kk").is("deleted_at", null).in("kind", ["catalog", "combo"]).order("title_kk"),
    ...(Object.keys(STATES) as StateKey[]).map((k) => applyState(base(), k)),
  ]);
  const countOf = Object.fromEntries((Object.keys(STATES) as StateKey[]).map((k, i) => [k, (counts[i] as { count: number | null }).count ?? 0]));
  const pages = Math.max(1, Math.ceil((count ?? 0) / PAGE));
  const keep = Object.fromEntries(Object.entries(sp).filter(([k, v]) => v && k !== "page" && k !== "state")) as Record<string, string>;
  const href = (o: Record<string, string>) => `/admin/orders?${new URLSearchParams({ ...keep, ...(state !== "all" ? { state } : {}), ...o })}`;
  const input = "h-10 rounded-full border border-line bg-white px-4 text-base sm:text-sm";

  return (
    <>
      <Chips active={state} items={(Object.keys(STATES) as StateKey[]).map((k) => ({
        key: k, label: STATES[k].label, count: countOf[k],
        href: `/admin/orders?${new URLSearchParams({ ...keep, ...(k !== "all" ? { state: k } : {}) })}`,
      }))} />

      <form className="mb-5 flex flex-wrap gap-2">
        {state !== "all" && <input type="hidden" name="state" value={state} />}
        <input name="q" defaultValue={sp.q} placeholder="TM-100014, e-mail, @username, телефон" className={`${input} w-full sm:w-auto sm:min-w-64 sm:flex-1`} />
        <select name="template" defaultValue={sp.template ?? ""} className={input}>
          <option value="">Все шаблоны</option>
          {(templates ?? []).map((t) => <option key={t.id} value={t.id}>{t.title_kk}</option>)}
        </select>
        <input type="date" name="from" defaultValue={sp.from} aria-label="С" className={input} />
        <input type="date" name="to" defaultValue={sp.to} aria-label="По" className={input} />
        <button className="h-10 rounded-full bg-night px-5 text-sm font-semibold text-white">Найти</button>
        {(sp.q || sp.template || sp.from || sp.to) && <Link href={state !== "all" ? `/admin/orders?state=${state}` : "/admin/orders"} className="flex h-10 items-center px-2 text-sm font-semibold text-muted hover:text-ink">Сбросить</Link>}
      </form>

      {!orders?.length ? (
        <p className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-muted">Заказы не найдены</p>
      ) : (
        <div className="overflow-x-auto rounded-2xl border border-line bg-white">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="border-b border-line text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Заказ</th><th className="px-4 py-3 font-medium">Клиент</th><th className="px-4 py-3 font-medium">Шаблон</th>
                <th className="px-4 py-3 text-right font-medium">Сумма</th><th className="px-4 py-3 text-right font-medium">ИИ · прибыль</th><th className="px-4 py-3 font-medium">Статус</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {orders.map((o) => {
                const prof = (Array.isArray(o.profiles) ? o.profiles[0] : o.profiles) as { email?: string | null; telegram_username?: string | null; display_name?: string | null; phone?: string | null } | null;
                const pays = (Array.isArray(o.payments) ? o.payments : o.payments ? [o.payments] : []) as { provider: string; status: string }[];
                const providers = pays.filter((p) => p.status === "succeeded").map((p) => p.provider);
                const st = orderState(o.payment_status, o.generation_status, o.amount_kzt, providers);
                const jobs = (Array.isArray(o.generation_jobs) ? o.generation_jobs : o.generation_jobs ? [o.generation_jobs] : []) as { provider: string; provider_cost: number | null }[];
                const usdCost = jobs.reduce((n, j) => n + (Number(j.provider_cost) || 0), 0);
                const videoUsd = jobs.filter((j) => j.provider === "seedance").reduce((n, j) => n + (Number(j.provider_cost) || 0), 0);
                const units = unitsFromUsd(videoUsd, ap);
                const cost = Math.round(usdCost * ap.tengePerUsd);
                const real = providers.some((p) => !["free", "sandbox", "tole_sandbox"].includes(p));
                const snap = o.template_snapshot_json as { title_kk?: string; provider_key?: string };
                const who = prof?.display_name || (prof?.telegram_username ? `@${prof.telegram_username}` : null) || prof?.email || null;
                return (
                  <tr key={o.id} className="hover:bg-paper">
                    <td className="px-4 py-3">
                      <Link href={`/admin/orders/${o.id}`} className="font-bold hover:underline">{o.public_order_number}</Link>
                      {units !== null && <span className="ml-2 text-xs font-semibold text-night">{units.toLocaleString("ru-RU", { maximumFractionDigits: 2 })} юн.</span>}
                      <span className="block text-xs text-muted">{fmtDate.format(new Date(o.created_at))}</span>
                    </td>
                    <td className="px-4 py-3">
                      {who ? <span className="block max-w-[14rem] truncate font-medium">{who}</span> : <span className="text-muted">Удалённый аккаунт</span>}
                      <span className="block max-w-[14rem] truncate text-xs text-muted">{[prof?.telegram_username && prof.display_name ? `@${prof.telegram_username}` : null, prof?.phone].filter(Boolean).join(" · ")}</span>
                    </td>
                    <td className="px-4 py-3"><span className="mr-1">{snap.provider_key === "combo" ? "📸" : snap.provider_key === "kling_photo" ? "🖼" : "🎬"}</span>{snap.title_kk}</td>
                    <td className="px-4 py-3 text-right font-semibold">{formatKzt(o.amount_kzt)}</td>
                    <td className="px-4 py-3 text-right text-xs">
                      {usdCost ? <>{formatKzt(cost)}{real && <span className={`block font-semibold ${o.amount_kzt - cost >= 0 ? "text-success" : "text-danger"}`}>{o.amount_kzt - cost >= 0 ? "+" : ""}{formatKzt(o.amount_kzt - cost)}</span>}</> : <span className="text-muted">—</span>}
                    </td>
                    <td className="px-4 py-3"><Badge color={st.color}>{st.label}</Badge></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {pages > 1 && (
        <nav className="mt-5 flex items-center justify-center gap-3 text-sm">
          {page > 1 && <Link href={href({ page: String(page - 1) })} className="rounded-full border border-line bg-white px-4 py-2">← Назад</Link>}
          <span className="text-muted">{page} / {pages}</span>
          {page < pages && <Link href={href({ page: String(page + 1) })} className="rounded-full border border-line bg-white px-4 py-2">Дальше →</Link>}
        </nav>
      )}
    </>
  );
}
