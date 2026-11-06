"use client";
import { useActionState } from "react";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";
import { KzPhoneInput } from "./kz-phone-input";
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
        <label className="mb-3 block rounded-2xl bg-[#f14635] p-3.5 text-white">
          <span className="mb-2 flex items-center gap-2 text-sm font-extrabold">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/kaspi.png" alt="Kaspi" width={28} height={28} className="h-7 w-7 rounded-[8px] ring-2 ring-white/70" />
            {kk.tole.phoneLabel}
          </span>
          <KzPhoneInput
            name="phone" required value={phone} onChange={setPhone} ariaLabel={kk.tole.phoneLabel} invalid={state.error === "phone_invalid"}
            className={`h-12 w-full rounded-xl border-2 bg-white text-base focus-within:border-night ${state.error === "phone_invalid" ? "border-night" : "border-white"}`}
          />
          <span className="mt-1.5 block text-xs font-medium text-white/90">{kk.tole.phoneHint}</span>
        </label>
      )}
      <button
        disabled={pending}
        className="btn-glow h-13 w-full rounded-full font-semibold disabled:opacity-60"
      >
        {pending ? kk.order.paying : label}
      </button>
      {sandbox && <p className="mt-2 text-center text-xs font-semibold text-muted">{kk.sandbox.badge}</p>}
      {state.error && <p role="alert" className="mt-3 text-center text-sm text-danger">{kk.order.payErrors[state.error]}</p>}
    </form>
  );
}
