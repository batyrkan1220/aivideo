import "server-only";
import { env } from "@/lib/env";
import { tg } from "./bot";
import { botMessage } from "./messages";
import { botAdminIds } from "./admin";

/** Pushes the bot profile texts (description, short description, menu button) to Telegram. */
export async function pushBotProfile(base = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")) {
  const [d, sd, mb] = await Promise.all([botMessage("description"), botMessage("short_description"), botMessage("menu_button")]);
  await tg("setMyDescription", { description: d.text.slice(0, 512) });
  await tg("setMyShortDescription", { short_description: sd.text.slice(0, 120) });
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: mb.text.slice(0, 64), web_app: { url: base } } });
}

/** Bot command menus: everyone, plus extra admin commands in each admin's own chat. */
export async function pushBotCommands() {
  await tg("setMyCommands", { commands: [
    { command: "start", description: "Видео жасау" },
    { command: "videos", description: "Тапсырыстарым" },
    { command: "help", description: "Көмек" },
  ] });
  for (const id of await botAdminIds()) {
    await tg("setMyCommands", { scope: { type: "chat", chat_id: id }, commands: [
      { command: "admin", description: "Админ-меню" },
      { command: "stats", description: "Статистика за сегодня" },
      { command: "orders", description: "Последние заказы" },
      { command: "problems", description: "Проблемы" },
      { command: "order", description: "Заказ: /order TV-100014" },
      { command: "start", description: "Создать видео" },
    ] });
  }
}
