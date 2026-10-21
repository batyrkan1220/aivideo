import "server-only";
import { randomUUID } from "node:crypto";
import type { GenerationProvider } from "./types";

/**
 * Development adapter. It exercises the whole pipeline (queue, submit, progress polling,
 * terminal state) but NEVER produces or returns a video: it always ends with the explicit
 * error "dev_provider_no_output", which the UI shows as "AI provider not connected".
 * It must not return the sample video or any placeholder as a personalised result.
 */
const SIMULATED_SECONDS = 30;

export const devProvider: GenerationProvider = {
  key: "dev",

  capabilities() {
    return {
      videoFaceSwap: false,
      maxFaces: 10,
      qualities: ["standard", "hd", "high", "uhd"],
      supportsCancel: true,
      reportsProgress: true,
      reportsCost: true,
      producesRealVideo: false,
    };
  },

  validateInputs(input) {
    const problems: string[] = [];
    if (!input.templateVideoUrl) problems.push("missing_template_video");
    if (!input.faces.length) problems.push("missing_faces");
    if (new Set(input.faces.map((f) => f.providerInput)).size !== input.faces.length) problems.push("duplicate_face_input");
    return problems;
  },

  async submit() {
    return { providerJobId: `dev_${randomUUID()}`, cost: 0 };
  },

  async getStatus(_id, { startedAt }) {
    const elapsed = startedAt ? (Date.now() - startedAt.getTime()) / 1000 : 0;
    if (elapsed < SIMULATED_SECONDS) {
      return { state: "processing", progress: Math.min(95, Math.round((elapsed / SIMULATED_SECONDS) * 100)) };
    }
    return { state: "failed", errorCode: "dev_provider_no_output", retryable: false, cost: 0 };
  },

  async cancel() {},
};
