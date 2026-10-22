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
  /** Kaspi phone (+7XXXXXXXXXX) for invoice-based providers. Never stored or logged in full. */
  customerPhone?: string;
};

export type CreatePaymentResult = {
  /** Absent while the provider command is still pending (202) — reconcile later. */
  providerPaymentId?: string;
  redirectUrl: string;
  expiresAt?: string;
  providerCommandId?: string;
  providerOperationId?: string;
  /** Set when the outcome is not final yet; such a payment is reconciled, never re-created. */
  providerOutcome?: "in_progress" | "outcome_unknown" | "timeout";
  /** Last 4 digits of the invoice phone, for "invoice sent to ••1234". */
  phoneLast4?: string;
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
  /** Authentic event that needs no state change (e.g. payment.created). Stored and acknowledged. */
  ignore?: boolean;
};

/** verifyWebhook could not finish (e.g. provider read failed): ask the sender to redeliver. */
export class PaymentRetryLater extends Error {}

export interface PaymentProvider {
  readonly key: string;
  /** True when the provider can actually take money (false for sandbox). */
  readonly isLive: boolean;
  createPayment(input: CreatePaymentInput): Promise<CreatePaymentResult>;
  /** Returns the event only if the request is authentic; otherwise null. */
  verifyWebhook(rawBody: string, headers: Headers): Promise<VerifiedPaymentEvent | null>;
  refund?(providerPaymentId: string, amountKzt: number): Promise<{ ok: boolean }>;
}

/** Sandbox-like providers move no real money. */
export const TEST_PAYMENT_PROVIDERS = ["sandbox", "tole_sandbox"] as const;
export const isTestPaymentProvider = (key: string | null | undefined) =>
  !!key && (TEST_PAYMENT_PROVIDERS as readonly string[]).includes(key);

export class PaymentProviderNotConfigured extends Error {
  constructor(key: string) { super(`Payment provider "${key}" is not configured`); }
}
