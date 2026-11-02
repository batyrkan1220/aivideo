import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isGuestEmail, isTelegramEmail } from "@/lib/telegram/session";
import { Chips, PageHead, nowMs } from "../ui";
import { EVENTS, GROUPS, info, type Group } from "./labels";

export const metadata = { title: "Журнал" };
type SP = { g?: string; e?: string; d?: string; q?: string; page?: string };
const PAGE = 100;
const RANGES = { "1": "Сегодня", "7": "7 дней", "30": "30 дней", all: "Всё" } as const;

export default function AuditPage({ searchParams }: { searchParams: Promise<SP> }) {
  return (
    <div>
      <PageHead title="Журнал" lead="Вся история: действия админов, клиентов, оплаты, генерации, входы и сообщения бота." />
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <List searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

type Item = {
  key: string; at: string; name: string; fromAudit: boolean;
  userId: string | null; orderId: string | null; templateId: string | null; resource?: { type: string; id: string | null };
  props: Record<string, unknown>;
};

async function List({ searchParams }: { searchParams: Promise<SP> }) {
  await connection();
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/audit");
  if (!can(u.role, "audit.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const db = supabaseAdmin();
  const group = (sp.g && sp.g in GROUPS ? sp.g : "") as Group | "";
  const d = sp.d && sp.d in RANGES ? sp.d : "7";
  const page = Math.max(1, Math.min(50, Number(sp.page) || 1));
  const from = d === "all" ? null : d === "1"
    ? new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" }).format(new Date())}T00:00:00+05:00`).toISOString()
    : new Date(nowMs() - Number(d) * 86400_000).toISOString();

  // Which event names fit the group / event filter.
  const names = Object.entries(EVENTS).filter(([, v]) => !group || v.group === group).map(([k]) => k);
  const eventName = sp.e && EVENTS[sp.e] ? sp.e : "";
  const auditNames = eventName ? (eventName.includes(".") ? [eventName] : []) : names.filter((n) => n.includes("."));
  const clientNames = eventName ? (eventName.includes(".") ? [] : [eventName]) : names.filter((n) => !n.includes("."));

  // Search: TM-number → order; @username / email / Telegram id → user.
  const q = (sp.q ?? "").trim();
  let orderFilter: string | null = null, userFilter: string | null = null, nothing = false;
  if (q) {
    if (/^tm-?\d+$/i.test(q)) {
      const { data } = await db.from("orders").select("id").eq("public_order_number", q.toUpperCase().replace(/^TM(\d)/, "TM-$1")).maybeSingle();
      orderFilter = data?.id ?? null; nothing = !data;
    } else {
      const term = q.replace(/^@/, "");
      const { data } = /^\d{5,15}$/.test(term)
        ? await db.from("profiles").select("id").eq("telegram_id", Number(term)).maybeSingle()
        : await db.from("profiles").select("id").or(`email.ilike.%${term.replace(/[%,()]/g, "")}%,telegram_username.ilike.${term.replace(/[%,()]/g, "")}`).limit(1).maybeSingle();
      userFilter = data?.id ?? null; nothing = !data;
    }
  }

  const take = page * PAGE + 1;
  const [{ data: audit }, { data: events }] = nothing ? [{ data: [] }, { data: [] }] : await Promise.all([
    auditNames.length
      ? (() => {
          let qb = db.from("audit_logs").select("id,actor_id,action,resource_type,resource_id,metadata_json,created_at").in("action", auditNames);
          if (from) qb = qb.gte("created_at", from);
          if (userFilter) qb = qb.eq("actor_id", userFilter);
          if (orderFilter) qb = qb.eq("resource_type", "order").eq("resource_id", orderFilter);
          return qb.order("created_at", { ascending: false }).limit(take);
        })()
      : Promise.resolve({ data: [] }),
    clientNames.length
      ? (() => {
          let qb = db.from("analytics_events").select("id,event_name,user_id,template_id,order_id,properties,created_at").in("event_name", clientNames);
          if (from) qb = qb.gte("created_at", from);
          if (userFilter) qb = qb.eq("user_id", userFilter);
          if (orderFilter) qb = qb.eq("order_id", orderFilter);
          return qb.order("created_at", { ascending: false }).limit(take);
        })()
      : Promise.resolve({ data: [] }),
  ]);

  const items: Item[] = [
    ...((audit ?? []) as { id: number; actor_id: string | null; action: string; resource_type: string; resource_id: string | null; metadata_json: Record<string, unknown> | null; created_at: string }[]).map((r) => ({
      key: `a${r.id}`, at: r.created_at, name: r.action, fromAudit: true, userId: r.actor_id,
      orderId: r.resource_type === "order" ? r.resource_id : null, templateId: r.resource_type === "template" ? r.resource_id : null,
      resource: { type: r.resource_type, id: r.resource_id }, props: r.metadata_json ?? {},
    })),
    ...((events ?? []) as { id: number; event_name: string; user_id: string | null; template_id: string | null; order_id: string | null; properties: Record<string, unknown> | null; created_at: string }[]).map((r) => ({
      key: `e${r.id}`, at: r.created_at, name: r.event_name, fromAudit: false, userId: r.user_id,
      orderId: r.order_id, templateId: r.template_id, props: r.properties ?? {},
    })),
  ].sort((a, b) => (a.at < b.at ? 1 : -1));
  const hasMore = items.length > page * PAGE;
  const shown = items.slice((page - 1) * PAGE, page * PAGE);

  // Names for the people, orders and templates on this page.
  const uids = [...new Set(shown.map((i) => i.userId).filter(Boolean))] as string[];
  const oids = [...new Set(shown.map((i) => i.orderId).filter(Boolean))] as string[];
  const tids = [...new Set(shown.map((i) => i.templateId).filter(Boolean))] as string[];
  const [{ data: people }, { data: orders }, { data: tpls }] = await Promise.all([
    uids.length ? db.from("profiles").select("id,email,display_name,telegram_username,role").in("id", uids) : Promise.resolve({ data: [] }),
    oids.length ? db.from("orders").select("id,public_order_number,amount_kzt").in("id", oids) : Promise.resolve({ data: [] }),
    tids.length ? db.from("templates").select("id,title_kk").in("id", tids) : Promise.resolve({ data: [] }),
  ]);
  const who = new Map((people ?? []).map((p) => [p.id, p as { id: string; email: string | null; display_name: string | null; telegram_username: string | null; role: string }]));
  const ord = new Map((orders ?? []).map((o) => [o.id, o as { public_order_number: string; amount_kzt: number }]));
  const tpl = new Map((tpls ?? []).map((t) => [t.id, t.title_kk as string]));
  const personName = (id: string | null, fromAudit: boolean) => {
    if (!id) return fromAudit ? "Система" : "Посетитель";
    const p = who.get(id);
    if (!p) return "—";
    if (p.telegram_username) return `@${p.telegram_username}`;
    if (isGuestEmail(p.email)) return "Гость";
    if (isTelegramEmail(p.email)) return p.display_name ?? "Telegram";
    return p.email ?? p.display_name ?? "—";
  };

  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Almaty" });
  const href = (o: Partial<SP>) => `/admin/audit?${new URLSearchParams(Object.entries({ g: group, e: eventName, d, q, ...o }).filter(([, v]) => v) as [string, string][])}`;
  const groupColor: Record<Group, string> = {
    admin: "bg-lavender text-night", client: "bg-paper text-ink ring-1 ring-line", pay: "bg-brand-soft text-night",
    gen: "bg-peach text-night", account: "bg-[#2AABEE]/15 text-night", msg: "bg-[#2AABEE]/15 text-night", system: "bg-paper text-muted ring-1 ring-line",
  };

  return (
    <>
      <Chips active={group || "all"} items={[{ key: "all", label: "Все", href: href({ g: "", e: "", page: "" }) }, ...(Object.entries(GROUPS) as [Group, string][]).map(([k, v]) => ({ key: k, label: v, href: href({ g: k, e: "", page: "" }) }))]} />
      <form className="mb-4 flex flex-wrap items-center gap-2">
        {group && <input type="hidden" name="g" value={group} />}
        <select name="e" defaultValue={eventName} className="h-10 max-w-full rounded-full border border-line bg-white px-4 text-sm">
          <option value="">Все события</option>
          {Object.entries(EVENTS).filter(([, v]) => !group || v.group === group).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
        <select name="d" defaultValue={d} className="h-10 rounded-full border border-line bg-white px-4 text-sm">
          {Object.entries(RANGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <input name="q" defaultValue={q} placeholder="TM-100123, @username, email или Telegram ID" className="h-10 w-full rounded-full border border-line bg-white px-4 text-base sm:w-80 sm:text-sm" />
        <button className="h-10 rounded-full bg-night px-5 text-sm font-semibold text-white">Показать</button>
        {(q || eventName || group || d !== "7") && <Link href="/admin/audit" className="text-sm font-semibold text-muted hover:text-ink">Сбросить</Link>}
      </form>
      {q && nothing && <p className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-800">Ничего не найдено по «{q}».</p>}

      {!shown.length ? <p className="rounded-2xl border border-dashed border-line bg-white p-10 text-center text-muted">Записей нет</p> : (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line bg-white">
          {shown.map((i) => {
            const m = info(i.name, i.fromAudit);
            const o = i.orderId ? ord.get(i.orderId) : null;
            const t = i.templateId ? tpl.get(i.templateId) : null;
            const extra = Object.entries(i.props).filter(([k, v]) => !["vid"].includes(k) && v !== null && v !== "" && typeof v !== "object").slice(0, 5);
            return (
              <li key={i.key} className="flex flex-wrap items-start gap-x-3 gap-y-1 px-4 py-2.5 text-sm">
                <span className="w-[8.5rem] shrink-0 font-mono text-xs text-muted">{fmt.format(new Date(i.at))}</span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${groupColor[m.group]}`}>{GROUPS[m.group]}</span>
                    <span className={`font-semibold ${m.tone === "bad" ? "text-red-700" : m.tone === "good" ? "text-emerald-700" : ""}`}>{m.label}</span>
                  </span>
                  <span className="mt-0.5 flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted">
                    <span>👤 {i.userId ? <Link href={href({ q: who.get(i.userId)?.telegram_username ? `@${who.get(i.userId)!.telegram_username}` : who.get(i.userId)?.email ?? "", page: "" })} className="hover:text-ink hover:underline">{personName(i.userId, i.fromAudit)}</Link> : personName(i.userId, i.fromAudit)}</span>
                    {o && <Link href={`/admin/orders/${i.orderId}`} className="font-semibold text-brand hover:underline">🧾 {o.public_order_number}</Link>}
                    {t && <Link href={`/admin/templates/${i.templateId}`} className="hover:text-ink hover:underline">🎬 {t}</Link>}
                    {extra.map(([k, v]) => <span key={k} className="font-mono">{k}: {String(v).slice(0, 40)}</span>)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
      <div className="mt-4 flex items-center gap-3 text-sm">
        {page > 1 && <Link href={href({ page: String(page - 1) })} className="rounded-full border border-line bg-white px-4 py-2 font-semibold">← Новее</Link>}
        {hasMore && <Link href={href({ page: String(page + 1) })} className="rounded-full border border-line bg-white px-4 py-2 font-semibold">Старее →</Link>}
        <span className="text-muted">Страница {page}</span>
      </div>
    </>
  );
}
