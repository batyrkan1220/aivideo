"use server";
import { randomUUID } from "node:crypto";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getKlingImageTask, submitKlingImage } from "@/lib/generation/kling";
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

export async function startSheetTest(fd: FormData): Promise<SheetStart> {
  const user = await guard();
  if (!user) return { ok: false, error: "Нет доступа" };
  const file = fd.get("photo");
  const prompt = String(fd.get("prompt") ?? "").trim().slice(0, 2400);
  const aspect = ["16:9", "4:3", "1:1", "3:4", "9:16"].includes(String(fd.get("aspect"))) ? String(fd.get("aspect")) : "16:9";
  if (!(file instanceof File) || !file.size) return { ok: false, error: "Выберите фото" };
  const ext = TYPES[file.type];
  if (!ext) return { ok: false, error: "Нужен JPG, PNG или WebP" };
  if (file.size > 900 * 1024) return { ok: false, error: "Фото слишком большое" };
  if (prompt.length < 20 || !prompt.includes("<<<image_1>>>")) return { ok: false, error: "В промпте нужен <<<image_1>>> — это загруженное фото" };
  const db = supabaseAdmin();
  const path = `sheets/test/${randomUUID()}.${ext}`;
  const { error } = await db.storage.from("user-uploads").upload(path, new Uint8Array(await file.arrayBuffer()), { contentType: file.type });
  if (error) return { ok: false, error: "Фото не загрузилось" };
  const { data } = await db.storage.from("user-uploads").createSignedUrl(path, 3600);
  if (!data) return { ok: false, error: "Фото не загрузилось" };
  try {
    const task = await submitKlingImage({ photoUrls: [data.signedUrl], exampleUrl: null, prompt, aspectRatio: aspect });
    await audit(user.id, "character_sheet.test", "kling", null, { task, aspect });
    return { ok: true, task, photo: data.signedUrl };
  } catch (err) {
    return { ok: false, error: err instanceof ProviderError ? `Kling: ${err.code}` : "Kling не принял задачу" };
  }
}

export async function checkSheetTest(task: string): Promise<SheetCheck> {
  if (!(await guard())) return { state: "failed", error: "Нет доступа" };
  if (!/^[\w-]{1,80}$/.test(task)) return { state: "failed", error: "Неверная задача" };
  try {
    const st = await getKlingImageTask(task);
    if (st.state === "succeeded") return { state: "done", url: st.outputUrl };
    if (st.state === "failed") return { state: "failed", error: st.errorCode === "provider_content_rejected" ? "Kling отклонил фото" : "Kling не сделал лист" };
    return { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}
