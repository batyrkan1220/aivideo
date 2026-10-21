"use client";
import { useActionState } from "react";
import { kk } from "@/lib/i18n/kk";
import { startCheckout, type CheckoutState } from "@/lib/payments/actions";

export function PayButton({ orderId, label, sandbox }: { orderId: string; label: string; sandbox: boolean }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(startCheckout, {});
  return (
    <form action={action} className="mt-5">
      <input type="hidden" name="orderId" value={orderId} />
      <button
        disabled={pending}
        className="h-13 w-full rounded-full bg-flash font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? kk.order.paying : label}
      </button>
      {sandbox && <p className="mt-2 text-center text-xs font-semibold text-flash">{kk.sandbox.badge}</p>}
      {state.error && <p role="alert" className="mt-3 text-center text-sm text-flash">{kk.order.payErrors[state.error]}</p>}
    </form>
  );
}
