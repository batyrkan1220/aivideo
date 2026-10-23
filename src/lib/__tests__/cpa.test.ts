import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const { renderPostback, clickFromPayload } = await import("@/lib/cpa");

describe("cpa", () => {
  it("parses the Offer18 click id from the bot start payload", () => {
    expect(clickFromPayload("o18_abc123XYZ-_9")).toBe("abc123XYZ-_9");
    expect(clickFromPayload("p_10a4a5b9")).toBeNull();
    expect(clickFromPayload("o18_a b")).toBeNull();
  });
  it("renders Offer18 global postback macros, URL-encoded", () => {
    const url = renderPostback("https://x.o18.click/p?m=12&tid={aff_click_id}&event={event}&sale={sum}&currency={currency}&adv_sub1={order_id}&keep={unknown}",
      { clickId: "c1", event: "sale", sum: 1990, orderId: "TV-100014", txnId: "TV-100014" });
    expect(url).toBe("https://x.o18.click/p?m=12&tid=c1&event=sale&sale=1990&currency=KZT&adv_sub1=TV-100014&keep={unknown}");
  });
});
