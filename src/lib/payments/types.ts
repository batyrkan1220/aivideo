/** Provider-agnostic payment interface. Every gateway (sandbox, Kaspi Pay, …) implements it. */

export type PaymentStatus = "pending" | "succeeded" | "failed" | "cancelled" | "refunded";

export type CreatePaymentInput = {
  paymentId: string;        // our payments.id (also the idempotency anchor)
  orderId: string;
  orderNumber: string;
  amountKzt: number;
  description: string;
  returnUrl: string;        // where the user lands after paying (status is NOT trusted from it)
  idempotencyKey: string;
};

export type CreatePaymentResult = {
  providerPaymentId: string;
  redirectUrl: string;
  expiresAt?: string;
};

/** A provider event that has passed signature verification. */
export type VerifiedPaymentEvent = {
  eventId: string;
  eventType: string;
  providerPaymentId: string;
  status: PaymentStatus;
  amountKzt: number;
  currency: string;
  reason?: string;
};

export interface PaymentProvider {
  readonly key: string;
  /** True when the provider can actually take money (false for sandbox). */
  readonly isLive: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Returns the event only if the request is authentic; otherwise null. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent | null>;
  refund?(providerPaymentId: string, amountKzt: number): Promise<{ ok: boolean }>;
}

export class PaymentProviderNotConfigured extends Error {
  constructor(key: string) { super(`Payment provider "${key}" is not configured`); }
}
