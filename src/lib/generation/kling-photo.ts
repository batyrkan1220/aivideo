import "server-only";
import { parsePhotoConfig, photoConfigSchema, PHOTO_MAX_PEOPLE, PHOTO_PROVIDER } from "@/lib/templates/photo-config";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { type GenerationProvider } from "./types";
import { buildKlingPhotoPrompt, getKlingImageTask, submitKlingImage } from "./kling";
import { cleanWish } from "./seedance";

/** Photo templates: Kling's image model makes a new photo with the customer's face. */
export const klingPhotoProvider: GenerationProvider = {
  key: PHOTO_PROVIDER,

  capabilities() {
    return {
      videoFaceSwap: false, maxFaces: PHOTO_MAX_PEOPLE, qualities: ["2k"], supportsCancel: false,
      reportsProgress: false, reportsCost: true, producesRealVideo: false,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    if (!photoConfigSchema.safeParse(input.config ?? {}).success) return ["invalid_provider_config"];
    const cfg = parsePhotoConfig(input.config);
    if (!input.faces.length) problems.push("missing_faces");
    if (input.faces.length > PHOTO_MAX_PEOPLE) problems.push("too_many_faces");
    if (cfg.useExample && !input.templateFrameUrl) problems.push("missing_example");
    return problems;
  },

  async submit(input) {
    const cfg = parsePhotoConfig(input.config);
    const wish = cfg.allowWish ? cleanWish((input.config as { wish?: unknown }).wish) : "";
    const photos = input.faces.map((f) => f.imageUrl).slice(0, PHOTO_MAX_PEOPLE);
    const prompt = buildKlingPhotoPrompt({ people: photos.length, useExample: cfg.useExample, adminPrompt: cfg.prompt, wish });
    const id = await submitKlingImage({ photoUrls: photos, exampleUrl: cfg.useExample ? input.templateFrameUrl ?? null : null, prompt, aspectRatio: cfg.aspectRatio });
    const s = await seedancePricingSettings();
    return { providerJobId: id, cost: s.photoCostUsd, state: { stage: "photo" } };
  },

  async getStatus(providerJobId) {
    return getKlingImageTask(providerJobId);
  },
};
