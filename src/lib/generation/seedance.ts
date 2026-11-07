import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_REFS, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ProviderError, type GenerationProvider, type ProviderState } from "./types";
import { buildKlingDirectPrompt, getKlingTask, KLING_MAX_IMAGES, submitKlingOmni } from "./kling";
import { mediaUrl } from "@/lib/templates/queries";
import { klingShotSec } from "@/lib/media/scene-plan";
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
      const passesFor = (shot: boolean): Pass[] => Array.from({ length: people }, (_, k) => {
        const last = k === people - 1;
        const where = cfg.positions[k]?.trim() || `number ${k + 1} from the left`;
        return {
          photoUrls: [usedPhotos[k], ...(last ? objectPhotos : [])],
          prompt: buildKlingDirectPrompt("edit", outfit, cfg.prompt, last ? wish : "", 1, [where], last ? objects : [], [], shot),
          who: cfg.positions[k]?.trim() || "",
          person: k,
          // The people replaced in earlier runs: their photos go along (see withKeep).
          keep: Array.from({ length: k }, (_, j) => ({ person: j, url: usedPhotos[j], where: cfg.positions[j]?.trim() || `number ${j + 1} from the left` })),
        };
      });
      const passes = passesFor(false);
      // With cuts: every shot goes through every person's run, then the shots are joined (TM-100038).
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, passesFor(true), cfg.aspectRatio, resolution, pricing, cfg.shotMap);
      if (shotRun) return shotRun;
      const providerJobId = await submitKlingOmni({ videoUrl: input.templateVideoUrl, mode: "edit", durationSec, aspectRatio: cfg.aspectRatio, resolution, ...withKeep(passes[0]) });
      console.log("[kling] person 1 of", people);
      await noteTask(input.jobId, providerJobId, `человек 1 из ${people}`);
      return {
        providerJobId,
        cost: seedanceCostUsd(durationSec, pricing, {}, resolution),
        state: { stage: "pass", k: 0, passes, durationSec, aspectRatio: cfg.aspectRatio, resolution, jobId: input.jobId },
      };
    }
    const prompt = buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects, targetRefs);
    const plain = { videoUrl: input.templateVideoUrl, photoUrls: usedPhotos, mode: cfg.klingMode, durationSec, aspectRatio: cfg.aspectRatio, resolution };
    // A template with cuts: Kling loses the face after a cut, so each shot is edited on its own (TM-100034).
    if (cfg.klingMode === "edit") {
      const shotPrompt = buildKlingDirectPrompt("edit", outfit, cfg.prompt, wish, people, cfg.positions, objects, targetRefs, true);
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, [{ photoUrls: [...usedPhotos, ...cutouts], prompt: shotPrompt, who: people === 1 ? cfg.positions[0]?.trim() ?? "" : "", person: people === 1 ? 0 : -1 }], cfg.aspectRatio, resolution, pricing, cfg.shotMap);
      if (shotRun) return shotRun;
    }
    const providerJobId = await submitKlingOmni({ ...plain, photoUrls: [...usedPhotos, ...cutouts], prompt });
    await noteTask(input.jobId, providerJobId, "видео целиком");
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
      const id = await submitKlingOmni({ videoUrl: st.outputUrl, mode: "edit", durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: run.resolution, ...withKeep(run.passes[k]) });
      console.log("[kling] person", k + 1, "of", run.passes.length);
      await noteTask(run.jobId, id, `человек ${k + 1} из ${run.passes.length}`);
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

/**
 * who: where the person is (for the look reference); person: their index (-1 = all of them in one run);
 * keep: the people replaced in earlier runs.
 */
type Pass = { photoUrls: string[]; prompt: string; who?: string; person?: number; keep?: { person: number; url: string; where: string }[] };

/**
 * A run's photos and prompt. Every run makes the whole picture again, so a person replaced in an earlier
 * run drifted away from their photo (TM-100041: the girl replaced first no longer looked like her). Their
 * photos go along as "keep this person exactly as they are". inShot: only the people seen in this shot
 * (a photo of someone who is not there could make Kling put them in).
 */
export function withKeep(pass: Pass, inShot?: number[]): { photoUrls: string[]; prompt: string } {
  const keep = (pass.keep ?? []).filter((p) => !inShot || inShot.includes(p.person)).slice(0, Math.max(0, KLING_MAX_IMAGES - pass.photoUrls.length));
  if (!keep.length) return { photoUrls: pass.photoUrls, prompt: pass.prompt };
  const notes = keep.map((p, n) => {
    const ref = `@image_${pass.photoUrls.length + n + 1}`;
    return `${ref} is the person ${p.where}, already replaced: keep that person exactly as they are now, looking 100% like ${ref} in every frame. Do not change their face, hair, skin, body or clothing, and never give them the face from @image_1.`;
  });
  return { photoUrls: [...pass.photoUrls, ...keep.map((p) => p.url)], prompt: `${pass.prompt} ${notes.join(" ")}` };
}
type PassRun = { stage: "pass"; k: number; passes: Pass[]; durationSec: number; aspectRatio: string; resolution: "720p" | "1080p"; jobId?: string };
function passOf(state: ProviderState): PassRun | null {
  const s = state as Partial<PassRun> | null;
  if (!s || s.stage !== "pass" || typeof s.k !== "number" || !Array.isArray(s.passes) || typeof s.durationSec !== "number") return null;
  const passes = s.passes.filter((p): p is Pass => !!p && Array.isArray(p.photoUrls) && typeof p.prompt === "string");
  if (!passes.length || s.k >= passes.length) return null;
  return { stage: "pass", k: s.k, passes, durationSec: s.durationSec, aspectRatio: typeof s.aspectRatio === "string" ? s.aspectRatio : "adaptive", resolution: s.resolution === "1080p" ? "1080p" : "720p", jobId: typeof s.jobId === "string" ? s.jobId : undefined };
}

// ---------------------------------------------------------------- shot by shot
/*
  A template with cuts, edited shot by shot (admin switch "По сценам"):
  - who is in each shot comes from the admin's shot map; a shot with nobody to replace is kept exactly
    as in the template, without Kling (Kling changed such shots and could put a person into them),
    and a shot runs only for the people seen in it;
  - Kling makes every task on its own, so the same person came out a little different in each shot
    (TM-100040). The shot with the most people (the longest of those) is made first; two frames of its
    result then go with every other shot as the look to copy: face, hair, skin, body, clothing.
*/

const SHOTS_BUCKET = "user-videos";
/**
 * runs = indexes into passes for the people in this shot ([] = keep the shot as it is);
 * k = position in runs; mid = the current run's input after the first run.
 */
type Shot = { path: string; url: string; len: number; frames?: number; runs?: number[]; id?: string | null; out?: string | null; k?: number; mid?: string | null };
type ShotRun = {
  stage: "shots"; shots: Shot[]; passes: Pass[]; aspectRatio: string; resolution: "720p" | "1080p"; soundUrl: string; fps?: number;
  /** The shot made first; looks = frames of its result (signed URLs), once it is done. */
  anchor?: number | null; looks?: string[] | null; jobId?: string;
};
type Pricing = Awaited<ReturnType<typeof seedancePricingSettings>>;
type ShotMap = { starts: number[]; people: number[][] } | undefined;

function shotsOf(state: ProviderState): ShotRun | null {
  const s = state as (Partial<ShotRun> & { photoUrls?: string[]; prompt?: string }) | null;
  if (!s || s.stage !== "shots" || !Array.isArray(s.shots) || !s.shots.length) return null;
  // Older state: one run with photoUrls + prompt.
  const passes = Array.isArray(s.passes) ? s.passes.filter((p): p is Pass => !!p && Array.isArray(p.photoUrls) && typeof p.prompt === "string")
    : Array.isArray(s.photoUrls) && typeof s.prompt === "string" ? [{ photoUrls: s.photoUrls, prompt: s.prompt }] : [];
  if (!passes.length) return null;
  return {
    stage: "shots", shots: s.shots as Shot[], passes, aspectRatio: typeof s.aspectRatio === "string" ? s.aspectRatio : "adaptive",
    resolution: s.resolution === "1080p" ? "1080p" : "720p", soundUrl: typeof s.soundUrl === "string" ? s.soundUrl : "", fps: typeof s.fps === "number" ? s.fps : undefined,
    anchor: typeof s.anchor === "number" ? s.anchor : null, looks: Array.isArray(s.looks) ? s.looks.filter((u): u is string => typeof u === "string") : null,
    jobId: typeof s.jobId === "string" ? s.jobId : undefined,
  };
}

/** The runs of a shot (passes to apply), by who is in it. Without a usable map: everybody, everywhere. */
export function shotRuns(passes: { person?: number }[], seen: number[] | null): number[] {
  const all = passes.map((_, i) => i);
  if (!seen) return all;
  // One run for several people (person -1): it runs when any of them is in the shot.
  return all.filter((i) => { const p = passes[i].person ?? -1; return p < 0 ? seen.length > 0 : seen.includes(p); });
}

/** The admin's map fits the shots found now when they begin at the same times (within two frames). */
export function mapFor(map: ShotMap, starts: number[]): number[][] | null {
  if (!map || map.starts.length !== starts.length || map.people.length !== starts.length) return null;
  return map.starts.every((t, i) => Math.abs(t - starts[i]) < 0.08) ? map.people : null;
}

/** Shot made first: the one with the most runs (people), the longest of those. */
export function pickAnchor(shots: { len: number; runs?: number[] }[]): number | null {
  let best = -1;
  shots.forEach((s, i) => {
    const n = s.runs?.length ?? 0;
    if (!n) return;
    const bn = best < 0 ? 0 : shots[best].runs?.length ?? 0;
    if (best < 0 || n > bn || (n === bn && s.len > shots[best].len)) best = i;
  });
  return best < 0 ? null : best;
}

/** Cuts the template and sends the first shot (or the only one); null = one shot (the caller sends the video whole). */
async function startShots(jobId: string, videoUrl: string, passes: Pass[], aspectRatio: string, resolution: "720p" | "1080p", pricing: Pricing, map?: ShotMap) {
  // Off by default: the whole video goes to Kling at once (switch in the admin template list).
  const { catalogSettings } = await import("@/lib/catalog/settings");
  if (!(await catalogSettings()).splitShots) return null;
  const cut = await prepareShots(jobId, videoUrl);
  if (!cut) return null;
  const seen = mapFor(map, cut.list.map((s) => s.start));
  const shots: Shot[] = cut.list.map(({ start: _start, ...s }, i) => {
    const runs = shotRuns(passes, seen ? seen[i] : null);
    // Nobody to replace here: the template's own shot, untouched.
    return { ...s, runs, ...(runs.length ? {} : { out: s.url }) };
  });
  const work = shots.filter((s) => !s.out).length;
  if (!work) {
    console.log("[kling] shots: nobody to replace in any shot; video sent whole");
    await supabaseAdmin().storage.from(SHOTS_BUCKET).remove(shots.map((s) => s.path)).catch(() => {});
    return null;
  }
  for (const [k, s] of shots.entries()) if (s.out) await noteTask(jobId, "", `сцена ${k + 1}: без людей, оставлена как в шаблоне (без Kling)`, true);
  const anchor = work > 1 ? pickAnchor(shots) : null;
  const run: ShotRun = { stage: "shots", shots, passes, aspectRatio, resolution, soundUrl: videoUrl, fps: cut.fps, anchor, looks: null, jobId };
  let first = "", cost = 0;
  for (const [k, s] of shots.entries()) {
    if (s.out || (anchor != null && k !== anchor)) continue;
    // The first task must go (its error goes to the worker); later ones are retried on the next poll.
    const id = first ? await submitShot(run, k).catch(() => null) : await submitShot(run, k);
    if (!id) continue;
    s.id = id;
    first ||= id;
    cost += seedanceCostUsd(klingShotSec(s.len), pricing, {}, resolution);
  }
  console.log("[kling] template in", shots.length, "shots, runs per shot:", shots.map((s) => s.runs?.length ?? 0).join(","),
    seen ? "(admin map)" : "(no map: everyone in every shot)", anchor != null ? `· shot ${anchor + 1} first` : "");
  return { providerJobId: first, cost, state: run as unknown as ProviderState };
}

async function prepareShots(jobId: string, videoUrl: string): Promise<{ list: (Shot & { start: number })[]; fps: number } | null> {
  const shots = await cutShots(jobId, videoUrl);
  // Finished without a crash: a normal retry may cut again.
  await supabaseAdmin().from("generation_jobs").update({ provider_state: null }).eq("id", jobId);
  return shots;
}

async function cutShots(jobId: string, videoUrl: string): Promise<{ list: (Shot & { start: number })[]; fps: number } | null> {
  const db = supabaseAdmin();
  // Once per job: if the server went down while cutting (out of memory), the retry sends the video whole.
  const { data: job } = await db.from("generation_jobs").select("provider_state").eq("id", jobId).maybeSingle();
  if ((job?.provider_state as { shotsTried?: boolean } | null)?.shotsTried) { console.log("[kling] shots tried before; video sent whole"); return null; }
  await db.from("generation_jobs").update({ provider_state: { shotsTried: true } }).eq("id", jobId);
  try {
    const { splitAtCuts } = await import("@/lib/media/scene-parts");
    const split = await splitAtCuts(videoUrl);
    if (!split) return null;
    const shots: (Shot & { start: number })[] = [];
    for (const [k, p] of split.parts.entries()) {
      const path = `kling-shots/${jobId}/p${k}.mp4`;
      const { error } = await db.storage.from(SHOTS_BUCKET).upload(path, p.file, { contentType: "video/mp4", upsert: true });
      const { data: signed } = error ? { data: null } : await db.storage.from(SHOTS_BUCKET).createSignedUrl(path, 48 * 3600);
      if (!signed) { console.error("[kling] shot upload failed", error?.message?.slice(0, 120)); return null; }
      shots.push({ path, url: signed.signedUrl, len: p.len, frames: p.frames, start: p.start });
    }
    return { list: shots, fps: split.fps };
  } catch (err) {
    console.error("[kling] shots skipped", err instanceof Error ? err.message.slice(0, 160) : "error");
    return null;
  }
}

/** Sends shot k's current run (the first edits the cut shot, each later run the previous result) and logs the task. */
async function submitShot(run: ShotRun, k: number): Promise<string> {
  const id = await sendShot(run, k);
  const s = run.shots[k], runs = s.runs ?? run.passes.map((_, i) => i);
  await noteTask(run.jobId, id, `сцена ${k + 1}, человек ${(run.passes[runs[s.k ?? 0]].person ?? 0) + 1}${k === run.anchor ? " (первая)" : ""}`);
  return id;
}

const sendShot = (run: ShotRun, k: number) => {
  const s = run.shots[k];
  const runs = s.runs ?? run.passes.map((_, i) => i);
  const inShot = runs.map((i) => run.passes[i].person ?? -1);
  const pass = { ...run.passes[runs[s.k ?? 0]], ...withKeep(run.passes[runs[s.k ?? 0]], inShot) };
  // The look from the first finished shot goes with every other shot, while Kling's 10 images last,
  // and only for a person who is in that first shot (else there is nothing of them to copy).
  const anchorRuns = run.anchor != null ? run.shots[run.anchor]?.runs ?? run.passes.map((_, i) => i) : [];
  const useLooks = k !== run.anchor && !!run.looks?.length && anchorRuns.includes(runs[s.k ?? 0]);
  const looks = useLooks ? run.looks!.slice(0, Math.max(0, KLING_MAX_IMAGES - pass.photoUrls.length)) : [];
  const lookRefs = looks.map((_, i) => `@image_${pass.photoUrls.length + i + 1}`);
  return submitKlingOmni({
    videoUrl: (s.k ?? 0) > 0 && s.mid ? s.mid : s.url, photoUrls: [...pass.photoUrls, ...looks], mode: "edit",
    prompt: lookRefs.length ? `${pass.prompt} ${lookNote(lookRefs, pass)}` : pass.prompt,
    durationSec: klingShotSec(s.len), aspectRatio: run.aspectRatio, resolution: run.resolution,
  });
};

/** Prompt part for the look reference: frames of another shot of this video, already made. */
export function lookNote(refs: string[], pass: { who?: string; person?: number }): string {
  const one = refs.length === 1;
  const whom = (pass.person ?? 0) < 0 ? "the replaced people" : `the replaced person${pass.who ? ` (${pass.who})` : ""}`;
  return `${refs.join(" and ")} ${one ? "is a frame" : "are frames"} from another shot of this same video, already edited. ` +
    `Make ${whom} look exactly as in ${one ? "it" : "them"}: the same face, hair, skin, body and clothing, so the person is the same in every shot. ` +
    `Take only the person's look from ${refs.join(" and ")}: not the background, pose, framing or anyone else.`;
}

async function removeShots(run: ShotRun) {
  const looks = run.jobId ? [0, 1].map((i) => `kling-shots/${run.jobId}/look${i}.jpg`) : [];
  await supabaseAdmin().storage.from(SHOTS_BUCKET).remove([...run.shots.map((s) => s.path), ...looks]).catch(() => {});
}

/** Two frames of the first finished shot (inside its real length), stored for Kling; [] if they could not be made. */
async function makeLooks(run: ShotRun, out: string, len: number): Promise<string[]> {
  try {
    const { grabFrames } = await import("@/lib/media/scene-parts");
    const frames = await grabFrames(out, [len * 0.4, len * 0.75]);
    const db = supabaseAdmin(), urls: string[] = [];
    for (const [i, f] of frames.entries()) {
      const path = `kling-shots/${run.jobId ?? "x"}/look${i}.jpg`;
      const { error } = await db.storage.from(SHOTS_BUCKET).upload(path, f, { contentType: "image/jpeg", upsert: true });
      const { data } = error ? { data: null } : await db.storage.from(SHOTS_BUCKET).createSignedUrl(path, 48 * 3600);
      if (data) urls.push(data.signedUrl);
    }
    return urls;
  } catch (err) {
    console.error("[kling] look frames failed", err instanceof Error ? err.message.slice(0, 120) : "error");
    return [];
  }
}

async function shotStatus(run: ShotRun): Promise<import("./types").ProviderJobStatus> {
  const shots = run.shots.map((s) => ({ ...s }));
  const cur: ShotRun = { ...run, shots };
  const pricing = await seedancePricingSettings();
  let added = 0, changed = false;
  const fail = async (err: unknown): Promise<import("./types").ProviderJobStatus> => {
    await removeShots(run);
    return { state: "failed", errorCode: err instanceof ProviderError ? err.code : "provider_failed", retryable: false };
  };
  // 1. Poll every running task; move a shot to its next person or mark it done.
  for (const [k, s] of shots.entries()) {
    if (s.out || !s.id) continue;
    const runs = s.runs ?? run.passes.map((_, i) => i);
    const st = await getKlingTask(s.id);
    if (st.state === "failed") { await removeShots(run); return st; }
    if (st.state !== "succeeded") continue;
    changed = true;
    const next = (s.k ?? 0) + 1;
    if (next < runs.length) {
      // Next person in this shot, on the result so far.
      s.k = next; s.mid = st.outputUrl; s.id = null;
      console.log("[kling] shot", k + 1, "person", next + 1, "of", runs.length);
      continue;
    }
    s.out = st.outputUrl;
    if (k === cur.anchor) {
      // First shot done: its look goes with all the others.
      cur.looks = await makeLooks(cur, st.outputUrl, s.len);
      console.log("[kling] shot", k + 1, "done first;", cur.looks.length, "look frames for the other shots");
    }
  }
  // 2. Send what is waiting: every shot once the first one is done (before that only the first one).
  const anchorDone = cur.anchor == null || !!shots[cur.anchor].out;
  for (const [k, s] of shots.entries()) {
    if (s.out || s.id || (!anchorDone && k !== cur.anchor)) continue;
    try {
      s.id = await submitShot(cur, k);
      added += seedanceCostUsd(klingShotSec(s.len), pricing, {}, run.resolution);
      changed = true;
    } catch (err) {
      if (err instanceof ProviderError && err.retryable) continue; // busy: next poll
      return fail(err);
    }
  }
  const firstId = shots.find((s) => s.id)?.id ?? "";
  if (shots.every((s) => s.out)) {
    const { joinParts } = await import("@/lib/media/scene-parts");
    const bytes = await joinParts(shots.map((s) => s.out!), shots.map((s) => s.len), run.soundUrl, run.fps ?? 30, shots.map((s) => s.frames));
    await removeShots(run);
    console.log("[kling] shots joined", shots.length, "· kept as in the template:", shots.filter((s) => s.out === s.url).length);
    return { state: "succeeded", outputUrl: shots.find((s) => s.out !== s.url)?.out ?? shots[0].out!, outputBytes: bytes };
  }
  const steps = shots.reduce((n, s) => n + (s.runs ?? run.passes).length, 0) || 1;
  const done = shots.reduce((n, s) => n + (s.out ? (s.runs ?? run.passes).length : (s.k ?? 0)), 0);
  return {
    state: "processing",
    progress: Math.round((done / steps) * 90),
    ...(changed ? { next: { providerJobId: firstId, state: cur as unknown as ProviderState, cost: added } } : {}),
  };
}

/** Writes a Kling task id into the order's log, so support can watch every run's result (admin order page). */
async function noteTask(jobId: string | undefined, task: string, step: string, info = false) {
  if (!jobId || (!task && !info)) return;
  try {
    const db = supabaseAdmin();
    const { data: job } = await db.from("generation_jobs").select("order_id").eq("id", jobId).maybeSingle();
    if (job?.order_id) await db.from("audit_logs").insert({ actor_id: null, action: "generation.kling_task", resource_type: "order", resource_id: job.order_id, metadata_json: { task, step } });
  } catch { /* the log is only a help */ }
}
