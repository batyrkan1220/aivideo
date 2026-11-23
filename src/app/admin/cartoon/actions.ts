"use server";
import { randomUUID } from "node:crypto";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getKlingTask, submitKlingOmni } from "@/lib/generation/kling";
import { ProviderError } from "@/lib/generation/types";
import { CARTOON_STYLES, cartoonPrompt, type CartoonStyle } from "./styles";

/*
  Admin tool «Мультфильм»: an uploaded video → the same video drawn as a cartoon (Kling 4.0 Omni edit,
  base_video: motion, faces, framing and timing stay 1:1). The source goes to user-videos/admin-cartoon/
  and is removed by the daily orphan sweep after a day. Every run is charged by Kling.
*/

async function guard() {
  try { return await requirePermission("templates.manage"); } catch (e) { if (e instanceof ForbiddenError) return null; throw e; }
}

// The user-videos bucket takes MP4/MOV up to 50 MB.
const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const MAX_BYTES = 50 * 1024 * 1024;

export async function requestCartoonUpload(type: string, size: number): Promise<{ ok: true; path: string; url: string } | { ok: false; error: string }> {
  if (!(await guard())) return { ok: false, error: "Нет доступа" };
  const ext = TYPES[type];
  if (!ext) return { ok: false, error: "Нужен MP4 или MOV" };
  if (!(size > 0) || size > MAX_BYTES) return { ok: false, error: "Видео больше 50 МБ — сожмите его" };
  const path = `admin-cartoon/${randomUUID()}.${ext}`;
  const { data, error } = await supabaseAdmin().storage.from("user-videos").createSignedUploadUrl(path);
  if (error || !data) return { ok: false, error: "Не удалось начать загрузку" };
  return { ok: true, path, url: data.signedUrl };
}

export type CartoonRun = { task: string; style: string; sec: number; at: string; flash: boolean };
export type CartoonStart = { ok: true; run: CartoonRun } | { ok: false; error: string };

export async function startCartoon(input: { path: string; style: string; extra: string; durationSec: number; flash: boolean; hd: boolean }): Promise<CartoonStart> {
  const user = await guard();
  if (!user) return { ok: false, error: "Нет доступа" };
  if (!/^admin-cartoon\/[0-9a-f-]{36}\.(mp4|mov)$/.test(input.path)) return { ok: false, error: "Неверный файл" };
  const style = CARTOON_STYLES.find((s) => s.key === input.style)?.key as CartoonStyle | undefined;
  if (!style) return { ok: false, error: "Выберите стиль" };
  const sec = Math.round(Number(input.durationSec) * 10) / 10;
  if (!(sec >= 3)) return { ok: false, error: "Видео короче 3 секунд" };
  if (sec > 30.4) return { ok: false, error: "Kling берёт видео до 30 секунд" };
  const flash = !!input.flash && sec <= 20.4;
  const extra = String(input.extra ?? "").replace(/\s+/g, " ").trim().slice(0, 400);

  const db = supabaseAdmin();
  const { data: signed } = await db.storage.from("user-videos").createSignedUrl(input.path, 24 * 3600);
  if (!signed) return { ok: false, error: "Видео не загрузилось" };
  let videoUrl = signed.signedUrl;
  // Kling refuses videos under 700 px: send an upscaled copy (next to the source, swept with it).
  try {
    const { klingReadyCopy } = await import("@/lib/media/kling-video");
    const copy = await klingReadyCopy(videoUrl, MAX_BYTES + 1);
    if (copy) {
      const copyPath = `${input.path}.kling.mp4`;
      const { error } = await db.storage.from("user-videos").upload(copyPath, copy, { contentType: "video/mp4", upsert: true });
      const { data } = error ? { data: null } : await db.storage.from("user-videos").createSignedUrl(copyPath, 24 * 3600);
      if (data) videoUrl = data.signedUrl;
    }
  } catch (err) {
    console.error("[cartoon] video copy failed", err instanceof Error ? err.message.slice(0, 120) : "error");
  }
  try {
    const task = await submitKlingOmni({
      videoUrl, photoUrls: [], mode: "edit", prompt: cartoonPrompt(style, extra),
      durationSec: sec, aspectRatio: "adaptive", resolution: input.hd && !flash ? "1080p" : "720p", flash,
    });
    const run: CartoonRun = { task, style, sec, at: new Date().toISOString(), flash };
    await audit(user.id, "cartoon.run", "kling", null, { ...run, hd: input.hd && !flash, extra: extra.slice(0, 120) });
    return { ok: true, run };
  } catch (err) {
    console.error("[cartoon] kling refused", err instanceof ProviderError ? err.code : "error", err instanceof Error ? err.message.slice(0, 200) : "");
    return { ok: false, error: err instanceof ProviderError ? `Kling: ${err.code}${err.message ? ` — ${err.message.slice(0, 160)}` : ""}` : "Kling не принял задачу" };
  }
}

export type CartoonCheck = { state: "waiting" } | { state: "done"; url: string } | { state: "failed"; error: string };

export async function checkCartoon(task: string): Promise<CartoonCheck> {
  if (!(await guard())) return { state: "failed", error: "Нет доступа" };
  if (!/^[\w-]{1,80}$/.test(task)) return { state: "failed", error: "Неверная задача" };
  try {
    const st = await getKlingTask(task);
    if (st.state === "succeeded") return { state: "done", url: st.outputUrl };
    if (st.state === "failed") return { state: "failed", error: st.errorCode === "provider_content_rejected" ? "Kling отклонил видео (модерация)" : "Kling не сделал видео" };
    return { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}
