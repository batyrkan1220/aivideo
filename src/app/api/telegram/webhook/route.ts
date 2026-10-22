import { NextResponse, type NextRequest } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { checkWebhookSecret, escapeHtml, sendMessage } from "@/lib/telegram/bot";

/**
 * Telegram bot updates. Authentic only with our X-Telegram-Bot-Api-Secret-Token (set via setWebhook).
 * Handles /start (welcome + "open app" button); everything else gets a short hint.
 */
export async function POST(req: NextRequest) {
  if (!checkWebhookSecret(req.headers.get("x-telegram-bot-api-secret-token"))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const update = (await req.json().catch(() => null)) as
    | { message?: { chat?: { id?: number; type?: string }; text?: string; from?: { first_name?: string } } }
    | null;
  const msg = update?.message;
  const chatId = msg?.chat?.id;
  if (!chatId || msg?.chat?.type !== "private") return NextResponse.json({ ok: true });

  const name = msg.from?.first_name ? escapeHtml(msg.from.first_name.slice(0, 40)) : "";
  if (msg.text?.startsWith("/start")) {
    await sendMessage(chatId, kk.telegram.welcome(name), { text: kk.telegram.openApp, path: "/" });
  } else if (msg.text?.startsWith("/help")) {
    await sendMessage(chatId, kk.telegram.help, { text: kk.telegram.openApp, path: "/" });
  } else if (msg.text?.startsWith("/videos")) {
    await sendMessage(chatId, kk.telegram.myVideos, { text: kk.telegram.openMyVideos, path: "/orders" });
  } else {
    await sendMessage(chatId, kk.telegram.hint, { text: kk.telegram.openApp, path: "/" });
  }
  return NextResponse.json({ ok: true });
}
