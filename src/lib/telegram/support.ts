import "server-only";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tg, escapeHtml } from "./bot";
import { botAdminIds } from "./admin";
import { botMessage } from "./messages";

/**
 * Support chat through the bot, managed in Admin → Поддержка and (optionally) right in Telegram.
 *   Customer writes anything (text, photo, video, file, voice) → saved in the customer's thread;
 *   every bot admin also gets a header (who, latest order, «Открыть в админке») and a copy.
 *   Answers: from the admin panel, or with Telegram «Reply» on the copy — both reach the customer
 *   and are saved in the thread. Files stay on Telegram (only their file ids are kept).
 * Message contents are never logged.
 */
type From = { id?: number; first_name?: string; last_name?: string; username?: string };
type FileRef = { file_id: string };
export type TgMessage = {
  message_id: number; text?: string; caption?: string; from?: From;
  photo?: FileRef[]; video?: FileRef; document?: FileRef & { file_name?: string }; voice?: FileRef; audio?: FileRef;
  animation?: FileRef; sticker?: FileRef & { emoji?: string }; video_note?: FileRef;
};
export type MediaType = "photo" | "video" | "document" | "voice" | "audio" | "animation" | "sticker" | "video_note";

const ACK_GAP_MS = 30 * 60_000;
const GEN: Record<string, string> = { awaiting_payment: "ждёт оплаты", queued: "в очереди", processing: "создаётся", postprocessing: "обработка", completed: "готово", failed: "ошибка", cancelled: "отменён" };
export const MEDIA_LABEL: Record<MediaType, string> = {
  photo: "📷 Фото", video: "🎬 Видео", document: "📎 Файл", voice: "🎤 Голосовое", audio: "🎵 Аудио",
  animation: "🎞 GIF", sticker: "Стикер", video_note: "⏺ Видеосообщение",
};

/** Text and the one attachment of a Telegram message. */
export function messageContent(m: TgMessage): { text: string | null; media_type: MediaType | null; file_id: string | null } {
  const text = (m.text ?? m.caption ?? (m.sticker?.emoji ? m.sticker.emoji : null))?.slice(0, 4000) ?? null;
  const pick = (): [MediaType, string] | null => {
    if (m.photo?.length) return ["photo", m.photo[m.photo.length - 1].file_id];
    if (m.video) return ["video", m.video.file_id];
    if (m.animation) return ["animation", m.animation.file_id];
    if (m.video_note) return ["video_note", m.video_note.file_id];
    if (m.voice) return ["voice", m.voice.file_id];
    if (m.audio) return ["audio", m.audio.file_id];
    if (m.sticker) return ["sticker", m.sticker.file_id];
    if (m.document) return ["document", m.document.file_id];
    return null;
  };
  const media = pick();
  return { text, media_type: media?.[0] ?? null, file_id: media?.[1] ?? null };
}

const preview = (c: { text: string | null; media_type: MediaType | null }) =>
  (c.text ? c.text.replace(/\s+/g, " ").slice(0, 140) : "") || (c.media_type ? MEDIA_LABEL[c.media_type] : "");

async function ensureThread(chatId: number, from: From | undefined) {
  const db = supabaseAdmin();
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 80) || null;
  let userId: string | null = null;
  if (from?.id) {
    const { data: p } = await db.from("profiles").select("id").eq("telegram_id", from.id).maybeSingle();
    userId = p?.id ?? null;
  }
  const { data } = await db.from("support_threads").upsert({
    chat_id: chatId, telegram_user_id: from?.id ?? null, name, username: from?.username ?? null,
    ...(userId ? { user_id: userId } : {}),
  }, { onConflict: "chat_id" }).select("id,unread").single();
  return data;
}

/** Saves one message in a thread and updates the thread's summary. */
export async function addEntry(threadId: string, direction: "in" | "out", c: { text: string | null; media_type: MediaType | null; file_id: string | null }, author: string | null) {
  const db = supabaseAdmin();
  await db.from("support_entries").insert({ thread_id: threadId, direction, text: c.text, media_type: c.media_type, file_id: c.file_id, author });
  const { data: t } = await db.from("support_threads").select("unread").eq("id", threadId).single();
  await db.from("support_threads").update({
    last_message_at: new Date().toISOString(),
    last_preview: `${direction === "out" ? "Вы: " : ""}${preview(c)}`.slice(0, 160),
    ...(direction === "in" ? { unread: (t?.unread ?? 0) + 1, status: "open" } : { unread: 0 }),
  }).eq("id", threadId);
}

async function customerLine(tgId: number): Promise<string> {
  const db = supabaseAdmin();
  const { data: p } = await db.from("profiles").select("id").eq("telegram_id", tgId).maybeSingle();
  if (!p) return "Аккаунта на сайте нет";
  const { data: o } = await db.from("orders").select("public_order_number,generation_status,amount_kzt")
    .eq("user_id", p.id).is("parent_order_id", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!o) return "Заказов нет";
  return `Последний заказ: <b>${escapeHtml(o.public_order_number)}</b> · ${GEN[o.generation_status] ?? o.generation_status} · ${o.amount_kzt} ₸`;
}

/** A customer's message to the bot: saved in their thread, copied to the bot admins, acknowledged. */
export async function relayToSupport(chatId: number, msg: TgMessage): Promise<boolean> {
  const db = supabaseAdmin();
  const thread = await ensureThread(chatId, msg.from);
  if (!thread) return false;
  const { data: lastIn } = await db.from("support_entries").select("created_at")
    .eq("thread_id", thread.id).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const firstInWhile = !lastIn || Date.now() - Date.parse(lastIn.created_at) > ACK_GAP_MS;
  await addEntry(thread.id, "in", messageContent(msg), null);

  // Copies to the admins' Telegram (optional: the admin panel works without it).
  const admins = await botAdminIds();
  const from = msg.from;
  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 60) || "Без имени";
  const who = `${escapeHtml(name)}${from?.username ? ` (@${escapeHtml(from.username)})` : ""}`;
  const link = `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}/admin/support/${thread.id}`;
  const header = firstInWhile
    ? `💬 <b>Поддержка</b>\nОт: ${who}\n${from?.id ? await customerLine(from.id).catch(() => "") : ""}\n\n↩️ Ответьте на сообщение клиента (Reply) или откройте чат в админке.`
    : null;
  for (const admin of admins) {
    if (header) {
      const h = await tg<{ message_id: number }>("sendMessage", {
        chat_id: admin, text: header, parse_mode: "HTML", link_preview_options: { is_disabled: true },
        reply_markup: { inline_keyboard: [[{ text: "🗂 Открыть в админке", url: link }]] },
      });
      if (h) await db.from("support_messages").insert({ user_chat_id: chatId, admin_chat_id: admin, admin_message_id: h.message_id, direction: "in" });
    }
    const copy = await tg<{ message_id: number }>("copyMessage", { chat_id: admin, from_chat_id: chatId, message_id: msg.message_id });
    if (copy) await db.from("support_messages").insert({ user_chat_id: chatId, admin_chat_id: admin, admin_message_id: copy.message_id, direction: "in" });
  }

  if (firstInWhile) {
    const m = await botMessage("support_ack");
    await tg("sendMessage", { chat_id: chatId, text: m.text, parse_mode: "HTML" });
  }
  return true;
}

/**
 * An admin's Telegram «Reply» to a relayed message → the customer (saved in the thread).
 * Returns false when the message was not a reply to a support message.
 */
export async function relayAdminReply(adminChatId: number, msg: TgMessage, replyToId: number | undefined): Promise<boolean> {
  if (!replyToId) return false;
  const db = supabaseAdmin();
  const { data: link } = await db.from("support_messages").select("user_chat_id")
    .eq("admin_chat_id", adminChatId).eq("admin_message_id", replyToId).maybeSingle();
  if (!link) return false;
  const sent = await tg<{ message_id: number }>("copyMessage", { chat_id: link.user_chat_id, from_chat_id: adminChatId, message_id: msg.message_id });
  if (sent) {
    await db.from("support_messages").insert({ user_chat_id: link.user_chat_id, admin_chat_id: adminChatId, admin_message_id: msg.message_id, direction: "out" });
    const { data: t } = await db.from("support_threads").select("id").eq("chat_id", link.user_chat_id).maybeSingle();
    if (t) await addEntry(t.id, "out", messageContent(msg), `Telegram: ${msg.from?.first_name ?? "админ"}`);
  }
  await tg("sendMessage", {
    chat_id: adminChatId, reply_to_message_id: msg.message_id,
    text: sent ? "✅ Отправлено клиенту" : "❌ Не доставлено: клиент заблокировал бота или удалил чат.",
  });
  return true;
}

/** An answer typed in the admin panel → the customer's Telegram chat (plain text). */
export async function sendSupportText(threadId: string, text: string, author: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: t } = await db.from("support_threads").select("chat_id").eq("id", threadId).maybeSingle();
  if (!t) return false;
  const sent = await tg("sendMessage", { chat_id: t.chat_id, text, link_preview_options: { is_disabled: true } });
  if (!sent) return false;
  await addEntry(threadId, "out", { text, media_type: null, file_id: null }, author);
  return true;
}
