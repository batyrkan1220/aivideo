import { describe, it, expect } from "vitest";
import { sandboxProvider, signSandbox } from "../payments/sandbox";

const event = (over: Record<string, unknown> = {}) => JSON.stringify({
  eventId: "evt_12345678", eventType: "payment.succeeded", providerPaymentId: "sbx_12345678",
  status: "succeeded", amountKzt: 2990, currency: "KZT", ts: Date.now(), ...over,
});

describe("sandbox webhook verification (mock provider, no network)", () => {
  it("accepts a correctly signed event", async () => {
    const body = event();
    const ev = await sandboxProvider.verifyWebhook(body, new Headers({ "x-sandbox-signature": signSandbox(body) }));
    expect(ev?.status).toBe("succeeded");
    expect(ev?.amountKzt).toBe(2990);
  });
  it("rejects a missing or forged signature", async () => {
    const body = event();
    expect(await sandboxProvider.verifyWebhook(body, new Headers())).toBeNull();
    expect(await sandboxProvider.verifyWebhook(body, new Headers({ "x-sandbox-signature": "00".repeat(32) }))).toBeNull();
  });
  it("rejects a tampered body (amount changed after signing)", async () => {
    const sig = signSandbox(event());
    const tampered = event({ amountKzt: 1 });
    expect(await sandboxProvider.verifyWebhook(tampered, new Headers({ "x-sandbox-signature": sig }))).toBeNull();
  });
  it("rejects replays outside the 10-minute window", async () => {
    const body = event({ ts: Date.now() - 11 * 60_000 });
    expect(await sandboxProvider.verifyWebhook(body, new Headers({ "x-sandbox-signature": signSandbox(body) }))).toBeNull();
  });
});
