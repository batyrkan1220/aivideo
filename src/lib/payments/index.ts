import "server-only";
import { env } from "@/lib/env";
import { sandboxProvider } from "./sandbox";
import { kaspiProvider } from "./kaspi";
import { toleProvider, toleSandboxProvider } from "./tole/provider";
import type { PaymentProvider } from "./types";

const providers: Record<string, PaymentProvider> = {
  sandbox: sandboxProvider,
  kaspi: kaspiProvider,
  tole: toleProvider,
  tole_sandbox: toleSandboxProvider,
};

/** Active provider for NEW payments (PAYMENT_PROVIDER). */
export function activePaymentProvider(): PaymentProvider {
  const key = env().PAYMENT_PROVIDER;
  const p = providers[key];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER "${key}"`);
  return p;
}

/** Provider by key — used for webhooks and for payments created earlier. */
export function paymentProvider(key: string): PaymentProvider | null {
  return providers[key] ?? null;
}
