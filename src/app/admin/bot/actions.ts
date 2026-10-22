"use server";
import { revalidatePath } from "next/cache";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { BOT_MESSAGES, clearBotMessageCache, isBotMessageKey } from "@/lib/telegram/messages";
import { botConfigured } from "@/lib/telegram/bot";
import { pushBotProfile } from "@/lib/telegram/profile";

export type BotMessageState = { ok?: boolean; error?: "forbidden" | "invalid" | "failed" };

/** Saves (or resets, when intent=reset) one bot message. Profile texts are pushed to Telegram at once. */
export async function saveBotMessage(_: BotMessageState, fd: FormData): Promise<BotMessageState> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return { error: "forbidden" };
  const key = String(fd.get("key") ?? "");
  if (!isBotMessageKey(key)) return { error: "invalid" };
  const def = BOT_MESSAGES[key];
  const db = supabaseAdmin();

  if (fd.get("intent") === "reset") {
    const { error } = await db.from("bot_messages").delete().eq("key", key);
    if (error) return { error: "failed" };
  } else {
    const text = String(fd.get("text") ?? "").replace(/\r\n/g, "\n").trim();
    const buttonRaw = String(fd.get("button") ?? "").trim();
    if (!text || text.length > def.max) return { error: "invalid" };
    if (def.button !== null && (!buttonRaw || buttonRaw.length > 64)) return { error: "invalid" };
    const { error } = await db.from("bot_messages").upsert({
      key, text, button: def.button === null ? null : buttonRaw, updated_at: new Date().toISOString(), updated_by: u.id,
    });
    if (error) return { error: "failed" };
  }
  clearBotMessageCache();
  if (def.group === "profile" && botConfigured()) await pushBotProfile();
  await audit(u.id, "bot_message.update", "bot_message", null, { key, reset: fd.get("intent") === "reset" });
  revalidatePath("/admin/bot");
  return { ok: true };
}
