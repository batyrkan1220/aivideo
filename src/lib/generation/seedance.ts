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
    const prompt = buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : "", people, cfg.positions, objects, targetRefs);
    const plain = { videoUrl: input.templateVideoUrl, photoUrls: usedPhotos, mode: cfg.klingMode, durationSec, aspectRatio: cfg.aspectRatio, resolution };
    const providerJobId = await submitKlingOmni({ ...plain, photoUrls: [...usedPhotos, ...cutouts], prompt });
    // If Kling refuses the task because of a cut-out (it charges nothing then), the same order goes again without them.
    const fallback = cutouts.length
      ? { ...plain, prompt: buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : "", people, cfg.positions, objects) }
      : null;
    return { providerJobId, cost: seedanceCostUsd(durationSec, await seedancePricingSettings(), {}, resolution), state: { stage: "klingd", ...(fallback ? { fallback } : {}) } };
  },

  async getStatus(providerJobId, ctx) {
    const st = await getKlingTask(providerJobId);
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
