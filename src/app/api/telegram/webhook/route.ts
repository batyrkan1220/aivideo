import { NextResponse, type NextRequest } from "next/server";
import { checkWebhookSecret, sendMessage, tg } from "@/lib/telegram/bot";
import { handleAdminCallback, handleAdminMessage, isBotAdmin } from "@/lib/telegram/admin";
import { botMessage } from "@/lib/telegram/messages";
import { codeFromPayload, linkPartnerTelegram, partnerSelfReport, touchFromBot } from "@/lib/partners";

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
        message?: { chat?: { id?: number; type?: string }; text?: string; from?: { id?: number; first_name?: string; username?: string } };
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

  // Admin commands (/admin, /stats, /orders, /problems, /order TV-…) — only for listed Telegram ids.
  if (msg.text && (await isBotAdmin(msg.from?.id)) && (await handleAdminMessage(chatId, msg.text))) {
    return NextResponse.json({ ok: true });
  }

  // Partner program: a partner writing to the bot gets linked; /start p_<code> remembers who invited.
  if (msg.from?.id) {
    await linkPartnerTelegram(msg.from.username, msg.from.id).catch(() => {});
    const payload = msg.text?.startsWith("/start ") ? msg.text.slice(7) : null;
    const code = codeFromPayload(payload);
    if (payload !== null || msg.text?.trim() === "/start") {
      // Diagnostics without personal data: did the partner code arrive and was it applied?
      const r = code ? await touchFromBot(msg.from.id, code).catch(() => "error" as const) : "no_code";
      console.log(JSON.stringify({ src: "partners", event: "bot_start", result: r }));
    }
    if (msg.text?.trim().startsWith("/partner")) {
      const report = await partnerSelfReport(msg.from.id);
      if (report) { await tg("sendMessage", { chat_id: chatId, text: report, parse_mode: "HTML", link_preview_options: { is_disabled: true } }); return NextResponse.json({ ok: true }); }
    }
  }

  const name = msg.from?.first_name?.slice(0, 40) ?? "";
  const cmd = msg.text ?? "";
  const [key, path] = cmd.startsWith("/start") ? (["welcome", "/"] as const)
    : cmd.startsWith("/help") ? (["help", "/"] as const)
    : cmd.startsWith("/videos") ? (["videos", "/orders"] as const)
    : (["hint", "/"] as const);
  const m = await botMessage(key, { name });
  await sendMessage(chatId, m.text, m.button ? { text: m.button, path } : null);
  return NextResponse.json({ ok: true });
}
