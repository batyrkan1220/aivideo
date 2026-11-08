import { NextResponse, type NextRequest } from "next/server";
import { checkWebhookSecret, sendMessage, tg } from "@/lib/telegram/bot";
import { handleAdminCallback, handleAdminMessage, isBotAdmin } from "@/lib/telegram/admin";
import { botMessage } from "@/lib/telegram/messages";
import { codeFromPayload, linkPartnerTelegram, partnerSelfReport, touchFromBot } from "@/lib/partners";
import { confirmLoginFromBot, loginIdFromStart } from "@/lib/telegram/bot-login";
import { env } from "@/lib/env";
import { relayAdminReply, relayToSupport } from "@/lib/telegram/support";

/**
 * Telegram bot updates. Authentic only with our X-Telegram-Bot-Api-Secret-Token (set via setWebhook).
 * Handles /start (welcome + "open app" button); everything else gets a short hint.
 */
export async function POST(req: NextRequest) {
  if (!checkWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as
    | {
        message?: {
          message_id?: number; chat?: { id?: number; type?: string }; text?: string; caption?: string;
          reply_to_message?: { message_id?: number };
          from?: { id?: number; first_name?: string; last_name?: string; username?: string; is_bot?: boolean };
        };
        callback_query?: { id: string; data?: string; from?: { id?: number }; message?: { chat?: { id?: number; type?: string } } };
      }
    | null;

  // Admin menu buttons.
  const cb = update?.callback_query;
  if (cb) {
    await tg("answerCallbackQuery", { callback_query_id: cb.id });
    const cbChat = cb.message?.chat;
    if (cbChat?.id && cbChat.type === "private" && cb.data?.startsWith("a:") && (await isBotAdmin(cb.from?.id))) {
      await handleAdminCallback(cbChat.id, cb.data);
    }
    return NextResponse.json({ ok: true });
  }

  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg?.chat?.type !== "private") return NextResponse.json({ ok: true });

  // Website sign-in: /start l_<request id> confirms the waiting browser and sends a one-time link.
  const loginId = loginIdFromStart(msg.text?.startsWith("/start ") ? msg.text.slice(7).trim() : null);
  if (loginId && msg.from?.id) {
    const ok = await confirmLoginFromBot(loginId, { id: msg.from.id, first_name: msg.from.first_name, last_name: msg.from.last_name, username: msg.from.username });
    const site = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
    await tg("sendMessage", ok ? {
      chat_id: chatId,
      text: "✅ Готово, вы вошли в TrendMe!\n\nВернитесь в браузер — заказ уже ждёт оплаты. Если страница закрылась, нажмите кнопку ниже.",
      reply_markup: { inline_keyboard: [[{ text: "Вернуться на сайт", url: `${site}/auth/tg/${loginId}` }]] },
    } : {
      chat_id: chatId,
      text: "Ссылка для входа устарела. Вернитесь на сайт и нажмите «Войти через Telegram» ещё раз.",
    });
    return NextResponse.json({ ok: true });
  }

  const admin = await isBotAdmin(msg.from?.id);
  // Support: an admin's «Reply» to a customer's relayed message goes back to that customer.
  if (admin && msg.message_id && (await relayAdminReply(chatId, msg.message_id, msg.reply_to_message?.message_id))) {
    return NextResponse.json({ ok: true });
  }
  // Admin commands (/admin, /stats, /orders, /problems, /order TM-…) — only for listed Telegram ids.
  if (msg.text && admin && (await handleAdminMessage(chatId, msg.text))) {
    return NextResponse.json({ ok: true });
  }

  // Partner program: a partner writing to the bot gets linked; /start p_<code> remembers who invited.
  if (msg.from?.id) {
    await linkPartnerTelegram(msg.from.username, msg.from.id).catch(() => {});
    const payload = msg.text?.startsWith("/start ") ? msg.text.slice(7) : null;
    const code = codeFromPayload(payload);
    if (payload !== null || msg.text?.trim() === "/start") {
      // Diagnostics without personal data: did the partner code arrive and was it applied?
      const r = code ? await touchFromBot(msg.from.id, code, msg.from.username).catch(() => "error" as const) : "no_code";
      console.log(JSON.stringify({ src: "partners", event: "bot_start", result: r }));
    }
    if (msg.text?.trim().startsWith("/partner")) {
      const report = await partnerSelfReport(msg.from.id);
      if (report) { await tg("sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML", link_preview_options: { is_disabled: true } }); return NextResponse.json({ ok: true }); }
    }
  }

  const name = msg.from?.first_name?.slice(0, 40) ?? "";
  const cmd = msg.text ?? "";

  // «Написать в поддержку» on the site opens the bot with /start support.
  if (cmd.trim() === "/start support") {
    const m = await botMessage("support_start", { name: name || "Здравствуйте" });
    await sendMessage(chatId, m.text, null);
    return NextResponse.json({ ok: true });
  }
  // Anything that is not a command (text, photo, video, file, voice) is a message to support.
  if (!cmd.startsWith("/") && msg.message_id && !msg.from?.is_bot && !admin) {
    if (await relayToSupport(chatId, msg.message_id, msg.from)) return NextResponse.json({ ok: true });
  }
  const [key, path] = cmd.startsWith("/start") ? (["welcome", "/"] as const)
    : cmd.startsWith("/help") ? (["help", "/"] as const)
    : cmd.startsWith("/videos") ? (["videos", "/orders"] as const)
    : (["hint", "/"] as const);
  const m = await botMessage(key, { name });
  await sendMessage(chatId, m.text, m.button ? { text: m.button, path } : null);
  return NextResponse.json({ ok: true });
}
