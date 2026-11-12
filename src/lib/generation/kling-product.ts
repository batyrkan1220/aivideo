import "server-only";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { qualityCostFactor } from "@/lib/pricing-seedance";
import { buildProductPrompt, sceneFor, PRODUCT_SCENES } from "@/lib/product-video/scenes";
import { type GenerationProvider } from "./types";
import { getKlingTask, submitKlingRefVideo } from "./kling";
import { cleanWish } from "./seedance";

export const PRODUCT_PROVIDER = "kling_product";

/** «Видео товара»: Kling 4.0 Omni makes a new video from the product photo (+ the model photo). */
export const klingProductProvider: GenerationProvider = {
  key: PRODUCT_PROVIDER,

  capabilities() {
    return {
      videoFaceSwap: false, maxFaces: 2, qualities: ["720p"], supportsCancel: false,
      reportsProgress: false, reportsCost: true, producesRealVideo: true,
    };
  },

  validateInputs(input) {
    const product = input.faces.find((f) => f.providerInput === "product");
    if (!product) return ["missing_product"];
    return [];
  },

  async submit(input) {
    const cfg = input.config as { scene?: unknown; withModel?: unknown; aspectRatio?: unknown; durationSec?: unknown; wish?: unknown };
    const product = input.faces.find((f) => f.providerInput === "product")!;
    const model = input.faces.find((f) => f.providerInput === "model");
    const withModel = !!model && cfg.withModel !== false;
    const scene = sceneFor(String(cfg.scene ?? ""), withModel) ?? PRODUCT_SCENES.find((s) => s.who === (withModel ? "model" : "product"))!;
    const durationSec = Number(cfg.durationSec) > 5 ? 10 : 5;
    const prompt = buildProductPrompt({ scene, withModel, wish: cleanWish(cfg.wish), durationSec });
    const resolution = input.quality === "1080p" ? "1080p" : "720p";
    const id = await submitKlingRefVideo({
      photoUrls: withModel ? [product.imageUrl, model!.imageUrl] : [product.imageUrl],
      prompt, durationSec, aspectRatio: String(cfg.aspectRatio ?? "9:16"), resolution,
    });
    // Estimate: units per second of the result (no input video here) × unit price.
    const s = await seedancePricingSettings();
    const cost = Math.round(durationSec * s.klingUnitsPerSec * s.klingUnitUsd * qualityCostFactor(resolution) * 10_000) / 10_000;
    return { providerJobId: id, cost, state: { stage: "product", scene: scene.key } };
  },

  async getStatus(providerJobId) {
    return getKlingTask(providerJobId);
  },
};
