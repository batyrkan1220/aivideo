import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("@/lib/env", () => ({ env: () => ({ TELIKS_API_SECRET: "x".repeat(40) }) }));
const { partnerApiAuthorized } = await import("@/lib/partners/api-auth");
const req = (h?: string) => ({ headers: new Headers(h ? { authorization: h } : {}) }) as never;

describe("partner API auth", () => {
  it("accepts only the exact shared secret", () => {
    expect(partnerApiAuthorized(req(`Bearer ${"x".repeat(40)}`))).toBe(true);
    expect(partnerApiAuthorized(req(`Bearer ${"x".repeat(39)}y`))).toBe(false);
    expect(partnerApiAuthorized(req("Bearer short"))).toBe(false);
    expect(partnerApiAuthorized(req())).toBe(false);
  });
});
