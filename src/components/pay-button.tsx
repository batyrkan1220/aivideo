"use client";
import { useActionState, useState, useTransition } from "react";
import { telegramApp, useIsTelegram } from "@/lib/telegram/client";
import { createPaymentHandoff } from "@/lib/telegram/actions";
import { useSavedPhone, savePhone } from "@/lib/payments/saved-phone";
import { kk } from "@/lib/i18n/kk";
import { startCheckout, type CheckoutState } from "@/lib/payments/actions";

export function PayButton(props: { orderId: string; label: string; sandbox: boolean; askPhone?: boolean }) {
  // Inside Telegram the payment continues on the website (Telegram rules for digital goods).
  return useIsTelegram() ? <TelegramPay orderId={props.orderId} /> : <WebPay {...props} />;
}

/**
 * Opens the order in the regular browser, already signed in (one-time link).
 * Step 1 prepares the link; step 2 opens it directly from the tap (Telegram expects a user gesture).
 */
function TelegramPay({ orderId }: { orderId: string }) {
  const [pending, start] = useTransition();
  const [url, setUrl] = useState<string | null>(null);
  const [opened, setOpened] = useState(false);
  const [failed, setFailed] = useState(false);
  const prepare = () => start(async () => {
    setFailed(false);
    const r = await createPaymentHandoff(orderId);
    if (r.ok) setUrl(r.url); else setFailed(true);
  });
  const open = () => {
    const wa = telegramApp();
    if (!url || !wa) return;
    wa.openLink(url);
    setOpened(true);
    setUrl(null); // the link is single-use
  };
  const btn = "h-13 w-full rounded-full bg-flash font-semibold text-ink transition-opacity hover:opacity-90 disabled:opacity-60";
  return (
    <div className="mt-5">
      {url ? (
        <button type="button" onClick={open} className={btn}>{kk.telegram.openBrowser}</button>
      ) : (
        <button type="button" onClick={prepare} disabled={pending} className={btn}>
          {pending ? kk.order.paying : kk.telegram.payInBrowser}
        </button>
      )}
      {opened && <p role="status" className="mt-3 text-center text-sm opacity-90">{kk.telegram.payOpened}</p>}
      {failed && <p role="alert" className="mt-3 text-center text-sm text-flash">{kk.order.payErrors.generic}</p>}
    </div>
  );
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
            className={`h-12 w-full rounded-xl border bg-white px-4 text-base text-ink outline-none focus:border-brand ${state.error === "phone_invalid" ? "border-danger" : "border-line"}`}
          />
          <span className="mt-1 block text-xs opacity-80">{kk.tole.phoneHint}</span>
        </label>
      )}
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
