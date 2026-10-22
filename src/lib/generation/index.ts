import "server-only";
import { devProvider } from "./dev";
import { akoolProvider } from "./akool";
import type { GenerationProvider } from "./types";

/**
 * Registered generation providers. To add a real one, implement GenerationProvider in
 * src/lib/generation/<name>.ts (submit / getStatus / validateInputs / capabilities),
 * register it here, set AI_PROVIDER and the provider's keys, and select it per template
 * in the admin editor. Verify the vendor genuinely supports face replacement in an
 * existing video with multiple faces before enabling it.
 */
const providers: Record<string, GenerationProvider> = {
  dev: devProvider,
  akool: akoolProvider,
};

export function generationProvider(key: string | null | undefined): GenerationProvider | null {
  return key ? providers[key] ?? null : null;
}

export function registeredProviderKeys() {
  return Object.keys(providers);
}
