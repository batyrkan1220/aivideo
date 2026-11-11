"use client";
import { useState, useTransition } from "react";
import { setMultiPeople } from "./actions";

/** 2–3 person templates: hidden from customers until the one-run-per-person result is checked. */
export function MultiPeopleToggle({ on: initial }: { on: boolean }) {
  const [on, setOn] = useState(initial);
  const [pending, start] = useTransition();
  return (
    <button type="button" disabled={pending} title="Шаблоны, где нужно 2–3 фото: Kling меняет всех за одну генерацию, цена как за одну"
      onClick={() => start(async () => { const r = await setMultiPeople(!on); if (r.ok) setOn(!on); })}
      className={`rounded-full border px-4 py-2 text-sm font-semibold disabled:opacity-60 ${on ? "border-ink bg-night text-white" : "border-line bg-white hover:border-ink"}`}>
      👥 2–3 человека: {on ? "показаны клиентам" : "скрыты"}
    </button>
  );
}
