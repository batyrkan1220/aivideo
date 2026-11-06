import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_OBJECTS, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_REFS, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { type GenerationProvider, type ProviderState } from "./types";
import { buildKlingDirectPrompt, createKlingElement, getKlingElement, getKlingTask, klingElementTag, submitKlingOmni } from "./kling";

/**
 * The video provider (key "seedance" for existing rows): Kling 4.0 via Kling's official API.
 * The template video is edited — the people in it are replaced by the customer's photos — or,
 * in "reference" mode, a new video follows its motion. 720p, 9:16 by default.
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
    // The element sent to the video is created from the client photo. How many people is the number set on the template.
    // Only photos that were actually uploaded count, so a car slot is never sent as a person.
    const declaredPeople = Math.min(SEEDANCE_MAX_PEOPLE, Math.max(1, cfg.people));
    const objects = cfg.objects.slice(0, Math.min(SEEDANCE_MAX_OBJECTS, Math.max(0, photos.length - declaredPeople)));
    const people = Math.min(declaredPeople, Math.max(1, photos.length - objects.length));
    const prompt = buildKlingDirectPrompt(cfg.klingMode, outfit, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : "", people, cfg.positions, objects);
    const resolution = input.quality === "1080p" ? "1080p" : "720p";
    // Each uploaded photo becomes its own element, in order: people (o_102), then things (animal, prop, clothing).
    const usedPhotos = photos.slice(0, people + objects.length);
    const tags = [...Array.from({ length: people }, () => "o_102"), ...objects.map((o) => klingElementTag(o.what))];
    const elementTaskId = await createKlingElement(usedPhotos[0], tags[0] ?? "o_102", personNote(tags[0], 0, people));
    const state: ProviderState = {
      stage: "element", videoUrl: input.templateVideoUrl, photoUrls: usedPhotos, people, tags,
      elementIds: [], prompt, durationSec, aspectRatio: cfg.aspectRatio, resolution, mode: cfg.klingMode,
    };
    return { providerJobId: elementTaskId, cost: seedanceCostUsd(durationSec, await seedancePricingSettings(), {}, resolution), state };
  },

  async getStatus(providerJobId, ctx) {
    const lock = faceLockState(ctx.state);
    if (!lock) return getKlingTask(providerJobId);
    const el = await getKlingElement(providerJobId);
    if (el.state === "processing") return { state: "processing" };
    if (el.state === "failed") return { state: "failed", errorCode: el.errorCode, retryable: false };
    const elementIds = [...lock.elementIds, el.elementId];
    const total = lock.tags?.length ? Math.min(lock.tags.length, lock.photoUrls.length) : lock.people;
    if (elementIds.length < total) {
      const nextPhoto = lock.photoUrls[elementIds.length];
      if (typeof nextPhoto !== "string" || !nextPhoto) return { state: "failed", errorCode: "missing_inputs", retryable: false };
      const nextTag = lock.tags?.[elementIds.length] ?? "o_102";
      const taskId = await createKlingElement(nextPhoto, nextTag, personNote(nextTag, elementIds.length, lock.people));
      return { state: "processing", next: { providerJobId: taskId, state: { ...lock, elementIds } as ProviderState } };
    }
    const id = await submitKlingOmni({
      videoUrl: lock.videoUrl, elementIds,
      mode: lock.mode === "reference" ? "reference" : "edit",
      prompt: lock.prompt, durationSec: lock.durationSec, aspectRatio: lock.aspectRatio, resolution: lock.resolution,
    });
    return { state: "processing", next: { providerJobId: id, state: { stage: "klingd" } } };
  },
};

type FaceLockState = {
  stage: "element" | "klingd";
  videoUrl: string;
  photoUrls: string[];
  people: number;
  /** Official tag id per photo, same order as photoUrls. Missing on jobs started before things were elements. */
  tags?: string[];
  elementIds: string[];
  prompt: string;
  durationSec: number;
  aspectRatio: string;
  resolution: "720p" | "1080p";
  mode?: "edit" | "reference";
};

/** Two people must stay two identities. The note is only for a character element. */
function personNote(tag: string | undefined, index: number, people: number): string | undefined {
  return tag === "o_102" && people > 1 ? `Person ${index + 1} of ${people}.` : undefined;
}

function faceLockState(s: ProviderState): FaceLockState | null {
  if (!s || String(s.stage) !== "element" || !Array.isArray(s.photoUrls) || typeof s.videoUrl !== "string" || typeof s.prompt !== "string") return null;
  if (!Array.isArray(s.elementIds) || typeof s.people !== "number" || typeof s.durationSec !== "number" || typeof s.aspectRatio !== "string") return null;
  if (s.resolution !== "720p" && s.resolution !== "1080p") return null;
  return s as FaceLockState;
}
