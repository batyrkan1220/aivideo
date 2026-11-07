import "server-only";
import { createWriteStream } from "node:fs";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { imageSize } from "image-size";
import { clearMemo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "./queries";
import { parseSeedanceConfig, seedanceSlots } from "./seedance-config";
import { analysisHint, applyAnalysis, cutoutRect, faceInCutout, needsReanalysis, type Box } from "./analysis";
import { describeTemplateFrames, VisionError } from "./vision";
import { liteBusy, runFfmpeg } from "./lite-preview";
import { snapshotVersion } from "./versions";

/*
  Server-side AI analysis of a template video, for templates made before the editor did it (and an
  admin "re-analyse" button). Same steps as the editor: a frame of every scene (6–10) → Gemini → cut-outs → config.
  The admin's people count and things are kept; only descriptions, cut-outs and the scene note are added.
  Memory: the video is streamed to a temp file and ffmpeg runs single-threaded, one template at a time.
*/
const MAX_SOURCE_BYTES = 80 * 1024 * 1024;
const queue: string[] = [];
let running = false;

export function queueAnalysis(templateId: string) {
  if (!queue.includes(templateId)) queue.push(templateId);
  if (!running) void drain();
}

/** Server start: every catalog video template without an analysis. */
export async function backfillAnalysis(): Promise<number> {
  const { data } = await supabaseAdmin().from("templates")
    .select("id,provider_config_json").eq("kind", "catalog").eq("provider_key", "seedance")
    .not("preview_video_path", "is", null).is("deleted_at", null).order("sort_order").limit(500);
  const todo = (data ?? []).filter((r) => needsReanalysis(parseSeedanceConfig(r.provider_config_json)));
  for (const r of todo) queueAnalysis(r.id);
  return todo.length;
}

async function drain() {
  running = true;
  let ok = 0, failed = 0;
  try {
    while (queue.length) {
      // One ffmpeg job on the server at a time.
      while (liteBusy()) await new Promise((r) => setTimeout(r, 3000));
      const id = queue.shift()!;
      try {
        if (await analyzeTemplate(id)) ok++; else failed++;
      } catch (err) {
        failed++;
        console.error("[analysis] failed", id, err instanceof VisionError ? err.code : err instanceof Error ? err.message.slice(0, 200) : "error");
        if (err instanceof VisionError && err.code === "not_configured") { queue.length = 0; break; }
      }
      // Gemini free tier: a short pause between templates.
      await new Promise((r) => setTimeout(r, 4000));
    }
  } finally {
    running = false;
    if (ok || failed) { clearMemo(); console.log(`[analysis] done ok=${ok} failed=${failed}`); }
  }
}

/** Analyses one template and saves it. keep = the admin's people count and things stay. */
export async function analyzeTemplate(templateId: string, keep = true): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: t } = await db.from("templates")
    .select("id,status,provider_key,preview_video_path,video_duration_sec,provider_config_json,title_kk,description_kk").eq("id", templateId).maybeSingle();
  const url = mediaUrl(t?.preview_video_path ?? null);
  if (!t || t.provider_key !== "seedance" || !url) return false;
  const src = t.preview_video_path;
  const cfg = parseSeedanceConfig(t.provider_config_json);

  const res = await fetch(url, { signal: AbortSignal.timeout(120_000), cache: "no-store" });
  if (!res.ok || !res.body) return false;
  if (Number(res.headers.get("content-length") ?? 0) > MAX_SOURCE_BYTES) { void res.body.cancel(); return false; }
  const dir = await mkdtemp(join(tmpdir(), "ai-"));
  const uploaded: string[] = [];
  try {
    const inPath = join(dir, "in");
    await pipeline(Readable.fromWeb(res.body as unknown as WebReadableStream), createWriteStream(inPath));
    const d = Number(t.video_duration_sec) || 10;
    const frames: string[] = [];
    const framePaths: string[] = [];
    // A frame from every scene (a person in one short scene was missed), then evenly spaced ones.
    const { findShots } = await import("@/lib/media/scene-parts");
    const { analysisTimes } = await import("@/lib/media/scene-plan");
    const scenes = await findShots(inPath).catch(() => null);
    const times = analysisTimes(scenes?.total || d, scenes?.cuts ?? []);
    for (const [i, tm] of times.entries()) {
      const out = join(dir, `f${i}.jpg`);
      const at = Math.max(0, Math.min(tm, d - 0.2)).toFixed(2);
      try {
        await runFfmpeg(inPath, out, (inp, o) => ["-hide_banner", "-loglevel", "error", "-y", "-threads", "1", "-ss", at, "-i", inp, "-frames:v", "1",
          "-vf", "scale='if(gt(iw,ih),640,-2)':'if(gt(iw,ih),-2,640)'", "-q:v", "4", o]);
        frames.push((await readFile(out)).toString("base64"));
        framePaths.push(out);
      } catch { /* a frame past the end: skip it */ }
    }
    if (!frames.length) return false;

    const a = await describeTemplateFrames(frames, analysisHint(cfg, keep));

    // hideFace: the copy for Kling, with the original face pixelated so Kling cannot take it.
    const cut = async (x: { frame: number; box: Box | null; face?: Box | null }, hideFace = false): Promise<string> => {
      const fp = framePaths[x.frame] ?? framePaths[0];
      if (!x.box || !fp) return "";
      const dim = imageSize(await readFile(fp));
      const r = dim.width && dim.height ? cutoutRect(dim.width, dim.height, x.box) : null;
      if (!r) return "";
      const f = hideFace ? (x.face && dim.width && dim.height ? faceInCutout(dim.width, dim.height, x.box, x.face) : null) : null;
      if (hideFace && !f) return "";
      const out = join(dir, `c${randomUUID()}.jpg`);
      const base = `crop=${r.sw}:${r.sh}:${r.sx}:${r.sy},scale=${r.outW}:${r.outH}:flags=lanczos`;
      const vf = f
        ? ["-filter_complex", `[0]${base},split[a][b];[b]crop=${f.w}:${f.h}:${f.x}:${f.y},scale=6:6,scale=${f.w}:${f.h}:flags=neighbor[f];[a][f]overlay=${f.x}:${f.y}`]
        : ["-vf", base];
      await runFfmpeg(fp, out, (inp, o) => ["-hide_banner", "-loglevel", "error", "-y", "-i", inp, ...vf, "-q:v", "3", o]);
      const path = `targets/${randomUUID()}.jpg`;
      const { error } = await db.storage.from("template-media").upload(path, await readFile(out), { contentType: "image/jpeg", cacheControl: "31536000", upsert: false });
      if (error) return "";
      uploaded.push(path);
      return path;
    };
    const people: string[] = [];
    const peopleKling: string[] = [];
    for (const p of a.people) {
      people.push(await cut(p).catch(() => ""));
      peopleKling.push(await cut(p, true).catch(() => ""));
    }
    const objects: string[] = [];
    for (const o of a.objects) objects.push(await cut(o).catch(() => ""));

    const next = applyAnalysis(cfg, a, { people, objects, peopleKling }, keep);
    const slots = seedanceSlots(next.people, "face_", next.labels, next.objects, next.targets);
    // Only if the template still has the same video (the admin may have replaced it meanwhile).
    const { data: updated } = await db.from("templates")
      .update({
        provider_config_json: next, face_slots_json: slots, required_face_count: slots.length,
        // Name and text for customers from the AI, only where the admin left them empty.
        ...(!String(t.title_kk ?? "").trim() && a.title ? { title_kk: a.title } : {}),
        ...(!String(t.description_kk ?? "").trim() && a.description ? { description_kk: a.description } : {}),
      })
      .eq("id", templateId).eq("preview_video_path", src).select("id");
    if (!updated?.length) { if (uploaded.length) await db.storage.from("template-media").remove(uploaded); return false; }
    if (t.status === "published") await snapshotVersion(templateId);
    console.log("[analysis] template", templateId, `people=${next.people} things=${next.objects.length} cutouts=${uploaded.length}`);
    return true;
  } catch (err) {
    if (uploaded.length) await db.storage.from("template-media").remove(uploaded).catch(() => {});
    throw err;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
