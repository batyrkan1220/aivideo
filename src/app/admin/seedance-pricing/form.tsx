"use client";
import { useActionState, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { formatKzt } from "@/lib/pricing";
import { seedanceAutoPriceKzt, seedanceCostKzt, seedanceCostUsd, seedancePricingSchema, type SeedancePricing } from "@/lib/pricing-seedance";
import { saveSeedancePricing, type SeedancePricingState } from "./actions";

const EXAMPLES = [5, 10, 15, 20, 30];

export function SeedancePricingForm({ value }: { value: SeedancePricing }) {
  const P = ru.admin.seedancePricing;
  const [state, action, pending] = useActionState<SeedancePricingState, FormData>(saveSeedancePricing, {});
  const [v, setV] = useState({
    usdPerSec: String(value.usdPerSec), refFactor: String(Math.round(value.refFactor * 100)), tengePerUsd: String(value.tengePerUsd),
    markupPercent: String(value.markupPercent), minPriceKzt: String(value.minPriceKzt), roundToKzt: String(value.roundToKzt),
  });
  const n = (x: string) => Number(x.replace(",", "."));
  const live = seedancePricingSchema.safeParse({
    usdPerSec: n(v.usdPerSec), refFactor: n(v.refFactor) / 100, tengePerUsd: n(v.tengePerUsd),
    markupPercent: n(v.markupPercent), minPriceKzt: n(v.minPriceKzt), roundToKzt: n(v.roundToKzt),
  });
  const s = live.success ? live.data : null;
  const input = "mt-1 h-10 w-full rounded-xl border border-line px-3 text-base sm:text-sm";
  const field = (name: keyof typeof v, label: string, step = "1") => (
    <label className="text-sm"><span className="font-medium">{label}</span>
      <input name={name} inputMode="decimal" step={step} value={v[name]} onChange={(e) => setV({ ...v, [name]: e.target.value })} className={input} />
    </label>
  );
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <h2 className="font-semibold">{P.title}</h2>
      <p className="mt-1 text-sm text-muted">{P.hint}</p>
      <form action={action} className="mt-4 space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {field("tengePerUsd", P.tengePerUsd, "0.01")}
          {field("markupPercent", P.markup)}
          {field("minPriceKzt", P.minPrice)}
        </div>
        <details className="rounded-xl bg-paper p-3 text-sm">
          <summary className="cursor-pointer font-medium">{P.advanced}</summary>
          <p className="mt-2 text-xs text-muted">{P.advancedHint}</p>
          <div className="mt-3 grid gap-4 sm:grid-cols-3">
            {field("usdPerSec", P.usdPerSec, "0.001")}
            {field("refFactor", P.refFactor)}
            {field("roundToKzt", P.roundTo)}
          </div>
        </details>
        {s && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[30rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-2 pr-3 font-medium">{P.example}</th><th className="py-2 pr-3 font-medium">{P.cost}</th><th className="py-2 pr-3 font-medium">{P.price}</th><th className="py-2 pr-3 font-medium">{P.profit}</th></tr>
              </thead>
              <tbody className="divide-y divide-line">
                {EXAMPLES.map((sec) => {
                  const cost = seedanceCostKzt(sec, s), price = seedanceAutoPriceKzt(sec, s);
                  return (
                    <tr key={sec}>
                      <td className="py-2 pr-3">{sec} {P.sec}</td>
                      <td className="py-2 pr-3 text-muted">{formatKzt(cost)} <span className="text-xs">(${seedanceCostUsd(sec, s).toFixed(2)})</span></td>
                      <td className="py-2 pr-3"><b>{formatKzt(price)}</b></td>
                      <td className={`py-2 pr-3 font-medium ${price - cost >= 0 ? "text-success" : "text-danger"}`}>{formatKzt(price - cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-1 text-xs text-muted">{P.tableHint}</p>
            {(() => {
              const o = { mode: "swap" as const, people: 1 };
              const cost = seedanceCostKzt(10, s, o), price = seedanceAutoPriceKzt(10, s, o);
              return <p className="mt-2 rounded-xl bg-paper px-3 py-2 text-sm">{P.swapLine(formatKzt(cost), formatKzt(price), formatKzt(price - cost))}</p>;
            })()}
            <table className="mt-3 w-full min-w-[30rem] text-sm">
              <caption className="pb-1 text-left text-xs font-medium text-muted">{P.klingTitle}</caption>
              <tbody className="divide-y divide-line">
                {EXAMPLES.map((sec) => {
                  const o = { mode: "kling" as const };
                  const cost = seedanceCostKzt(sec, s, o), price = seedanceAutoPriceKzt(sec, s, o);
                  return (
                    <tr key={sec}>
                      <td className="py-2 pr-3">{sec} {P.sec}</td>
                      <td className="py-2 pr-3 text-muted">{formatKzt(cost)} <span className="text-xs">(${seedanceCostUsd(sec, s, o).toFixed(2)})</span></td>
                      <td className="py-2 pr-3"><b>{formatKzt(price)}</b></td>
                      <td className={`py-2 pr-3 font-medium ${price - cost >= 0 ? "text-success" : "text-danger"}`}>{formatKzt(price - cost)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-3">
          <button disabled={pending || !s} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : P.save}</button>
          {state.ok && <span className="text-sm text-success">{P.saved}</span>}
          {(state.error || !s) && <span className="text-sm text-danger">{P.errors[state.error ?? "invalid"]}</span>}
        </div>
      </form>
    </section>
  );
}
