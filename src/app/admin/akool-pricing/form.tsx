"use client";
import { useActionState, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { formatKzt } from "@/lib/pricing";
import { akoolAutoPriceKzt, akoolCostKzt, akoolCredits, akoolPricingSchema, AKOOL_RESOLUTIONS, type AkoolPricing } from "@/lib/pricing-akool";
import { saveAkoolPricing, type AkoolPricingState } from "./actions";

const EXAMPLES = [5, 10, 15, 20];

export function AkoolPricingForm({ value }: { value: AkoolPricing }) {
  const P = ru.admin.akoolPricing;
  const [state, action, pending] = useActionState<AkoolPricingState, FormData>(saveAkoolPricing, {});
  const [v, setV] = useState({
    tengePerCredit: String(value.tengePerCredit), markupPercent: String(value.markupPercent), minPriceKzt: String(value.minPriceKzt),
    roundToKzt: String(value.roundToKzt), blockSec: String(value.blockSec), cps480: String(value.creditsPerSec["480p"]), cps720: String(value.creditsPerSec["720p"]),
  });
  const n = (x: string) => Number(x.replace(",", "."));
  const live = akoolPricingSchema.safeParse({
    tengePerCredit: n(v.tengePerCredit), markupPercent: n(v.markupPercent), minPriceKzt: n(v.minPriceKzt), roundToKzt: n(v.roundToKzt),
    blockSec: n(v.blockSec), creditsPerSec: { "480p": n(v.cps480), "720p": n(v.cps720) },
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
          {field("tengePerCredit", P.tengePerCredit, "0.01")}
          {field("markupPercent", P.markup)}
          {field("minPriceKzt", P.minPrice)}
          {field("cps480", P.cps("480p"), "0.1")}
          {field("cps720", P.cps("720p"), "0.1")}
          {field("blockSec", P.blockSec)}
          {field("roundToKzt", P.roundTo)}
        </div>
        {s && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-sm">
              <thead className="text-left text-xs text-muted">
                <tr><th className="py-2 pr-3 font-medium">{P.example}</th>{AKOOL_RESOLUTIONS.map((r) => <th key={r} className="py-2 pr-3 font-medium">{r}: {P.creditsCostPrice}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-line">
                {EXAMPLES.map((sec) => (
                  <tr key={sec}>
                    <td className="py-2 pr-3">{sec} {P.sec}</td>
                    {AKOOL_RESOLUTIONS.map((r) => (
                      <td key={r} className="py-2 pr-3">
                        <span className="text-muted">{akoolCredits(sec, r, s)} · {formatKzt(akoolCostKzt(sec, r, s))} →</span>{" "}
                        <b>{formatKzt(akoolAutoPriceKzt(sec, r, s))}</b>
                      </td>
                    ))}
                  </tr>
                ))}
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
