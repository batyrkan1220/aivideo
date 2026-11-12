import "server-only";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { supabaseAdmin } from "@/lib/supabase/server";
import { holdMedia } from "@/lib/templates/lite-preview";
import { renderMontage } from "./render";
import { montageOptionsSchema } from "./schema";

/*
  Runs one Автомонтаж: claims it (queued → processing, so two servers never take the same one), downloads
  the clips, renders, stores the video, sends it to the customer's Telegram and deletes the clips.
  Started right after the customer presses the button; the status page re-starts a montage that was left
  (the server restarted) — at most 2 attempts.
*/

const CLIPS = "user-videos";
const OUT = "generated-videos";
const KEEP_DAYS = 30;
let running = 0;

export async function processMontage(id: string): Promise<void> {
  const db = supabaseAdmin();
  const { data: m } = await db.from("montages").update({ status: "processing", started_at: new Date().toISOString() })
    .eq("id", id).eq("status", "queued").select("id,user_id,clips,music_path,options,attempts").maybeSingle();
  if (!m) return;
  await db.from("montages").update({ attempts: (m.attempts ?? 0) + 1 }).eq("id", id);
  running++;
  const release = holdMedia();
  const dir = await mkdtemp(join(tmpdir(), "mt-"));
  try {
    const opts = montageOptionsSchema.parse(m.options ?? {});
    const clips = (m.clips as { path: string }[]).map((c) => c.path);
    const files: string[] = [];
    for (const [i, p] of clips.entries()) {
      const { data, error } = await db.storage.from(CLIPS).download(p);
      if (error || !data) throw new Error("clip_missing");
      const f = join(dir, `c${i}`);
      await writeFile(f, new Uint8Array(await data.arrayBuffer()));
      files.push(f);
    }
    let music: string | null = null;
    if (opts.sound === "music" && m.music_path) {
      const { data } = await db.storage.from(CLIPS).download(m.music_path);
      if (data) { music = join(dir, "music"); await writeFile(music, new Uint8Array(await data.arrayBuffer())); }
    }
    const r = await renderMontage(dir, files, music, music ? opts : { ...opts, sound: opts.sound === "music" ? "original" : opts.sound });
    const bytes = await readFile(r.file);
    if (bytes.byteLength > 49 * 1024 * 1024) throw new Error("too_large");
    const path = `${m.user_id}/montage-${id}.mp4`;
    const { error: upErr } = await db.storage.from(OUT).upload(path, bytes, { contentType: "video/mp4", upsert: true });
    if (upErr) throw new Error("store_failed");
    await db.from("montages").update({
      status: "completed", output_path: path, output_duration_sec: r.durationSec, completed_at: new Date().toISOString(), error_code: null,
      expires_at: new Date(Date.now() + KEEP_DAYS * 86400_000).toISOString(),
    }).eq("id", id);
    console.log("[montage] done", id, `${r.durationSec}s`, Math.round(bytes.byteLength / 1024), "KB");
    // The clips are not needed any more.
    await db.storage.from(CLIPS).remove([...clips, ...(m.music_path ? [m.music_path] : [])]).catch(() => {});
    await sendToTelegram(m.user_id, id, bytes).catch(() => {});
  } catch (err) {
    const code = err instanceof Error && /^[a-z_]{3,40}$/.test(err.message) ? err.message : "render_failed";
    console.error("[montage] failed", id, code, err instanceof Error ? err.message.slice(0, 200) : "");
    await db.from("montages").update({ status: "failed", error_code: code, completed_at: new Date().toISOString() }).eq("id", id);
  } finally {
    running--;
    release();
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}

/** A montage left behind (server restart): queued for over a minute, or processing for over 12. */
export async function resumeMontage(id: string, status: string, startedAt: string | null, createdAt: string, attempts: number) {
  if (running > 0 || attempts >= 2) return;
  const age = (iso: string | null) => (iso ? Date.now() - new Date(iso).getTime() : Infinity);
  const db = supabaseAdmin();
  if (status === "processing" && age(startedAt) > 12 * 60_000) {
    await db.from("montages").update({ status: "queued" }).eq("id", id).eq("status", "processing");
  } else if (!(status === "queued" && age(createdAt) > 60_000)) return;
  void processMontage(id);
}

async function sendToTelegram(userId: string, id: string, bytes: Uint8Array) {
  const db = supabaseAdmin();
  const { data: p } = await db.from("profiles").select("telegram_id").eq("id", userId).maybeSingle();
  if (!p?.telegram_id) return;
  const { sendVideoFile } = await import("@/lib/telegram/bot");
  const { videoMeta } = await import("@/lib/telegram/video-meta");
  const blob = new Blob([new Uint8Array(bytes)], { type: "video/mp4" });
  const meta = await videoMeta(blob).catch(() => undefined);
  await sendVideoFile(Number(p.telegram_id), blob, "TrendMe-montage.mp4", "🎬 Ваш монтаж готов!", meta, { text: "Открыть", path: `/montage/${id}` });
}
