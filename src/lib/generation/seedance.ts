import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_REFS, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ProviderError, type GenerationProvider, type ProviderState } from "./types";
import { buildKlingDirectPrompt, getKlingTask, KLING_MAX_IMAGES, submitKlingOmni } from "./kling";
import { mediaUrl } from "@/lib/templates/queries";
import { supabaseAdmin } from "@/lib/supabase/server";

/**
 * The video provider (key "seedance" for existing rows): Kling 4.0 via Kling's official API.
 * Edit mode edits the template video (base_video); the people in it are replaced by the customer's photos (@image_N).
 * 720p, 9:16 by default.
 */

/** Customer text is free input: no media tags, no control characters, limited length. */
export const cleanWish = (s: unknown) =>
  typeof s === "string" ? s.replace(/[@<>{}\[\]\\]/g, " ").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 300) : "";

const imgIndex = (providerInput: string) => {
  const m = /^img_(\d+)$/.exec(providerInput);
  return m ? Number(m[1]) : null;
};

export const seedanceProvider: GenerationProvider = {
  key: "seedance",

  capabilities() {
    return {
      videoFaceSwap: true,
      maxFaces: SEEDANCE_MAX_REFS,
      qualities: ["720p", "1080p"],
      supportsCancel: false,
      reportsProgress: false,
      reportsCost: true,
      producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    const cfg = seedanceConfigSchema.safeParse(input.config ?? {});
    if (!cfg.success) return ["invalid_provider_config"];
    if (!input.templateVideoUrl) problems.push("missing_video");
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > SEEDANCE_MAX_REFS) problems.push("too_many_faces");
    const idx = input.faces.map((f) => imgIndex(f.providerInput));
    if (idx.some((x, i) => x !== i + 1)) problems.push("unmapped_slot");
    const d = Number((input.config as { durationSec?: unknown }).durationSec);
    if (!(d > 0)) problems.push("unknown_duration");
    else if (d < SEEDANCE_MIN_SEC - 0.5 || d > SEEDANCE_MAX_SEC + 0.5) problems.push("bad_duration");
    return problems;
  },

  async submit(input) {
    const cfg = seedanceConfigSchema.parse(input.config ?? {});
    const extra = input.config as { durationSec?: number; wish?: unknown; customerOutfit?: unknown };
    // "choice": the customer picked the outfit on the order page (default: as in the template).
    const outfit = cfg.outfit === "choice" ? (extra.customerOutfit === "photo" ? "photo" : "template") : cfg.outfit;
    const durationSec = Number(extra.durationSec);
    const photos = input.faces.map((f) => f.imageUrl).slice(0, SEEDANCE_MAX_REFS);
    // People first (img_1…img_n), then the things to swap (car, horse, outfit…).
    // How many people is the number set on the template.
    // Only photos that were actually uploaded count, so a car slot is never sent as a person.
    const declaredPeople = Math.min(SEEDANCE_MAX_PEOPLE, Math.max(1, cfg.people));
    const objects = cfg.objects.slice(0, Math.min(SEEDANCE_MAX_OBJECTS, Math.max(0, photos.length - declaredPeople)));
    const people = Math.min(declaredPeople, Math.max(1, photos.length - objects.length));
    const resolution: "720p" | "1080p" = input.quality === "1080p" ? "1080p" : "720p";
    // Photos go straight to the video call as reference images, people first, then things.
    const usedPhotos = photos.slice(0, people + objects.length);
    // Optional cut-outs from the template, after the customer's photos, while Kling's 10 images last.
    const cutouts: string[] = [];
    // Person cut-outs are not sent: with them Kling mixed up or kept people (TM-100024, TM-100026).
    // Only things (car, horse…) get their cut-out, so Kling knows which one to swap.
    const targetPaths = [...Array.from({ length: people }, () => ""), ...objects.map((o) => o.target ?? "")];
    const targetRefs = targetPaths.map((path) => {
      const url = cfg.showTargets ? mediaUrl(path?.trim() || null) : null;
      if (!url || usedPhotos.length + cutouts.length >= KLING_MAX_IMAGES) return "";
      cutouts.push(url);
      return `@image_${usedPhotos.length + cutouts.length}`;
    });
    const wish = cfg.allowWish ? cleanWish(extra.wish) : "";
    const pricing = await seedancePricingSettings();
    if (people > 1 && cfg.klingMode === "edit") {
      // Kling cleanly replaces one person per run (2–3 at once got mixed up or kept: TM-100026/27).
      // So the video is edited once per person, each run on the previous result; things go with the last run.
      const objectPhotos = usedPhotos.slice(people);
      const passes: Pass[] = Array.from({ length: people }, (_, k) => {
        const last = k === people - 1;
        const where = cfg.positions[k]?.trim() || `number ${k + 1} from the left`;
        return {
          photoUrls: [usedPhotos[k], ...(last ? objectPhotos : [])],
          prompt: buildKlingDirectPrompt("edit", outfit, cfg.prompt, last ? wish : "", 1, [where], last ? objects : []),
        };
      });
      // With cuts: every shot goes through every person's run, then the shots are joined (TM-100038).
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, passes, cfg.aspectRatio, resolution, pricing);
      if (shotRun) return shotRun;
      const providerJobId = await submitKlingOmni({ videoUrl: input.templateVideoUrl, mode: "edit", durationSec, aspectRatio: cfg.aspectRatio, resolution, ...passes[0] });
      console.log("[kling] person 1 of", people);
      return {
        providerJobId,
        cost: seedanceCostUsd(durationSec, pricing, {}, resolution),
        state: { stage: "pass", k: 0, passes, durationSec, aspectRatio: cfg.aspectRatio, resolution },
      };
    }
    const prompt = buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects, targetRefs);
    const plain = { videoUrl: input.templateVideoUrl, photoUrls: usedPhotos, mode: cfg.klingMode, durationSec, aspectRatio: cfg.aspectRatio, resolution };
    // A template with cuts: Kling loses the face after a cut, so each shot is edited on its own (TM-100034).
    if (cfg.klingMode === "edit") {
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, [{ photoUrls: [...usedPhotos, ...cutouts], prompt }], cfg.aspectRatio, resolution, pricing);
      if (shotRun) return shotRun;
    }
    const providerJobId = await submitKlingOmni({ ...plain, photoUrls: [...usedPhotos, ...cutouts], prompt });
    // If Kling refuses the task because of a cut-out (it charges nothing then), the same order goes again without them.
    const fallback = cutouts.length
      ? { ...plain, prompt: buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects) }
      : null;
    return { providerJobId, cost: seedanceCostUsd(durationSec, pricing, {}, resolution), state: { stage: "klingd", ...(fallback ? { fallback } : {}) } };
  },

  async getStatus(providerJobId, ctx) {
    const shotRun = shotsOf(ctx.state);
    if (shotRun) return shotStatus(shotRun);
    const st = await getKlingTask(providerJobId);
    const run = passOf(ctx.state);
    if (run) {
      // One person per run: the next run edits the previous result.
      if (st.state !== "succeeded" || run.k + 1 >= run.passes.length) return st;
      const k = run.k + 1;
      const id = await submitKlingOmni({ videoUrl: st.outputUrl, mode: "edit", durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: run.resolution, ...run.passes[k] });
      console.log("[kling] person", k + 1, "of", run.passes.length);
      return {
        state: "processing",
        next: { providerJobId: id, state: { ...run, k } as ProviderState, cost: seedanceCostUsd(run.durationSec, await seedancePricingSettings(), {}, run.resolution) },
      };
    }
    const fb = fallbackOf(ctx.state);
    if (st.state !== "failed" || st.errorCode === "provider_content_rejected" || !fb) return st;
    console.log("[kling] task", providerJobId, "failed with template cut-outs; sending again without them");
    const id = await submitKlingOmni(fb);
    return { state: "processing", next: { providerJobId: id, state: { stage: "klingd" } } };
  },
};

type Fallback = Parameters<typeof submitKlingOmni>[0];
function fallbackOf(state: ProviderState): Fallback | null {
  const f = (state as { fallback?: Partial<Fallback> } | null)?.fallback;
  if (!f || typeof f.videoUrl !== "string" || !Array.isArray(f.photoUrls) || typeof f.prompt !== "string" || typeof f.durationSec !== "number") return null;
  return { videoUrl: f.videoUrl, photoUrls: f.photoUrls.filter((u): u is string => typeof u === "string"), prompt: f.prompt, durationSec: f.durationSec,
    mode: f.mode === "reference" ? "reference" : "edit", aspectRatio: typeof f.aspectRatio === "string" ? f.aspectRatio : "adaptive", resolution: f.resolution === "1080p" ? "1080p" : "720p" };
}

type Pass = { photoUrls: string[]; prompt: string };
type PassRun = { stage: "pass"; k: number; passes: Pass[]; durationSec: number; aspectRatio: string; resolution: "720p" | "1080p" };
function passOf(state: ProviderState): PassRun | null {
  const s = state as Partial<PassRun> | null;
  if (!s || s.stage !== "pass" || typeof s.k !== "number" || !Array.isArray(s.passes) || typeof s.durationSec !== "number") return null;
  const passes = s.passes.filter((p): p is Pass => !!p && Array.isArray(p.photoUrls) && typeof p.prompt === "string");
  if (!passes.length || s.k >= passes.length) return null;
  return { stage: "pass", k: s.k, passes, durationSec: s.durationSec, aspectRatio: typeof s.aspectRatio === "string" ? s.aspectRatio : "adaptive", resolution: s.resolution === "1080p" ? "1080p" : "720p" };
}

// ---------------------------------------------------------------- shot by shot

/** Added to each shot's prompt: the shot is a piece of a longer video. */
const SHOT_NOTE = "@video_1 is one shot of a longer video: edit only what is in this shot, keep its start and end exactly as they are.";
const SHOTS_BUCKET = "user-videos";
/** k = the run (person) this shot is at; mid = that run's input after the first run. */
type Shot = { path: string; url: string; len: number; id?: string | null; out?: string | null; k?: number; mid?: string | null };
type ShotRun = { stage: "shots"; shots: Shot[]; passes: Pass[]; aspectRatio: string; resolution: "720p" | "1080p"; soundUrl: string };
type Pricing = Awaited<ReturnType<typeof seedancePricingSettings>>;

function shotsOf(state: ProviderState): ShotRun | null {
  const s = state as (Partial<ShotRun> & { photoUrls?: string[]; prompt?: string }) | null;
  if (!s || s.stage !== "shots" || !Array.isArray(s.shots) || !s.shots.length) return null;
  // Older state: one run with photoUrls + prompt.
  const passes = Array.isArray(s.passes) ? s.passes.filter((p): p is Pass => !!p && Array.isArray(p.photoUrls) && typeof p.prompt === "string")
    : Array.isArray(s.photoUrls) && typeof s.prompt === "string" ? [{ photoUrls: s.photoUrls, prompt: s.prompt }] : [];
  if (!passes.length) return null;
  return { stage: "shots", shots: s.shots as Shot[], passes, aspectRatio: typeof s.aspectRatio === "string" ? s.aspectRatio : "adaptive",
    resolution: s.resolution === "1080p" ? "1080p" : "720p", soundUrl: typeof s.soundUrl === "string" ? s.soundUrl : "" };
}

/** Cuts the template and sends every shot's first run; null = one shot (the caller sends the video whole). */
async function startShots(jobId: string, videoUrl: string, passes: Pass[], aspectRatio: string, resolution: "720p" | "1080p", pricing: Pricing) {
  const shots = await prepareShots(jobId, videoUrl);
  if (!shots) return null;
  const run: ShotRun = { stage: "shots", shots, passes: passes.map((p) => ({ ...p, prompt: `${p.prompt} ${SHOT_NOTE}` })), aspectRatio, resolution, soundUrl: videoUrl };
  const first = await submitShot(run, 0);
  shots[0].id = first;
  let cost = seedanceCostUsd(shots[0].len, pricing, {}, resolution);
  for (let k = 1; k < shots.length; k++) {
    // Busy or refused: tried again on the next poll, which also reports a real failure.
    const id = await submitShot(run, k).catch(() => null);
    if (id) { shots[k].id = id; cost += seedanceCostUsd(shots[k].len, pricing, {}, resolution); }
  }
  console.log("[kling] template in", shots.length, "shots ×", run.passes.length, passes.length > 1 ? "people" : "person");
  return { providerJobId: first, cost, state: run as unknown as ProviderState };
}

/** Cuts the template into shots and stores them privately for Kling; null = one shot (or it could not be cut). */
async function prepareShots(jobId: string, videoUrl: string): Promise<Shot[] | null> {
  const shots = await cutShots(jobId, videoUrl);
  // Finished without a crash: a normal retry may cut again.
  await supabaseAdmin().from("generation_jobs").update({ provider_state: null }).eq("id", jobId);
  return shots;
}

async function cutShots(jobId: string, videoUrl: string): Promise<Shot[] | null> {
  const db = supabaseAdmin();
  // Once per job: if the server went down while cutting (out of memory), the retry sends the video whole.
  const { data: job } = await db.from("generation_jobs").select("provider_state").eq("id", jobId).maybeSingle();
  if ((job?.provider_state as { shotsTried?: boolean } | null)?.shotsTried) { console.log("[kling] shots tried before; video sent whole"); return null; }
  await db.from("generation_jobs").update({ provider_state: { shotsTried: true } }).eq("id", jobId);
  try {
    const { splitAtCuts } = await import("@/lib/media/scene-parts");
    const split = await splitAtCuts(videoUrl);
    if (!split) return null;
    const shots: Shot[] = [];
    for (const [k, p] of split.parts.entries()) {
      const path = `kling-shots/${jobId}/p${k}.mp4`;
      const { error } = await db.storage.from(SHOTS_BUCKET).upload(path, p.file, { contentType: "video/mp4", upsert: true });
      const { data: signed } = error ? { data: null } : await db.storage.from(SHOTS_BUCKET).createSignedUrl(path, 48 * 3600);
      if (!signed) { console.error("[kling] shot upload failed", error?.message?.slice(0, 120)); return null; }
      shots.push({ path, url: signed.signedUrl, len: p.len });
    }
    return shots;
  } catch (err) {
    console.error("[kling] shots skipped", err instanceof Error ? err.message.slice(0, 160) : "error");
    return null;
  }
}

/** Sends shot k's current run: the first run edits the cut shot, each later run the previous result. */
const submitShot = (run: ShotRun, k: number) => {
  const s = run.shots[k], pass = run.passes[s.k ?? 0];
  return submitKlingOmni({
    videoUrl: (s.k ?? 0) > 0 && s.mid ? s.mid : s.url, photoUrls: pass.photoUrls, mode: "edit", prompt: pass.prompt,
    durationSec: Math.max(3, s.len), aspectRatio: run.aspectRatio, resolution: run.resolution,
  });
};

async function removeShots(run: ShotRun) {
  await supabaseAdmin().storage.from(SHOTS_BUCKET).remove(run.shots.map((s) => s.path)).catch(() => {});
}

async function shotStatus(run: ShotRun): Promise<import("./types").ProviderJobStatus> {
  const shots = run.shots.map((s) => ({ ...s }));
  const cur: ShotRun = { ...run, shots };
  const pricing = await seedancePricingSettings();
  let added = 0, changed = false;
  for (const [k, s] of shots.entries()) {
    if (s.out) continue;
    if (s.id) {
      const st = await getKlingTask(s.id);
      if (st.state === "failed") { await removeShots(run); return st; }
      if (st.state !== "succeeded") continue;
      changed = true;
      const next = (s.k ?? 0) + 1;
      if (next >= run.passes.length) { s.out = st.outputUrl; continue; }
      // Next person in this shot, on the result so far.
      s.k = next; s.mid = st.outputUrl; s.id = null;
      console.log("[kling] shot", k + 1, "person", next + 1, "of", run.passes.length);
    }
    try {
      s.id = await submitShot(cur, k);
      added += seedanceCostUsd(s.len, pricing, {}, run.resolution);
      changed = true;
    } catch (err) {
      if (err instanceof ProviderError && err.retryable) continue;
      await removeShots(run);
      return { state: "failed", errorCode: err instanceof ProviderError ? err.code : "provider_failed", retryable: false };
    }
  }
  const firstId = shots.find((s) => s.id)?.id ?? shots[0].id ?? "";
  if (shots.every((s) => s.out)) {
    const { joinParts } = await import("@/lib/media/scene-parts");
    const bytes = await joinParts(shots.map((s) => s.out!), shots.map((s) => s.len), run.soundUrl);
    await removeShots(run);
    console.log("[kling] shots joined", shots.length);
    return { state: "succeeded", outputUrl: shots[0].out!, outputBytes: bytes };
  }
  const steps = shots.length * run.passes.length;
  const done = shots.reduce((n, s) => n + (s.out ? run.passes.length : (s.k ?? 0)), 0);
  return {
    state: "processing",
    progress: Math.round((done / steps) * 90),
    ...(changed ? { next: { providerJobId: firstId, state: cur as unknown as ProviderState, cost: added } } : {}),
  };
}
