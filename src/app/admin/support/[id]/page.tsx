import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { ArrowLeft, ExternalLink, FileDown } from "lucide-react";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { MEDIA_LABEL, type MediaType } from "@/lib/telegram/support";
import { Badge, fmtDate, orderState } from "../../ui";
import { ActionForm } from "../../orders/action-form";
import { remakeOrder } from "../../orders/actions";
import { setThreadStatus } from "../actions";
import { ReplyBox } from "../reply-box";
import { AutoRefresh } from "../auto-refresh";

export default function SupportThread({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<div className="skeleton h-[70vh] rounded-card" />}>
      <Thread params={params} />
    </Suspense>
  );
}

type Entry = { id: number; direction: "in" | "out"; text: string | null; media_type: MediaType | null; file_id: string | null; author: string | null; created_at: string };
type OrderRow = {
  id: string; public_order_number: string; created_at: string; amount_kzt: number; payment_status: string; generation_status: string;
  photos_deleted_at: string | null; template_snapshot_json: { title_kk?: string } | null; payments: { provider: string }[] | null;
};

const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
const day = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", timeZone: "Asia/Almaty" });

async function Thread({ params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/support");
  if (!can(u.role, "orders.view")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();

  const db = supabaseAdmin();
  const { data: t } = await db.from("support_threads").select("*").eq("id", id).maybeSingle();
  if (!t) notFound();
  const [{ data: entries }, profRes, ordersRes] = await Promise.all([
    db.from("support_entries").select("id,direction,text,media_type,file_id,author,created_at").eq("thread_id", id).order("created_at").limit(500),
    t.user_id ? db.from("profiles").select("display_name,telegram_username,phone,created_at").eq("id", t.user_id).maybeSingle() : Promise.resolve({ data: null }),
    t.user_id
      ? db.from("orders").select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,photos_deleted_at,template_snapshot_json,payments(provider)")
        .eq("user_id", t.user_id).is("parent_order_id", null).order("created_at", { ascending: false }).limit(15)
      : Promise.resolve({ data: [] }),
  ]);
  if (t.unread) await db.from("support_threads").update({ unread: 0 }).eq("id", id);
  const prof = profRes.data as { display_name: string | null; telegram_username: string | null; phone: string | null; created_at: string } | null;
  const orders = (ordersRes.data ?? []) as unknown as OrderRow[];
  const list = (entries ?? []) as Entry[];
  const canRemake = can(u.role, "orders.retry");

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start">
      <AutoRefresh seconds={8} />
      {/* Conversation */}
      <section className="flex h-[calc(100dvh-9rem)] min-h-[32rem] flex-col overflow-hidden rounded-card border border-line/80 bg-surface lg:h-[calc(100dvh-8rem)]">
        <header className="flex items-center gap-3 border-b border-line px-3 py-3 sm:px-4">
          <Link href="/admin/support" className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full hover:bg-mist" aria-label="Назад к списку"><ArrowLeft size={18} /></Link>
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink font-display text-sm text-paper" aria-hidden>{(t.name || t.username || "?").charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{t.name || "Без имени"}</p>
            <p className="truncate text-xs text-muted">
              {t.username ? <a href={`https://t.me/${t.username}`} target="_blank" rel="noreferrer" className="hover:underline">@{t.username}</a> : "без username"}
              {" · "}{t.status === "open" ? "открыт" : "закрыт"}
            </p>
          </div>
          <form action={setThreadStatus}>
            <input type="hidden" name="threadId" value={t.id} />
            <input type="hidden" name="status" value={t.status === "open" ? "closed" : "open"} />
            <button className={`h-9 rounded-full border px-4 text-sm font-semibold transition-colors ${t.status === "open" ? "border-ink bg-ink text-paper hover:opacity-90" : "border-line hover:border-ink"}`}>
              {t.status === "open" ? "✓ Решено" : "Открыть снова"}
            </button>
          </form>
        </header>

        <div className="flex flex-1 flex-col-reverse overflow-y-auto bg-paper/60 px-3 py-4 sm:px-5">
          <div className="space-y-2.5">
            {list.map((e, i) => {
              const newDay = i === 0 || day.format(new Date(list[i - 1].created_at)) !== day.format(new Date(e.created_at));
              const mine = e.direction === "out";
              return (
                <div key={e.id}>
                  {newDay && <p className="my-3 text-center text-[11px] font-medium uppercase tracking-wide text-muted">{day.format(new Date(e.created_at))}</p>}
                  <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 sm:max-w-[70%] ${mine ? "rounded-br-md bg-ink text-paper" : "rounded-bl-md border border-line bg-surface"}`}>
                      {e.media_type && <Media e={e} mine={mine} />}
                      {e.text && <p className="whitespace-pre-wrap break-words text-[15px] leading-snug">{e.text}</p>}
                      <p className={`mt-1 text-right text-[10px] ${mine ? "text-paper/60" : "text-muted"}`}>
                        {mine && e.author ? `${e.author} · ` : ""}{time.format(new Date(e.created_at))}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {!list.length && <p className="py-10 text-center text-sm text-muted">Сообщений пока нет</p>}
          </div>
        </div>

        <ReplyBox threadId={t.id} />
      </section>

      {/* Customer */}
      <aside className="space-y-4 xl:sticky xl:top-24">
        <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
          <h2 className="t-eyebrow text-muted">Клиент</h2>
          {prof ? (
            <dl className="mt-3 space-y-1.5 text-sm">
              <Row k="Имя" v={prof.display_name || t.name || "—"} />
              <Row k="Telegram" v={t.username ? `@${t.username}` : "—"} />
              <Row k="Телефон" v={prof.phone || "—"} />
              <Row k="С нами с" v={new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Almaty" }).format(new Date(prof.created_at))} />
              <Row k="Заказов" v={String(orders.length)} />
            </dl>
          ) : (
            <p className="mt-2 text-sm text-muted">Клиент ещё не входил на сайт через Telegram — заказов не найдено. Попросите номер заказа.</p>
          )}
        </section>

        {orders.length > 0 && (
          <section className="rounded-card border border-line/80 bg-surface p-4 sm:p-5">
            <h2 className="t-eyebrow text-muted">Заказы</h2>
            <ul className="mt-3 space-y-3">
              {orders.map((o) => {
                const st = orderState(o.payment_status, o.generation_status, o.amount_kzt, (o.payments ?? []).map((p) => p.provider));
                const remakeable = o.payment_status === "succeeded" && ["completed", "failed", "cancelled"].includes(o.generation_status) && !o.photos_deleted_at;
                return (
                  <li key={o.id} className="rounded-2xl border border-line p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <Link href={`/admin/orders/${o.id}`} className="inline-flex items-center gap-1 font-mono text-sm font-semibold hover:underline">
                          {o.public_order_number}<ExternalLink size={12} aria-hidden />
                        </Link>
                        <p className="truncate text-xs text-muted">{o.template_snapshot_json?.title_kk ?? "—"} · {formatKzt(o.amount_kzt)}</p>
                        <p className="text-[11px] text-muted">{fmtDate.format(new Date(o.created_at))}</p>
                      </div>
                      <Badge color={st.color}>{st.label}</Badge>
                    </div>
                    {canRemake && remakeable && (
                      <div className="mt-2.5">
                        <ActionForm action={remakeOrder} fields={{ orderId: o.id }}
                          label={o.generation_status === "completed" ? "↻ Пересоздать бесплатно" : "↻ Создать заново"}
                          confirm={`Создать видео ${o.public_order_number} заново бесплатно? Новое видео заменит старое и придёт клиенту в Telegram.`} />
                      </div>
                    )}
                    {o.payment_status === "succeeded" && o.photos_deleted_at && <p className="mt-2 text-[11px] text-muted">Фото удалены — пересоздать нельзя</p>}
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </aside>
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between gap-3"><dt className="text-muted">{k}</dt><dd className="truncate text-right font-medium">{v}</dd></div>;
}

function Media({ e, mine }: { e: Entry; mine: boolean }) {
  const src = `/api/admin/support/file/${e.id}`;
  const box = "mb-1.5 block max-h-80 w-full max-w-xs rounded-xl bg-black/5 object-contain";
  switch (e.media_type) {
    case "photo":
    case "sticker":
      // eslint-disable-next-line @next/next/no-img-element
      return <a href={src} target="_blank" rel="noreferrer"><img src={src} alt={MEDIA_LABEL[e.media_type]} loading="lazy" className={box} /></a>;
    case "video":
    case "animation":
    case "video_note":
      return <video src={src} controls preload="metadata" playsInline className={box} />;
    case "voice":
    case "audio":
      return <audio src={src} controls preload="none" className="mb-1.5 w-64 max-w-full" />;
    default:
      return (
        <a href={src} className={`mb-1.5 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium ${mine ? "bg-white/10" : "bg-mist"}`}>
          <FileDown size={16} aria-hidden />Открыть файл
        </a>
      );
  }
}
