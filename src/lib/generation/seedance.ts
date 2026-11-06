import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_REFS, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { type GenerationProvider, type ProviderState } from "./types";
import { buildKlingDirectPrompt, getKlingTask, KLING_MAX_IMAGES, submitKlingOmni } from "./kling";
import { mediaUrl } from "@/lib/templates/queries";

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
    const providerJobId = await submitKlingOmni({ ...plain, photoUrls: [...usedPhotos, ...cutouts], prompt });
    // If Kling refuses the task because of a cut-out (it charges nothing then), the same order goes again without them.
    const fallback = cutouts.length
      ? { ...plain, prompt: buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, wish, people, cfg.positions, objects) }
      : null;
    return { providerJobId, cost: seedanceCostUsd(durationSec, pricing, {}, resolution), state: { stage: "klingd", ...(fallback ? { fallback } : {}) } };
  },

  async getStatus(providerJobId, ctx) {
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
