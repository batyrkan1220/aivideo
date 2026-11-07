import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({}) }));
vi.mock("@/lib/pricing-seedance/settings", () => ({ seedancePricingSettings: async () => ({}) }));
vi.mock("@/lib/generation/kling", () => ({ klingStatus: async () => ({ state: "none" }) }));
vi.mock("@/lib/generation/kling-balance", () => ({ klingBalanceSignal: async () => ({ noBalance: false }) }));
import { orderUnits } from "@/lib/generation/kling-capacity";

describe("orderUnits", () => {
  const per = (sec: number) => 0.6 * (sec + Math.round(sec));
  it("one person, 720p", () => expect(orderUnits({ video_duration_sec: 15, quality: { key: "720p", providerQuality: "720p" }, provider_config_json: { people: 1 } }, per)).toBeCloseTo(18));
  it("two people = two runs", () => expect(orderUnits({ video_duration_sec: 15, quality: { key: "720p", providerQuality: "720p" }, provider_config_json: { people: 2 } }, per)).toBeCloseTo(36));
  it("no length: 0 (nothing to check)", () => expect(orderUnits({}, per)).toBe(0));
});
