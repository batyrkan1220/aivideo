import { Suspense } from "react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { MessageCircle } from "lucide-react";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { PageHead, Chips, fmtDate } from "../ui";
import { AutoRefresh } from "./auto-refresh";

type Filter = "open" | "unread" | "closed" | "all";

export default function SupportInbox({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  return (
    <>
      <PageHead title="Поддержка" lead="Сообщения клиентов из Telegram-бота. Отвечайте прямо здесь — ответ придёт клиенту в чат с ботом." />
      <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
        <Inbox searchParams={searchParams} />
      </Suspense>
    </>
  );
}

async function Inbox({ searchParams }: { searchParams: Promise<{ f?: string; q?: string }> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/support");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const sp = await searchParams;
  const f: Filter = (["open", "unread", "closed", "all"] as const).includes(sp.f as Filter) ? (sp.f as Filter) : "open";
  const q = (sp.q ?? "").trim().replace(/[%_,()*\\:."']/g, " ").slice(0, 40).trim();

  const db = supabaseAdmin();
  let query = db.from("support_threads").select("id,name,username,status,unread,last_message_at,last_preview,user_id")
    .order("last_message_at", { ascending: false }).limit(100);
  if (f === "open") query = query.eq("status", "open");
  if (f === "closed") query = query.eq("status", "closed");
  if (f === "unread") query = query.gt("unread", 0);
  if (q) query = query.or(`name.ilike.%${q}%,username.ilike.%${q}%`);
  const [{ data: threads }, { count: openCount }, { count: unreadCount }] = await Promise.all([
    query,
    db.from("support_threads").select("id", { count: "exact", head: true }).eq("status", "open"),
    db.from("support_threads").select("id", { count: "exact", head: true }).gt("unread", 0),
  ]);

  return (
    <>
      <AutoRefresh seconds={15} />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Chips active={f} items={[
          { key: "open", href: "/admin/support?f=open", label: "Открытые", count: openCount ?? 0 },
          { key: "unread", href: "/admin/support?f=unread", label: "Непрочитанные", count: unreadCount ?? 0 },
          { key: "closed", href: "/admin/support?f=closed", label: "Закрытые" },
          { key: "all", href: "/admin/support?f=all", label: "Все" },
        ]} />
        <form className="mb-4 w-full sm:w-64">
          <input type="hidden" name="f" value={f} />
          <input name="q" defaultValue={q} placeholder="Имя или @username" aria-label="Поиск"
            className="h-10 w-full rounded-full border border-line bg-surface px-4 text-sm outline-none focus:border-ink" />
        </form>
      </div>

      {threads?.length ? (
        <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">
          {threads.map((t) => (
            <li key={t.id}>
              <Link href={`/admin/support/${t.id}`} className="flex items-center gap-3.5 px-4 py-3.5 transition-colors hover:bg-mist/60 sm:px-5">
                <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full font-display text-sm ${t.unread ? "bg-ink text-paper" : "bg-mist text-ink"}`} aria-hidden>
                  {(t.name || t.username || "?").charAt(0).toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className={`truncate text-[15px] ${t.unread ? "font-semibold" : "font-medium"}`}>{t.name || "Без имени"}</span>
                    {t.username && <span className="truncate text-xs text-muted">@{t.username}</span>}
                    {!t.user_id && <span className="shrink-0 rounded-full bg-mist px-2 py-0.5 text-[10px] text-muted">нет аккаунта</span>}
                  </span>
                  <span className={`mt-0.5 block truncate text-sm ${t.unread ? "text-ink" : "text-muted"}`}>{t.last_preview || "—"}</span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-xs text-muted">{fmtDate.format(new Date(t.last_message_at))}</span>
                  {t.unread > 0
                    ? <span className="flex h-5 min-w-5 items-center justify-center rounded-full bg-[#22c55e] px-1.5 text-[11px] font-semibold text-white">{t.unread}</span>
                    : t.status === "closed" ? <span className="text-[11px] text-muted">закрыт</span> : null}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="rounded-card border border-dashed border-line bg-surface/60 px-6 py-12 text-center">
          <MessageCircle className="mx-auto text-muted" size={28} aria-hidden />
          <p className="mt-3 font-semibold">{f === "open" ? "Открытых обращений нет" : "Ничего не найдено"}</p>
          <p className="mt-1 text-sm text-muted">Когда клиент напишет боту, чат появится здесь.</p>
        </div>
      )}
    </>
  );
}
