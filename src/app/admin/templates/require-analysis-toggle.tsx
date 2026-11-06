"use client";
import { useState, useTransition } from "react";
import { setRequireAnalysis } from "./actions";

/** While Gemini is not available: templates without the AI analysis can be published and ordered. */
export function RequireAnalysisToggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} title="Выключите, пока Gemini недоступен: шаблоны без ИИ-анализа можно публиковать и заказывать"
      onClick={() => start(async () => { const r = await setRequireAnalysis(!on); if (r.ok) setOn(!on); })}
      className={`rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${on ? "border-line bg-white hover:border-ink" : "border-[#f0c36d] bg-[#fff8e6] text-night"}`}>
      🤖 ИИ-анализ: {on ? "обязателен" : "не обязателен"}
    </button>
  );
}
