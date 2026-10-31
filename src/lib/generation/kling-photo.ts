import "server-only";
import { parsePhotoConfig, photoConfigSchema, PHOTO_MAX_PEOPLE, PHOTO_PROVIDER } from "@/lib/templates/photo-config";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { type GenerationProvider } from "./types";
import { buildKlingPhotoPrompt, getKlingImageTask, submitKlingImage } from "./kling";
import { cleanWish } from "./seedance";

/** A face slot with this provider input carries the example (reference) photo, not a person. */
const EXAMPLE_INPUT = "example";

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
    const people = input.faces.filter((f) => f.providerInput !== EXAMPLE_INPUT);
    const ownExample = input.faces.some((f) => f.providerInput === EXAMPLE_INPUT);
    if (!people.length) problems.push("missing_faces");
    if (people.length > PHOTO_MAX_PEOPLE) problems.push("too_many_faces");
    if (cfg.useExample && !ownExample && !input.templateFrameUrl) problems.push("missing_example");
    return problems;
  },

  async submit(input) {
    const cfg = parsePhotoConfig(input.config);
    const wish = cfg.allowWish ? cleanWish((input.config as { wish?: unknown }).wish) : "";
    // Create → AI photo: the customer uploads the example photo themselves (slot with providerInput "example").
    const own = input.faces.find((f) => f.providerInput === EXAMPLE_INPUT)?.imageUrl ?? null;
    const photos = input.faces.filter((f) => f.providerInput !== EXAMPLE_INPUT).map((f) => f.imageUrl).slice(0, PHOTO_MAX_PEOPLE);
    const exampleUrl = own ?? (cfg.useExample ? input.templateFrameUrl ?? null : null);
    const prompt = buildKlingPhotoPrompt({ people: photos.length, useExample: !!exampleUrl, adminPrompt: cfg.prompt, wish });
    const id = await submitKlingImage({ photoUrls: photos, exampleUrl, prompt, aspectRatio: cfg.aspectRatio });
    const s = await seedancePricingSettings();
    return { providerJobId: id, cost: s.photoCostUsd, state: { stage: "photo" } };
  },

  async getStatus(providerJobId) {
    return getKlingImageTask(providerJobId);
  },
};
