import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ supabaseAdmin: () => ({}), supabaseServer: async () => ({}) }));
vi.mock("@/lib/partners", () => ({ attributeTelegramUser: async () => {} }));
vi.mock("@/lib/auth/session", () => ({ forgetProfile: () => {} }));

describe("bot login payload", () => {
  it("reads only l_<uuid>", async () => {
    const { loginIdFromStart } = await import("@/lib/telegram/bot-login");
    const id = "0f8fad5b-d9cb-469f-a165-70867728950e";
    expect(loginIdFromStart(`l_${id}`)).toBe(id);
    expect(loginIdFromStart("p_partner1")).toBeNull();
    expect(loginIdFromStart("l_not-a-uuid")).toBeNull();
    expect(loginIdFromStart(null)).toBeNull();
    expect(`l_${id}`.length).toBeLessThanOrEqual(64); // Telegram start parameter limit
  });
});
