import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { tg, escapeHtml } from "./bot";
import { botAdminIds } from "./admin";
import { botMessage } from "./messages";

/**
 * Support chat through the bot.
 *   Customer writes anything (text, photo, video, file, voice) → each bot admin gets a header
 *   (who, their latest order) and a copy of the message.
 *   Admin presses «Reply» on either of them → the bot copies the admin's answer to the customer.
 * Message contents are never logged or stored: only which admin-side message maps to which chat.
 */
type From = { id?: number; first_name?: string; last_name?: string; username?: string };

const ACK_GAP_MS = 30 * 60_000;
const GEN: Record<string, string> = { awaiting_payment: "ждёт оплаты", queued: "в очереди", processing: "создаётся", postprocessing: "обработка", completed: "готово", failed: "ошибка", cancelled: "отменён" };

async function customerLine(tgId: number): Promise<string> {
  const db = supabaseAdmin();
  const { data: p } = await db.from("profiles").select("id").eq("telegram_id", tgId).maybeSingle();
  if (!p) return "Аккаунта на сайте нет";
  const { data: o } = await db.from("orders").select("public_order_number,generation_status,amount_kzt")
    .eq("user_id", p.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (!o) return "Заказов нет";
  return `Последний заказ: <b>${escapeHtml(o.public_order_number)}</b> · ${GEN[o.generation_status] ?? o.generation_status} · ${o.amount_kzt} ₸`;
}

/** A customer's message to the bot → admins. Returns false when there is no admin to receive it. */
export async function relayToSupport(chatId: number, messageId: number, from: From | undefined): Promise<boolean> {
  const admins = await botAdminIds();
  if (!admins.length) return false;
  const db = supabaseAdmin();

  // Acknowledge the first message of a conversation (not every message).
  const { data: last } = await db.from("support_messages").select("created_at")
    .eq("user_chat_id", chatId).eq("direction", "in").order("created_at", { ascending: false }).limit(1).maybeSingle();
  const firstInWhile = !last || Date.now() - Date.parse(last.created_at) > ACK_GAP_MS;

  const name = [from?.first_name, from?.last_name].filter(Boolean).join(" ").slice(0, 60) || "Без имени";
  const who = `${escapeHtml(name)}${from?.username ? ` (@${escapeHtml(from.username)})` : ""}`;
  const header = firstInWhile
    ? `💬 <b>Поддержка</b>\nОт: ${who}\n${from?.id ? await customerLine(from.id).catch(() => "") : ""}\n\n↩️ Чтобы ответить, нажмите «Ответить» (Reply) на сообщение клиента.`
    : null;

  let delivered = false;
  for (const admin of admins) {
    if (header) {
      const h = await tg<{ message_id: number }>("sendMessage", { chat_id: admin, text: header, parse_mode: "HTML", link_preview_options: { is_disabled: true } });
      if (h) await db.from("support_messages").insert({ user_chat_id: chatId, admin_chat_id: admin, admin_message_id: h.message_id, direction: "in" });
    }
    const copy = await tg<{ message_id: number }>("copyMessage", { chat_id: admin, from_chat_id: chatId, message_id: messageId });
    if (copy) {
      delivered = true;
      await db.from("support_messages").insert({ user_chat_id: chatId, admin_chat_id: admin, admin_message_id: copy.message_id, direction: "in" });
    }
  }
  if (!delivered) return false;

  if (firstInWhile) {
    const m = await botMessage("support_ack");
    await tg("sendMessage", { chat_id: chatId, text: m.text, parse_mode: "HTML" });
  }
  return true;
}

/**
 * An admin's Telegram reply to a relayed message → the customer. Returns true when the message
 * was a support reply (handled), false when it was not a reply to a support message.
 */
export async function relayAdminReply(adminChatId: number, messageId: number, replyToId: number | undefined): Promise<boolean> {
  if (!replyToId) return false;
  const db = supabaseAdmin();
  const { data: link } = await db.from("support_messages").select("user_chat_id")
    .eq("admin_chat_id", adminChatId).eq("admin_message_id", replyToId).maybeSingle();
  if (!link) return false;
  const sent = await tg<{ message_id: number }>("copyMessage", { chat_id: link.user_chat_id, from_chat_id: adminChatId, message_id: messageId });
  if (sent) {
    // The admin's own message also maps to this customer, so replying to it works too.
    await db.from("support_messages").insert({ user_chat_id: link.user_chat_id, admin_chat_id: adminChatId, admin_message_id: messageId, direction: "out" });
  }
  await tg("sendMessage", {
    chat_id: adminChatId, reply_to_message_id: messageId,
    text: sent ? "✅ Отправлено клиенту" : "❌ Не доставлено: клиент заблокировал бота или удалил чат.",
  });
  return true;
}
