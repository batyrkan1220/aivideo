import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_REFS, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { ProviderError, type GenerationProvider, type ProviderJobStatus, type ProviderState, type SubmitInput } from "./types";
import { buildKlingDirectPrompt, findBy, getKlingTask, KLING_MAX_IMAGES, submitKlingOmni } from "./kling";
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
    const byKey = new Map(input.faces.map((f) => [f.slotKey, f.imageUrl]));
    // People first (img_1…img_n), then the things to swap (car, horse, outfit…).
    // How many people is the number set on the template.
    // Only photos that were actually uploaded count, so a car slot is never sent as a person.
    // 0 people: a template where only things are replaced (a car…); every photo is a thing.
    const declaredPeople = Math.min(SEEDANCE_MAX_PEOPLE, Math.max(0, cfg.people));
    // Photos of each thing, by slot (obj_1, obj_1_2, obj_1_3…): a car from the front, side, back.
    const groups = cfg.objects.slice(0, SEEDANCE_MAX_OBJECTS).map((_, j) =>
      [`obj_${j + 1}`, `obj_${j + 1}_2`, `obj_${j + 1}_3`].map((k) => byKey.get(k)).filter((u): u is string => !!u));
    const keyed = groups.some((g) => g.length);
    const personKeyed = Array.from({ length: declaredPeople }, (_, i) => byKey.get(`face_${i + 1}`)).filter((u): u is string => !!u);
    const objects = keyed
      ? cfg.objects.slice(0, SEEDANCE_MAX_OBJECTS).filter((_, j) => groups[j].length).map((o, j) => ({ ...o, n: groups.filter((g) => g.length)[j].length }))
      : cfg.objects.slice(0, Math.min(SEEDANCE_MAX_OBJECTS, Math.max(0, photos.length - declaredPeople))).map((o) => ({ ...o, n: 1 }));
    const people = declaredPeople === 0 ? 0
      : keyed && personKeyed.length ? personKeyed.length
      : Math.min(declaredPeople, Math.max(1, photos.length - objects.length));
    if (people === 0 && !objects.length) throw new ProviderError("provider_bad_params", false, "nothing to replace");
    const resolution: "720p" | "1080p" = input.quality === "1080p" ? "1080p" : "720p";
    // Photos go straight to the video call as reference images, people first, then every photo of each thing.
    const usedPhotos = keyed
      ? [...(personKeyed.length ? personKeyed : photos.slice(0, people)), ...groups.flat()].slice(0, SEEDANCE_MAX_REFS)
      : photos.slice(0, people + objects.length);
    // Step 1: a Character Sheet of each person (Kling image), then the video (getStatus sends it).
    if (people > 0 && !input.sheets) {
      const started = await startSheets(input, usedPhotos.slice(0, people));
      if (started) return started;
    }
    const sheetUrls = Array.from({ length: people }, (_, k) => input.sheets?.[k] ?? null);
    const sheetOnly = outfit === "template";
    // Optional cut-outs from the template, after the customer's photos, while Kling's 10 images last.
    const cutouts: string[] = [];
    // Person cut-outs are not sent: with them Kling mixed up or kept people (TM-100024, TM-100026).
    // Only things (car, horse…) get their cut-out, so Kling knows which one to swap.
    const targetPaths = [...Array.from({ length: people }, () => ""), ...objects.map((o) => o.target ?? "")];
    const targetRefs = targetPaths.map((path) => {
      // Off: the cut-out shows the ORIGINAL thing, and Kling mixed it into the new one (TM-100051: another
      // car model came out), as it did with people. The customer still sees it on the order form.
      const url = SEND_CUTOUTS && cfg.showTargets ? mediaUrl(path?.trim() || null) : null;
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
        // A place shared with someone replaced before ("on the right" twice, TM-100042: the woman was
        // never replaced) or no place at all: name this one as the person not replaced yet.
        const mine = findBy(cfg.positions[k]).toLowerCase();
        const place = (t: string) => findBy(t).toLowerCase().split(",")[0].trim();
        const clash = !mine || Array.from({ length: k }, (_, j) => findBy(cfg.positions[j]).toLowerCase())
          .some((o) => o === mine || (!mine.includes(",") && place(o) === mine));
        const where = clash
          ? `who has not been replaced yet${mine ? ` (${mine})` : ""} — not the person already replaced in an earlier step`
          : cfg.positions[k]?.trim() || `number ${k + 1} from the left`;
        return {
          ...withSheets({
            photoUrls: [usedPhotos[k], ...(last ? objectPhotos : [])],
            prompt: buildKlingDirectPrompt("edit", outfit, cfg.prompt, last ? wish : "", 1, [where], last ? objects : [], [], shot),
          }, [{ url: sheetUrls[k], of: "@image_1" }], sheetOnly),
          who: cfg.positions[k]?.trim() || "",
          person: k,
          // The people replaced in earlier runs: their photos go along (see withKeep).
          keep: Array.from({ length: k }, (_, j) => ({ person: j, url: usedPhotos[j], where: findBy(cfg.positions[j]) || `number ${j + 1} from the left` })),
        };
      });
      const passes = passesFor(false);
      // With cuts: every shot goes through every person's run, then the shots are joined (TM-100038).
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, passesFor(true), cfg.aspectRatio, resolution, pricing, cfg.shotMap);
      if (shotRun) return shotRun;
      // Two people at different places, nothing else to swap: each is replaced in their own run on the
      // clean template, at the same time, and the two results are put together (see merge-people). A second
      // run on Kling's own result smeared or kept the second person (TM-100058, TM-100062).
      // Only when their places differ ("on the right" twice: who is who comes only from the order of runs).
      const places = cfg.positions.slice(0, people).map((t) => findBy(t).toLowerCase().split(",")[0].trim());
      if (people === 2 && !objects.length && places.every(Boolean) && places[0] !== places[1]) {
        const split: Pass[] = [0, 1].map((k) => ({
          ...withSheets({
            photoUrls: [usedPhotos[k]],
            prompt: buildKlingDirectPrompt("edit", outfit, cfg.prompt, k === 0 ? wish : "", 1, [cfg.positions[k].trim()], [], [], false),
          }, [{ url: sheetUrls[k], of: "@image_1" }], sheetOnly),
          who: cfg.positions[k].trim(), person: k,
        }));
        // Admin "make only the other person again": that person's finished run is taken as it is.
        const reuse = (input.config as { reuse?: { person?: unknown; task?: unknown } }).reuse;
        const kept = reuse && (reuse.person === 0 || reuse.person === 1) && typeof reuse.task === "string" && /^[\w-]{1,80}$/.test(reuse.task)
          ? { person: reuse.person, task: reuse.task } : null;
        const ids: (string | null)[] = [];
        for (const [k, p] of split.entries()) {
          if (kept?.person === k) { ids.push(kept.task); await noteTask(input.jobId, kept.task, `человек ${k + 1} из 2 — готовый, без изменений`); continue; }
          const id = await submitKlingOmni({ videoUrl: input.templateVideoUrl, mode: "edit", durationSec, aspectRatio: cfg.aspectRatio, resolution, ...p })
            .catch((err) => { if (k > 0 && err instanceof ProviderError && err.retryable) return null; throw err; });
          if (id) await noteTask(input.jobId, id, `человек ${k + 1} из 2 (параллельно)`);
          ids.push(id);
        }
        console.log("[kling] 2 people in parallel", ids.filter(Boolean).length, "sent");
        const run: SplitRun = { stage: "split", ids, outs: [null, null], passes: split, template: input.templateVideoUrl, durationSec, aspectRatio: cfg.aspectRatio, resolution, jobId: input.jobId };
        const sent = ids.filter((x, k) => x && kept?.person !== k).length;
        return { providerJobId: ids.find(Boolean) ?? "", cost: seedanceCostUsd(durationSec, pricing, {}, resolution) * sent, state: run as unknown as ProviderState };
      }
      // Each later run edits the previous result. At 720p the next person was drawn on an already
      // compressed copy and came out smeared ("1-ші адам таза, 2-ші шайылып қалады"): runs before the last
      // one are made at 1080p, so the next run starts from a full-quality picture.
      const midRes = (k: number): "720p" | "1080p" => (k < people - 1 ? "1080p" : resolution);
      const providerJobId = await submitKlingOmni({ videoUrl: input.templateVideoUrl, mode: "edit", durationSec, aspectRatio: cfg.aspectRatio, resolution: midRes(0), ...withKeep(passes[0]) });
      console.log("[kling] person 1 of", people);
      await noteTask(input.jobId, providerJobId, `человек 1 из ${people}`);
      return {
        providerJobId,
        cost: seedanceCostUsd(durationSec, pricing, {}, midRes(0)),
        state: { stage: "pass", k: 0, passes, durationSec, aspectRatio: cfg.aspectRatio, resolution, jobId: input.jobId },
      };
    }
    // Person k is @image_{k+1} (people come first); their sheet goes after every other photo.
    const sheetList = sheetUrls.map((url, k) => ({ url, of: `@image_${k + 1}` }));
    const sheeted = (photoUrls: string[], p: string) => withSheets({ photoUrls, prompt: p }, sheetList, sheetOnly);
    const prompt = buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects, targetRefs);
    const plain = { videoUrl: input.templateVideoUrl, photoUrls: usedPhotos, mode: cfg.klingMode, durationSec, aspectRatio: cfg.aspectRatio, resolution };
    // A template with cuts: Kling loses the face after a cut, so each shot is edited on its own (TM-100034).
    if (cfg.klingMode === "edit") {
      const shotPrompt = buildKlingDirectPrompt("edit", outfit, cfg.prompt, wish, people, cfg.positions, objects, targetRefs, true);
      const shotRun = await startShots(input.jobId, input.templateVideoUrl, [{ ...sheeted([...usedPhotos, ...cutouts], shotPrompt), who: people === 1 ? cfg.positions[0]?.trim() ?? "" : "", person: people === 1 ? 0 : -1 }], cfg.aspectRatio, resolution, pricing, cfg.shotMap);
      if (shotRun) return shotRun;
    }
    const providerJobId = await submitKlingOmni({ ...plain, ...sheeted([...usedPhotos, ...cutouts], prompt) });
    await noteTask(input.jobId, providerJobId, "видео целиком");
    // If Kling refuses the task because of a cut-out (it charges nothing then), the same order goes again without them.
    const fallback = cutouts.length
      ? { ...plain, ...sheeted(usedPhotos, buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects)) }
      : null;
    return { providerJobId, cost: seedanceCostUsd(durationSec, pricing, {}, resolution), state: { stage: "klingd", ...(fallback ? { fallback } : {}) } };
  },

  async getStatus(providerJobId, ctx) {
    const sheetRun = sheetsOf(ctx.state);
    if (sheetRun) return sheetStatus(providerJobId, sheetRun);
    const splitRun = splitOf(ctx.state);
    if (splitRun) return splitStatus(splitRun);
    const shotRun = shotsOf(ctx.state);
    if (shotRun) return shotStatus(shotRun);
    const st = await getKlingTask(providerJobId);
    const run = passOf(ctx.state);
    if (run) {
      // One person per run: the next run edits the previous result.
      if (st.state !== "succeeded" || run.k + 1 >= run.passes.length) return st;
      const k = run.k + 1;
      const res = k < run.passes.length - 1 ? "1080p" : run.resolution;
      const id = await submitKlingOmni({ videoUrl: st.outputUrl, mode: "edit", durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: res, ...withKeep(run.passes[k]) });
      console.log("[kling] person", k + 1, "of", run.passes.length);
      await noteTask(run.jobId, id, `человек ${k + 1} из ${run.passes.length}`);
      return {
        state: "processing",
        next: { providerJobId: id, state: { ...run, k } as ProviderState, cost: seedanceCostUsd(run.durationSec, await seedancePricingSettings(), {}, res) },
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
    return `${ref} is the person ${p.where}, already replaced: keep that person exactly as they are now, looking 100% like ${ref} in every frame. Do not change their face, hair, skin, body or clothing, and never give them the face from @image_1. ` +
      `${ref} is NOT the person to replace in this edit: never use ${ref} for anyone else.`;
  });
  // TM-100058: the person replaced in the later run came out mixed with the earlier one's photo. Who is who,
  // said once more at the end, where Kling weighs it most.
  const others = keep.map((_, n) => `@image_${pass.photoUrls.length + n + 1}`).join(", ");
  const only = `In this edit replace only one person${pass.who ? `, the one ${findBy(pass.who) || pass.who}` : ""}: they must look 100% like @image_1 and nobody else. ` +
    `@image_1 and ${others} are different people — do not blend, average or mix their faces; the face of the person you replace comes only from @image_1.`;
  return { photoUrls: [...pass.photoUrls, ...keep.map((p) => p.url)], prompt: `${pass.prompt} ${notes.join(" ")} ${only}` };
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
/** Cut-outs of the template's own thing to Kling: off (see the provider). */
const SEND_CUTOUTS = false;
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
    // A run that another run in this shot will edit is made at 1080p (see midRes in submit).
    durationSec: klingShotSec(s.len), aspectRatio: run.aspectRatio, resolution: (s.k ?? 0) < runs.length - 1 ? "1080p" : run.resolution,
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

// ---------------------------------------------------------------- Character Sheet
/*
  Before the video, Kling's image model draws a Character Sheet of each person from their photo: the same
  person from the front, three-quarter, side and close-up. The sheet then goes to the video call after the
  photo, so the face holds when the head turns. It is kept with the customer's photos (private bucket,
  sheets/<order>/…, removed with them) and shown to support on the admin order page.
  A sheet that fails or takes too long is skipped: the video goes with the photo alone.
*/

const SHEET_BUCKET = "user-uploads";
const SHEET_WAIT_MS = 6 * 60_000;
type SheetTask = { person: number; id: string | null; path?: string | null; url?: string | null; done?: boolean };
type SheetRun = { stage: "sheet"; tasks: SheetTask[]; input: SubmitInput; at: number; orderId: string | null };

function sheetsOf(state: ProviderState): SheetRun | null {
  const s = state as Partial<SheetRun> | null;
  if (!s || s.stage !== "sheet" || !Array.isArray(s.tasks) || !s.input || typeof s.input !== "object") return null;
  return { stage: "sheet", tasks: s.tasks as SheetTask[], input: s.input as SubmitInput, at: typeof s.at === "number" ? s.at : Date.now(), orderId: typeof s.orderId === "string" ? s.orderId : null };
}

/** A sheet image after the run's other photos, while Kling's 10 images last, with a note on how to use it. */
export function withSheets(base: { photoUrls: string[]; prompt: string }, list: { url: string | null | undefined; of: string }[], faceOnly = false): { photoUrls: string[]; prompt: string } {
  const photoUrls = [...base.photoUrls];
  const notes: string[] = [];
  for (const s of list) {
    if (!s.url || photoUrls.length >= KLING_MAX_IMAGES) continue;
    photoUrls.push(s.url);
    const ref = `@image_${photoUrls.length}`;
    notes.push(`${ref} is a character reference sheet of the person in ${s.of}: the same person seen from several angles. ` +
      `Use ${ref} only to keep that person's ${faceOnly ? "face, hair and skin" : "face, hair, skin and look"} accurate from every angle${faceOnly ? " (not their clothing)" : ""}. ` +
      `Never show the sheet itself, its grey background, its layout or several copies of the person in the video.`);
  }
  return notes.length ? { photoUrls, prompt: `${base.prompt} ${notes.join(" ")}` } : base;
}

/** Sends one sheet task per person; null = off, or not one could be sent (the video goes straight away). */
async function startSheets(input: SubmitInput, personPhotos: string[]) {
  const { catalogSettings } = await import("@/lib/catalog/settings");
  if (!(await catalogSettings()).characterSheet) return null;
  const { submitSheet } = await import("./sheet-settings");
  const tasks: SheetTask[] = [];
  for (const [person, url] of personPhotos.entries()) {
    const id = await submitSheet(url)
      .catch((err) => { console.error("[kling] sheet not sent", err instanceof ProviderError ? err.code : "error"); return null; });
    tasks.push({ person, id });
  }
  const first = tasks.find((t) => t.id)?.id;
  if (!first) return null;
  const { data: job } = await supabaseAdmin().from("generation_jobs").select("order_id").eq("id", input.jobId).maybeSingle();
  for (const t of tasks) if (t.id) await noteTask(input.jobId, t.id, `Character Sheet, человек ${t.person + 1}`);
  console.log("[kling] character sheets", tasks.filter((t) => t.id).length, "of", personPhotos.length);
  const { photoCostUsd } = await seedancePricingSettings();
  const run: SheetRun = { stage: "sheet", tasks, input: { ...input, sheets: undefined }, at: Date.now(), orderId: (job?.order_id as string | undefined) ?? null };
  return { providerJobId: first, cost: photoCostUsd * tasks.filter((t) => t.id).length, state: run as unknown as ProviderState };
}

/** Polls the sheets; once all are done (or the wait is over) stores them and sends the video. */
async function sheetStatus(providerJobId: string, run: SheetRun): Promise<ProviderJobStatus> {
  const tasks = run.tasks.map((t) => ({ ...t }));
  const late = Date.now() - run.at > SHEET_WAIT_MS;
  let waiting = false;
  for (const t of tasks) {
    if (!t.id || t.done) continue;
    const { sheetTask } = await import("./sheet-settings");
    const st = await sheetTask(t.id).catch(() => ({ state: "processing" as const }));
    if (st.state === "succeeded") {
      t.done = true;
      const saved = await saveSheet(run, t, st.outputUrl);
      t.path = saved?.path ?? null; t.url = saved?.url ?? null;
      await logSheet(run.orderId, t, saved ? "ok" : "not_saved");
    } else if (st.state === "failed") {
      t.done = true;
      await logSheet(run.orderId, t, st.errorCode);
    } else if (late) {
      t.done = true;
      await logSheet(run.orderId, t, "timeout");
    } else waiting = true;
  }
  const cur: SheetRun = { ...run, tasks };
  if (waiting) {
    const changed = tasks.some((t, i) => t.done !== run.tasks[i].done);
    return { state: "processing", progress: 5, ...(changed ? { next: { providerJobId, state: cur as unknown as ProviderState } } : {}) };
  }
  const sheets = Array.from({ length: Math.max(0, ...tasks.map((t) => t.person + 1)) }, (_, k) => tasks.find((t) => t.person === k)?.url ?? null);
  console.log("[kling] character sheets ready:", sheets.filter(Boolean).length, "of", tasks.length, "· sending the video");
  try {
    const r = await seedanceProvider.submit({ ...run.input, sheets });
    return { state: "processing", next: { providerJobId: r.providerJobId, state: r.state ?? null, cost: r.cost } };
  } catch (err) {
    // Busy: try the video again on the next poll, with the sheets already stored.
    if (err instanceof ProviderError && err.retryable) return { state: "processing", next: { providerJobId, state: cur as unknown as ProviderState } };
    return { state: "failed", errorCode: err instanceof ProviderError ? err.code : "provider_failed", retryable: false };
  }
}

/** Copies Kling's sheet into the private bucket; a signed link (2 days) for the video call. */
async function saveSheet(run: SheetRun, t: SheetTask, url: string): Promise<{ path: string; url: string } | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !/^image\//.test(type)) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (!bytes.length || bytes.length > 20 * 1024 * 1024) return null;
    const ext = /png/.test(type) ? "png" : /webp/.test(type) ? "webp" : "jpg";
    const path = `sheets/${run.orderId ?? run.input.jobId}/${t.person + 1}-${Date.now()}.${ext}`;
    const db = supabaseAdmin();
    const { error } = await db.storage.from(SHEET_BUCKET).upload(path, bytes, { contentType: type, upsert: true });
    if (error) return null;
    const { data } = await db.storage.from(SHEET_BUCKET).createSignedUrl(path, 48 * 3600);
    return data ? { path, url: data.signedUrl } : null;
  } catch (err) {
    console.error("[kling] sheet not saved", err instanceof Error ? err.message.slice(0, 120) : "error");
    return null;
  }
}

/** The order's log: which sheet was made (its file, for the admin order page) or why there is none. */
async function logSheet(orderId: string | null, t: SheetTask, result: string) {
  if (!orderId) return;
  try {
    await supabaseAdmin().from("audit_logs").insert({ actor_id: null, action: "generation.character_sheet", resource_type: "order", resource_id: orderId,
      metadata_json: { person: t.person + 1, task: t.id, path: t.path ?? null, result } });
  } catch { /* the log is only a help */ }
}

// ---------------------------------------------------------------- two people in parallel
type SplitRun = {
  stage: "split"; ids: (string | null)[]; outs: (string | null)[]; passes: Pass[]; template: string;
  durationSec: number; aspectRatio: string; resolution: "720p" | "1080p"; jobId?: string;
};

function splitOf(state: ProviderState): SplitRun | null {
  const s = state as Partial<SplitRun> | null;
  if (!s || s.stage !== "split" || !Array.isArray(s.ids) || !Array.isArray(s.passes) || s.passes.length !== 2 || typeof s.template !== "string" || typeof s.durationSec !== "number") return null;
  return {
    stage: "split", ids: s.ids.map((x) => (typeof x === "string" ? x : null)), outs: (Array.isArray(s.outs) ? s.outs : [null, null]).map((x) => (typeof x === "string" ? x : null)),
    passes: s.passes as Pass[], template: s.template, durationSec: s.durationSec, aspectRatio: typeof s.aspectRatio === "string" ? s.aspectRatio : "adaptive",
    resolution: s.resolution === "1080p" ? "1080p" : "720p", jobId: typeof s.jobId === "string" ? s.jobId : undefined,
  };
}

/** Both runs done → the results are put together; a run not sent yet (Kling busy) is sent now. */
async function splitStatus(run: SplitRun): Promise<ProviderJobStatus> {
  const cur: SplitRun = { ...run, ids: [...run.ids], outs: [...run.outs] };
  let changed = false, added = 0;
  for (const k of [0, 1]) {
    if (cur.outs[k]) continue;
    if (!cur.ids[k]) {
      try {
        cur.ids[k] = await submitKlingOmni({ videoUrl: run.template, mode: "edit", durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: run.resolution, photoUrls: run.passes[k].photoUrls, prompt: run.passes[k].prompt });
        await noteTask(run.jobId, cur.ids[k]!, `человек ${k + 1} из 2 (параллельно)`);
        added += seedanceCostUsd(run.durationSec, await seedancePricingSettings(), {}, run.resolution);
        changed = true;
      } catch (err) {
        if (err instanceof ProviderError && err.retryable) continue;
        return { state: "failed", errorCode: err instanceof ProviderError ? err.code : "provider_failed", retryable: false };
      }
      continue;
    }
    const st = await getKlingTask(cur.ids[k]!);
    if (st.state === "failed") return st;
    if (st.state === "succeeded") { cur.outs[k] = st.outputUrl; changed = true; }
  }
  if (cur.outs[0] && cur.outs[1]) {
    try {
      const { mergeEdits } = await import("@/lib/media/merge-people");
      const bytes = await mergeEdits(cur.outs[0], cur.outs[1], run.template);
      console.log("[kling] 2 people merged", Math.round(bytes.length / 1024), "KB");
      await noteTask(run.jobId, "", "2 человека: результаты объединены", true);
      return { state: "succeeded", outputUrl: cur.outs[0], outputBytes: bytes };
    } catch (err) {
      // Could not put them together: the second person goes on the first result, as before.
      console.error("[kling] merge failed, second person on the first result", err instanceof Error ? err.message.slice(0, 160) : "error");
      const keep = [{ person: 0, url: run.passes[0].photoUrls[0], where: findBy(run.passes[0].who ?? "") || "number 1 from the left" }];
      const pass: Pass = { ...run.passes[1], keep };
      const id = await submitKlingOmni({ videoUrl: cur.outs[0], mode: "edit", durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: run.resolution, ...withKeep(pass) });
      await noteTask(run.jobId, id, "человек 2 из 2 (на результате 1)");
      const passRun: PassRun = { stage: "pass", k: 1, passes: [run.passes[0], pass], durationSec: run.durationSec, aspectRatio: run.aspectRatio, resolution: run.resolution, jobId: run.jobId };
      return { state: "processing", next: { providerJobId: id, state: passRun as unknown as ProviderState, cost: seedanceCostUsd(run.durationSec, await seedancePricingSettings(), {}, run.resolution) } };
    }
  }
  const firstId = cur.ids.find((x) => x) ?? "";
  const done = cur.outs.filter(Boolean).length;
  return { state: "processing", progress: 20 + done * 35, ...(changed ? { next: { providerJobId: firstId, state: cur as unknown as ProviderState, cost: added } } : {}) };
}
