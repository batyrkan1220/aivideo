import "server-only";
import { seedanceConfigSchema, SEEDANCE_MAX_PEOPLE, SEEDANCE_MAX_SEC, SEEDANCE_MIN_SEC } from "@/lib/templates/seedance-config";
import { seedanceCostUsd } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { type GenerationProvider } from "./types";
import { buildKlingDirectPrompt, getKlingTask, submitKlingOmni } from "./kling";

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
      maxFaces: SEEDANCE_MAX_PEOPLE,
      qualities: ["720p"],
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
    if (input.faces.length > SEEDANCE_MAX_PEOPLE) problems.push("too_many_faces");
    const idx = input.faces.map((f) => imgIndex(f.providerInput));
    if (idx.some((x, i) => x !== i + 1)) problems.push("unmapped_slot");
    const d = Number((input.config as { durationSec?: unknown }).durationSec);
    if (!(d > 0)) problems.push("unknown_duration");
    else if (d < SEEDANCE_MIN_SEC - 0.5 || d > SEEDANCE_MAX_SEC + 0.5) problems.push("bad_duration");
    return problems;
  },

  async submit(input) {
    const cfg = seedanceConfigSchema.parse(input.config ?? {});
    const extra = input.config as { durationSec?: number; wish?: unknown };
    const durationSec = Number(extra.durationSec);
    const photos = input.faces.map((f) => f.imageUrl).slice(0, SEEDANCE_MAX_PEOPLE);
    const prompt = buildKlingDirectPrompt(cfg.klingMode, cfg.outfit, cfg.prompt, cfg.allowWish ? cleanWish(extra.wish) : "", photos.length, cfg.positions);
    const id = await submitKlingOmni({ videoUrl: input.templateVideoUrl, photoUrls: photos, mode: cfg.klingMode, prompt, durationSec, aspectRatio: cfg.aspectRatio });
    return { providerJobId: id, cost: seedanceCostUsd(durationSec, await seedancePricingSettings()), state: { stage: "klingd" } };
  },

  async getStatus(providerJobId) {
    return getKlingTask(providerJobId);
  },
};
