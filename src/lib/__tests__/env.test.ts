import { describe, it, expect, vi, beforeEach } from "vitest";

beforeEach(() => { vi.resetModules(); vi.unstubAllEnvs(); });

describe("env", () => {
  it("drops a malformed optional integration secret instead of failing", async () => {
    vi.stubEnv("TOLE_CONNECTION_ID", "not-a-uuid");
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { env } = await import("../env");
    expect(env().TOLE_CONNECTION_ID).toBeUndefined();
    expect(env().TOLE_API_KEY).toBe("tole_sk_test_unit_only");
    expect(spy.mock.calls[0][0]).toContain("TOLE_CONNECTION_ID");
    expect(spy.mock.calls[0][0]).not.toContain("not-a-uuid");   // never logs the value
  });
  it("still fails on a broken required variable", async () => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "nope");
    const { env } = await import("../env");
    expect(() => env()).toThrow(/NEXT_PUBLIC_SUPABASE_URL/);
  });
});
