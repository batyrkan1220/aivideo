"use server";
import { env } from "@/lib/env";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { tg, webhookSecret } from "@/lib/telegram/bot";

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
    allowed_updates: ["message"], drop_pending_updates: true,
  });
  await tg("setMyCommands", { commands: [
    { command: "start", description: "Видео жасау" },
    { command: "videos", description: "Менің видеоларым" },
  ] });
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Видео жасау", web_app: { url: base } } });
  await audit(u.id, "telegram.setup", "telegram", null, { ok: !!hook });
  return hook && me ? { ok: true, bot: me.username } : { error: "failed" };
}
