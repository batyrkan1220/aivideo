"use client";
import { useActionState } from "react";
import { saveGeminiBilling } from "./actions";

/** Balance after a top-up and token prices for the Gemini spending report. */
export function GeminiBillingForm({ balanceUsd, inputUsdPer1M, outputUsdPer1M }: { balanceUsd: number | null; inputUsdPer1M: number; outputUsdPer1M: number }) {
  const [state, action, pending] = useActionState(saveGeminiBilling, {});
  const field = "mt-1 w-full rounded-xl border border-line bg-white px-3 py-2 text-sm";
  return (
    <form action={action} className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
      <label className="text-xs text-muted">Баланс сейчас, $ (после пополнения)
        <input name="balanceUsd" inputMode="decimal" defaultValue={balanceUsd ?? ""} placeholder="например 10" className={field} />
      </label>
      <label className="text-xs text-muted">Цена входа, $ за 1 млн токенов
        <input name="inputUsdPer1M" inputMode="decimal" defaultValue={inputUsdPer1M} className={field} />
      </label>
      <label className="text-xs text-muted">Цена ответа, $ за 1 млн токенов
        <input name="outputUsdPer1M" inputMode="decimal" defaultValue={outputUsdPer1M} className={field} />
      </label>
      <button type="submit" disabled={pending} className="rounded-full bg-ink px-5 py-2 text-sm font-semibold text-white disabled:opacity-60">
        {pending ? "Сохраняю…" : "Сохранить"}
      </button>
      {state.error && <p className="text-sm text-danger sm:col-span-4">{state.error}</p>}
      {state.ok && <p className="text-sm text-success sm:col-span-4">Сохранено</p>}
    </form>
  );
}
