"use server";
import { randomUUID } from "node:crypto";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { clearMemo } from "@/lib/cache/memo";
import { parseSheetSettings, SHEET_KEY, sheetTask, submitSheet } from "@/lib/generation/sheet-settings";
import { ProviderError } from "@/lib/generation/types";

/*
  Admin test of the Character Sheet step: one photo → Kling image task → the sheet, without an order.
  The photo is kept in the private bucket under sheets/test/ (removed by the daily sweep after a day).
  Every run is charged by Kling.
*/

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

const TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
export type SheetStart = { ok: true; task: string; photo: string } | { ok: false; error: string };
export type SheetCheck = { state: "waiting" } | { state: "done"; url: string } | { state: "failed"; error: string };

function readSettings(fd: FormData) {
  const n = (k: string) => Number(fd.get(k));
  return parseSheetSettings({
    engine: fd.get("engine") === "omni" ? "omni" : "face",
    reference: fd.get("reference") === "face" ? "face" : "subject",
    imageFidelity: Math.min(1, Math.max(0, n("imageFidelity") || 0)),
    humanFidelity: Math.min(1, Math.max(0, n("humanFidelity") || 0)),
    aspectRatio: String(fd.get("aspect") ?? "16:9"),
    prompt: String(fd.get("prompt") ?? "").trim().slice(0, 2400),
  });
}

export async function startSheetTest(fd: FormData): Promise<SheetStart> {
  const user = await guard();
  if (!user) return { ok: false, error: "Нет доступа" };
  const file = fd.get("photo");
  let settings;
  try { settings = readSettings(fd); } catch { return { ok: false, error: "Неверные настройки" }; }
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Выберите фото" };
  const ext = TYPES[file.type];
  if (!ext || (settings.engine === "face" && ext === "webp")) return { ok: false, error: "Нужен JPG или PNG" };
  if (file.size > 900 * 1024) return { ok: false, error: "Фото слишком большое" };
  if (settings.prompt.length < 20) return { ok: false, error: "Промпт слишком короткий" };
  if (settings.engine === "omni" && !settings.prompt.includes("<<<image_1>>>")) return { ok: false, error: "Для Omni в промпте нужен <<<image_1>>> — это загруженное фото" };
  const db = supabaseAdmin();
  const path = `sheets/test/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from("user-uploads").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return { ok: false, error: "Фото не загрузилось" };
  const { data } = await db.storage.from("user-uploads").createSignedUrl(path, 3600);
  if (!data) return { ok: false, error: "Фото не загрузилось" };
  try {
    const task = await submitSheet(data.signedUrl, settings);
    await audit(user.id, "character_sheet.test", "kling", null, { task, engine: settings.engine, reference: settings.reference, imageFidelity: settings.imageFidelity, humanFidelity: settings.humanFidelity });
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
    if (st.state === "failed") return { state: "failed", error: st.errorCode === "provider_content_rejected" ? "Kling отклонил фото" : st.errorCode === "provider_no_face" ? "Kling не нашёл одно лицо на фото" : "Kling не сделал лист" };
    return { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}

/** Saves these settings for orders (the next Character Sheet in a real order uses them). */
export async function saveSheetSettings(fd: FormData): Promise<{ ok: boolean }> {
  const user = await guard();
  if (!user) return { ok: false };
  let value;
  try { value = readSettings(fd); } catch { return { ok: false }; }
  const { error } = await supabaseAdmin().from("site_settings").upsert({ key: SHEET_KEY, value, updated_by: user.id, updated_at: new Date().toISOString() });
  if (error) return { ok: false };
  await audit(user.id, "character_sheet.settings", "site_settings", null, { engine: value.engine, reference: value.reference, imageFidelity: value.imageFidelity, humanFidelity: value.humanFidelity });
  clearMemo();
  return { ok: true };
}
