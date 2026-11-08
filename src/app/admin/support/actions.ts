"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit, getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sendSupportText } from "@/lib/telegram/support";

export type SupportState = { ok?: string; error?: string; at?: number };

async function staff() {
  const u = await getSessionUser();
  return u && can(u.role, "orders.view") ? u : null;
}

/** Sends the admin's answer to the customer's Telegram chat. */
export async function sendReply(_: SupportState, fd: FormData): Promise<SupportState> {
  const u = await staff();
  if (!u) return { error: "Нет доступа" };
  const id = z.string().uuid().safeParse(fd.get("threadId"));
  const text = z.string().trim().min(1).max(4000).safeParse(fd.get("text"));
  if (!id.success) return { error: "Чат не найден" };
  if (!text.success) return { error: "Напишите сообщение (до 4000 символов)" };
  const ok = await sendSupportText(id.data, text.data, u.displayName?.trim() || "Поддержка");
  if (!ok) return { error: "Не доставлено: клиент заблокировал бота или удалил чат." };
  await audit(u.id, "support.reply", "support_thread", id.data);
  revalidatePath(`/admin/support/${id.data}`);
  return { ok: "Отправлено", at: Date.now() };
}

/** Closes or reopens a conversation. */
export async function setThreadStatus(fd: FormData) {
  const u = await staff();
  if (!u) return;
  const id = z.string().uuid().safeParse(fd.get("threadId"));
  const status = z.enum(["open", "closed"]).safeParse(fd.get("status"));
  if (!id.success || !status.success) return;
  await supabaseAdmin().from("support_threads").update({ status: status.data, ...(status.data === "closed" ? { unread: 0 } : {}) }).eq("id", id.data);
  await audit(u.id, `support.${status.data}`, "support_thread", id.data);
  revalidatePath("/admin/support", "layout");
}
