import { NextResponse, type NextRequest } from "next/server";
import { checkWebhookSecret, sendMessage } from "@/lib/telegram/bot";
import { botMessage } from "@/lib/telegram/messages";

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
