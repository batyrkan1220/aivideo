"use server";
import { randomUUID } from "node:crypto";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { sheetTask, submitSheet } from "@/lib/generation/sheet-settings";
import { ProviderError } from "@/lib/generation/types";

/*
  Admin test of the Character Sheet step: one photo → the same Kling task as in orders → the sheet.
  The photo is kept in the private bucket under sheets/test/ (removed by the daily sweep after a day).
  Every run is charged by Kling.
*/

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png" };
export type SheetStart = { ok: true; task: string; photo: string } | { ok: false; error: string };
export type SheetCheck = { state: "waiting" } | { state: "done"; url: string } | { state: "failed"; error: string };

export async function startSheetTest(fd: FormData): Promise<SheetStart> {
  const user = await guard();
  if (!user) return { ok: false, error: "Нет доступа" };
  const file = fd.get("photo");
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Выберите фото" };
  const ext = TYPES[file.type];
  if (!ext) return { ok: false, error: "Нужен JPG или PNG" };
  if (file.size > 900 * 1024) return { ok: false, error: "Фото слишком большое" };
  const db = supabaseAdmin();
  const path = `sheets/test/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from("user-uploads").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return { ok: false, error: "Фото не загрузилось" };
  const { data } = await db.storage.from("user-uploads").createSignedUrl(path, 3600);
  if (!data) return { ok: false, error: "Фото не загрузилось" };
  try {
    const task = await submitSheet(data.signedUrl);
    await audit(user.id, "character_sheet.test", "kling", null, { task });
    return { ok: true, task, photo: data.signedUrl };
  } catch (err) {
    return { ok: false, error: err instanceof ProviderError ? `Kling: ${err.code}` : "Kling не принял задачу" };
  }
}

export async function checkSheetTest(task: string): Promise<SheetCheck> {
  if (!(await guard())) return { state: "failed", error: "Нет доступа" };
  if (!/^[fo:]{0,2}[\w-]{1,80}$/.test(task)) return { state: "failed", error: "Неверная задача" };
  try {
    const st = await sheetTask(task);
    if (st.state === "succeeded") return { state: "done", url: st.outputUrl };
    if (st.state === "failed") return { state: "failed", error: st.errorCode === "provider_content_rejected" ? "Kling отклонил фото" : st.errorCode === "provider_no_face" ? "Kling не нашёл лицо на фото" : "Kling не сделал лист" };
    return { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}
