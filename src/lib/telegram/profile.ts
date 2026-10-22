import "server-only";
import { env } from "@/lib/env";
import { tg } from "./bot";
import { botMessage } from "./messages";

/** Pushes the bot profile texts (description, short description, menu button) to Telegram. */
export async function pushBotProfile(base = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")) {
  const [d, sd, mb] = await Promise.all([botMessage("description"), botMessage("short_description"), botMessage("menu_button")]);
  await tg("setMyDescription", { description: d.text.slice(0, 512) });
  await tg("setMyShortDescription", { short_description: sd.text.slice(0, 120) });
  await tg("setChatMenuButton", { menu_button: { type: "web_app", text: mb.text.slice(0, 64), web_app: { url: base } } });
}
