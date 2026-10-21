import "server-only";
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";
import { z } from "zod";
import { env } from "@/lib/env";
import type { PaymentProvider, VerifiedPaymentEvent } from "./types";

/**
 * Development/sandbox gateway. No real money moves. The "payment page" is our own
 * /checkout/sandbox page, clearly labelled as a test. Its result is delivered as an
 * HMAC-signed webhook that goes through exactly the same verification + processing
 * path as a real gateway. Refused in production by env().
 */
function secret() {
  const e = env();
  const base = e.PAYMENT_WEBHOOK_SECRET ?? e.SUPABASE_SERVICE_ROLE_KEY;
  if (!base) throw new Error("No secret available for sandbox webhook signing");
  return createHmac("sha256", base).update("sandbox-payment-webhook-v1").digest();
}

export function signSandbox(body: string) {
  return createHmac("sha256", secret()).update(body).digest("hex");
}

const eventSchema = z.object({
  eventId: z.string().min(8),
  eventType: z.string(),
  providerPaymentId: z.string().min(8),
  status: z.enum(["succeeded", "failed", "cancelled", "refunded"]),
  amountKzt: z.number().int().nonnegative(),
  currency: z.string(),
  ts: z.number().int(),
});

export const sandboxProvider: PaymentProvider = {
  key: "sandbox",
  isLive: false,

  async createPayment(input) {
    const providerPaymentId = `sbx_${randomUUID()}`;
    return {
      providerPaymentId,
      redirectUrl: `/checkout/sandbox/${input.paymentId}`,
      expiresAt: new Date(Date.now() + 30 * 60_000).toISOString(),
    };
  },

  async verifyWebhook(rawBody, headers): Promise<VerifiedPaymentEvent | null> {
    const sig = headers.get("x-sandbox-signature") ?? "";
    const expected = signSandbox(rawBody);
    const a = Buffer.from(sig, "hex");
    const b = Buffer.from(expected, "hex");
    if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
    let parsed;
    try { parsed = eventSchema.safeParse(JSON.parse(rawBody)); } catch { return null; }
    if (!parsed.success) return null;
    if (Math.abs(Date.now() - parsed.data.ts) > 10 * 60_000) return null; // replay window
    const { ts: _ts, ...ev } = parsed.data;
    void _ts;
    return ev;
  },
};
