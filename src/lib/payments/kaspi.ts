import "server-only";
import { env } from "@/lib/env";
import { PaymentProviderNotConfigured, type PaymentProvider } from "./types";

/**
 * Kaspi Pay adapter — placeholder until merchant API access is granted.
 *
 * Kaspi publishes its e-commerce API documentation to contracted merchants only, so the
 * request/response formats and the callback signature scheme are NOT implemented here
 * by guesswork. When credentials and docs are available, implement:
 *   createPayment  → create an invoice/payment for amountKzt, return its id + payment URL
 *   verifyWebhook  → verify the callback signature per Kaspi's scheme, map statuses
 *   refund         → call Kaspi's refund endpoint
 * Required env: KASPI_MERCHANT_ID, KASPI_API_KEY, KASPI_WEBHOOK_SECRET, KASPI_API_BASE_URL.
 * Until then every call fails loudly, so no order can be marked paid through this path.
 */
function configured() {
  const e = env();
  return !!(e.KASPI_MERCHANT_ID && e.KASPI_API_KEY && e.KASPI_WEBHOOK_SECRET && e.KASPI_API_BASE_URL);
}

export const kaspiProvider: PaymentProvider = {
  key: "kaspi",
  isLive: true,
  async createPayment() {
    if (!configured()) throw new PaymentProviderNotConfigured("kaspi");
    throw new PaymentProviderNotConfigured("kaspi (API implementation pending merchant docs)");
  },
  async verifyWebhook() {
    return null; // never accept unverified callbacks
  },
};
