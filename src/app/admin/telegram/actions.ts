"use server";
import { env } from "@/lib/env";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { tg, webhookSecret } from "@/lib/telegram/bot";
import { pushBotProfile } from "@/lib/telegram/profile";
import { botAdminIds } from "@/lib/telegram/admin";

export type TelegramSetupState = { ok?: boolean; bot?: string; error?: "forbidden" | "not_configured" | "failed" };

/** Connects the bot: webhook (with secret token), commands and the Mini App menu button. */
export async function setupTelegram(_: TelegramSetupState): Promise<TelegramSetupState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return { error: "forbidden" };
  if (!env().TELEGRAM_BOT_TOKEN) return { error: "not_configured" };
  const base = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");

  const me = await tg<{ username?: string }>("getMe", {});
  const hook = await tg("setWebhook", {
    url: `${base}/api/telegram/webhook`, secret_token: webhookSecret(),
    allowed_updates: ["message", "callback_query"], drop_pending_updates: true,
  });
  await tg("setMyCommands", { commands: [
    { command: "start", description: "Видео жасау" },
    { command: "videos", description: "Менің тапсырыстарым" },
    { command: "help", description: "Көмек" },
  ] });
  await pushBotProfile(base);
  // Admins see extra commands in their own chat with the bot.
  for (const id of await botAdminIds()) {
    await tg("setMyCommands", { scope: { type: "chat", chat_id: id }, commands: [
      { command: "admin", description: "Админ мәзірі" },
      { command: "stats", description: "Бүгінгі статистика" },
      { command: "orders", description: "Соңғы тапсырыстар" },
      { command: "problems", description: "Мәселелер" },
      { command: "order", description: "Тапсырыс: /order TV-100014" },
      { command: "start", description: "Видео жасау" },
    ] });
  }
  await audit(u.id, "telegram.setup", "telegram", null, { ok: !!hook });
  return hook && me ? { ok: true, bot: me.username } : { error: "failed" };
}

