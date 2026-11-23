"use server";
import { randomUUID } from "node:crypto";
import { audit, requirePermission, ForbiddenError } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { getKlingTask, getKlingV3OmniTask, submitKlingOmni, submitKlingV3Omni } from "@/lib/generation/kling";
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

// The user-videos bucket takes MP4/MOV up to 50 MB a file: a bigger video goes up in byte parts
// (<path>.p0, .p1, …) and the server joins and re-encodes it before Kling.
const TYPES: Record<string, string> = { "video/mp4": "mp4", "video/quicktime": "mov" };
const MAX_BYTES = 50 * 1024 * 1024;
const PART_BYTES = 45 * 1024 * 1024;
const MAX_TOTAL = 500 * 1024 * 1024;

export async function requestCartoonUpload(type: string, size: number): Promise<{ ok: true; path: string; urls: string[]; partBytes: number } | { ok: false; error: string }> {
  if (!(await guard())) return { ok: false, error: "Нет доступа" };
  const ext = TYPES[type];
  if (!ext) return { ok: false, error: "Нужен MP4 или MOV" };
  if (!(size > 0) || size > MAX_TOTAL) return { ok: false, error: "Видео больше 500 МБ" };
  const path = `admin-cartoon/${randomUUID()}.${ext}`;
  const parts = size > MAX_BYTES ? Math.ceil(size / PART_BYTES) : 1;
  const names = parts === 1 ? [path] : Array.from({ length: parts }, (_, i) => `${path}.p${i}`);
  const urls: string[] = [];
  for (const n of names) {
    const { data, error } = await supabaseAdmin().storage.from("user-videos").createSignedUploadUrl(n);
    if (error || !data) return { ok: false, error: "Не удалось начать загрузку" };
    urls.push(data.signedUrl);
  }
  return { ok: true, path, urls, partBytes: PART_BYTES };
}

export type CartoonEngine = "o3" | "v4" | "flash";
export type CartoonRun = { task: string; style: string; sec: number; at: string; flash: boolean; engine?: CartoonEngine };
/** Kling 3.0 Omni (O3) tasks are kept as "v3:<id>": they are checked on their own endpoint. */
const V3 = "v3:";
export type CartoonStart = { ok: true; run: CartoonRun } | { ok: false; error: string };

export async function startCartoon(input: { path: string; parts?: number; style: string; extra: string; durationSec: number; engine: CartoonEngine; hd: boolean }): Promise<CartoonStart> {
  const user = await guard();
  if (!user) return { ok: false, error: "Нет доступа" };
  if (!/^admin-cartoon\/[0-9a-f-]{36}\.(mp4|mov)$/.test(input.path)) return { ok: false, error: "Неверный файл" };
  const style = CARTOON_STYLES.find((s) => s.key === input.style)?.key as CartoonStyle | undefined;
  if (!style) return { ok: false, error: "Выберите стиль" };
  const sec = Math.round(Number(input.durationSec) * 10) / 10;
  if (!(sec >= 3)) return { ok: false, error: "Видео короче 3 секунд" };
  const engine: CartoonEngine = input.engine === "v4" || input.engine === "flash" ? input.engine : "o3";
  if (engine === "o3" && sec > 15.4) return { ok: false, error: "Kling O3 берёт видео до 15 секунд" };
  if (engine === "flash" && sec > 20.4) return { ok: false, error: "Flash берёт видео до 20 секунд" };
  if (sec > 30.4) return { ok: false, error: "Kling берёт видео до 30 секунд" };
  const flash = engine === "flash";
  const extra = String(input.extra ?? "").replace(/\s+/g, " ").trim().slice(0, 400);

  const db = supabaseAdmin();
  const parts = Math.max(1, Math.min(12, Math.floor(Number(input.parts) || 1)));
  let videoUrl = "";
  if (parts > 1) {
    // Big video: join the parts, re-encode under 48 MB, keep it as <path>.kling.mp4, drop the parts.
    const names = Array.from({ length: parts }, (_, i) => `${input.path}.p${i}`);
    const { data: signedParts } = await db.storage.from("user-videos").createSignedUrls(names, 3600);
    if (!signedParts || signedParts.some((x) => !x.signedUrl)) return { ok: false, error: "Видео не загрузилось" };
    try {
      const { assembleVideo } = await import("@/lib/media/assemble");
      const bytes = await assembleVideo(signedParts.map((x) => x.signedUrl as string));
      const copyPath = `${input.path}.kling.mp4`;
      const { error } = await db.storage.from("user-videos").upload(copyPath, bytes, { contentType: "video/mp4", upsert: true });
      const { data } = error ? { data: null } : await db.storage.from("user-videos").createSignedUrl(copyPath, 24 * 3600);
      if (!data) return { ok: false, error: "Не удалось сохранить сжатое видео" };
      videoUrl = data.signedUrl;
      console.log("[cartoon] assembled", parts, "parts →", Math.round(bytes.length / 1048576), "MB");
    } catch (err) {
      console.error("[cartoon] assemble failed", err instanceof Error ? err.message.slice(0, 160) : "error");
      return { ok: false, error: "Не удалось обработать видео — попробуйте файл поменьше" };
    } finally {
      await db.storage.from("user-videos").remove(names).catch(() => {});
    }
  }
  const { data: signed } = videoUrl ? { data: null } : await db.storage.from("user-videos").createSignedUrl(input.path, 24 * 3600);
  if (!videoUrl && !signed) return { ok: false, error: "Видео не загрузилось" };
  if (signed) videoUrl = signed.signedUrl;
  // Kling refuses videos under 700 px: send an upscaled copy (next to the source, swept with it).
  if (parts === 1) try {
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
  if (await cancelled(input.path)) {
    await db.storage.from("user-videos").remove([input.path, `${input.path}.kling.mp4`]).catch(() => {});
    return { ok: false, error: "Отменено — в Kling ничего не отправлено" };
  }
  try {
    const resolution = input.hd && !flash ? "1080p" : "720p";
    const prompt = cartoonPrompt(style, extra);
    // O3 = Kling 3.0 Omni on our own Kling account (needs a Kling 3.0 pack); 4.0 / Flash as before.
    const task = engine === "o3"
      ? V3 + await submitKlingV3Omni({ videoUrl, photoUrls: [], prompt, resolution })
      : await submitKlingOmni({ videoUrl, photoUrls: [], mode: "edit", prompt, durationSec: sec, aspectRatio: "adaptive", resolution, flash });
    const run: CartoonRun = { task, style, sec, at: new Date().toISOString(), flash, engine };
    await audit(user.id, "cartoon.run", "kling", null, { ...run, hd: input.hd && !flash, extra: extra.slice(0, 120) });
    return { ok: true, run };
  } catch (err) {
    console.error("[cartoon] kling refused", err instanceof ProviderError ? err.code : "error", err instanceof Error ? err.message.slice(0, 200) : "");
    if (err instanceof ProviderError && err.code === "provider_no_balance" && engine === "o3") {
      return { ok: false, error: "Kling: на аккаунте нет пакета для Kling 3.0 (O3). Купите пакет 3.0 в кабинете Kling API или выберите Kling 4.0." };
    }
    return { ok: false, error: err instanceof ProviderError ? `Kling: ${err.code}${err.message ? ` — ${err.message.slice(0, 160)}` : ""}` : "Kling не принял задачу" };
  }
}

/** «Отмена» before Kling: noted here, startCartoon checks it right before sending the video. */
export async function cancelCartoon(path: string): Promise<void> {
  const user = await guard();
  if (!user || !/^admin-cartoon\/[0-9a-f-]{36}\.(mp4|mov)$/.test(path)) return;
  await audit(user.id, "cartoon.cancel", "kling", null, { path });
  await supabaseAdmin().storage.from("user-videos").remove([path, `${path}.kling.mp4`]).catch(() => {});
}

async function cancelled(path: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("audit_logs").select("id").eq("action", "cartoon.cancel")
    .eq("metadata_json->>path", path).limit(1);
  return !!data?.length;
}

export type CartoonCheck = { state: "waiting" } | { state: "done"; url: string; external?: boolean } | { state: "failed"; error: string };

export async function checkCartoon(task: string): Promise<CartoonCheck> {
  if (!(await guard())) return { state: "failed", error: "Нет доступа" };
  if (!/^(v3:)?[\w-]{1,80}$/.test(task)) return { state: "failed", error: "Неверная задача" };
  try {
    const st = task.startsWith(V3) ? await getKlingV3OmniTask(task.slice(V3.length)) : await getKlingTask(task);
    if (st.state === "succeeded") {
      const url = await keepResult(task, st.outputUrl);
      // Not copied (e.g. over the 50 MB bucket limit): a plain link to Kling's file still opens.
      return url ? { state: "done", url } : { state: "done", url: st.outputUrl, external: true };
    }
    if (st.state === "failed") return { state: "failed", error: st.errorCode === "provider_content_rejected" ? "Kling отклонил видео (модерация)" : "Kling не сделал видео" };
    return { state: "waiting" };
  } catch {
    return { state: "waiting" };
  }
}

/**
 * The site's CSP plays video only from our own storage, so the finished cartoon is copied from Kling
 * to generated-videos/admin-cartoon/<task>.mp4 once (kept 30 days) and shown by a signed link.
 */
async function keepResult(task: string, klingUrl: string): Promise<string | null> {
  const db = supabaseAdmin();
  const name = task.replace(/[^\w-]/g, "_");
  const path = `admin-cartoon/${name}.mp4`;
  const sign = async () => (await db.storage.from("generated-videos").createSignedUrl(path, 6 * 3600)).data?.signedUrl ?? null;
  const { data: have } = await db.storage.from("generated-videos").list("admin-cartoon", { search: `${name}.mp4`, limit: 1 });
  if (have?.some((f) => f.name === `${name}.mp4`)) return sign();
  try {
    const res = await fetch(klingUrl, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
    if (!res.ok) throw new Error(`download ${res.status}`);
    const bytes = new Uint8Array(await res.arrayBuffer());
    const { error } = await db.storage.from("generated-videos").upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (error) throw new Error(error.message);
    return sign();
  } catch (err) {
    console.error("[cartoon] copy failed", task, err instanceof Error ? err.message.slice(0, 120) : "error");
    return null;
  }
}
