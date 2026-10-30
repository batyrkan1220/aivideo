"use client";
import { useActionState } from "react";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";
import { kk } from "@/lib/i18n/kk";
import { startCheckout, type CheckoutState } from "@/lib/payments/actions";

export function PayButton(props: { orderId: string; label: string; sandbox: boolean; askPhone?: boolean }) {
  // The Kaspi invoice is sent to the phone; the customer pays in the Kaspi app (also from Telegram).
  return <WebPay {...props} />;
}

function WebPay({ orderId, label, sandbox, askPhone = false }: { orderId: string; label: string; sandbox: boolean; askPhone?: boolean }) {
  const [state, action, pending] = useActionState<CheckoutState, FormData>(startCheckout, {});
  const [phone, setPhone] = useSavedPhone();
  return (
    <form action={action} className="mt-5" onSubmit={() => savePhone(phone)}>
      <input type="hidden" name="orderId" value={orderId} />
      {askPhone && (
        <label className="mb-3 block">
          <span className="mb-1 block text-sm font-medium">{kk.tole.phoneLabel}</span>
          <input
            name="phone" type="tel" inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)}
            placeholder={kk.tole.phonePlaceholder}
            aria-invalid={state.error === "phone_invalid"}
            className={`h-12 w-full rounded-xl border bg-surface px-4 text-base text-ink outline-none focus:border-brand ${state.error === "phone_invalid" ? "border-danger" : "border-line"}`}
          />
          <span className="mt-1 block text-xs opacity-80">{kk.tole.phoneHint}</span>
        </label>
      )}
      <button
        disabled={pending}
        className="h-13 w-full rounded-full bg-flash font-semibold text-night transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {pending ? kk.order.paying : label}
      </button>
      {sandbox && <p className="mt-2 text-center text-xs font-semibold text-flash">{kk.sandbox.badge}</p>}
      {state.error && <p role="alert" className="mt-3 text-center text-sm text-flash">{kk.order.payErrors[state.error]}</p>}
    </form>
  );
}
