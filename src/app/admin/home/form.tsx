"use client";
import { useActionState } from "react";
import { ru } from "@/lib/i18n/ru";
import { saveShowcase, type ShowcaseState } from "./actions";

type Option = { id: string; title: string; cover: string | null };
const H = ru.admin.home;

export function ShowcaseForm({ options, current }: { options: Option[]; current: (string | null)[] }) {
  const [state, action, pending] = useActionState<ShowcaseState, FormData>(saveShowcase, {});
  const slots = [
    { name: "left", label: H.left, value: current[1] },
    { name: "center", label: H.center, value: current[0] },
    { name: "right", label: H.right, value: current[2] },
  ];
  return (
    <form action={action} className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3">
        {slots.map((s) => (
          <label key={s.name} className={`block rounded-card border bg-white p-4 ${s.name === "center" ? "border-brand" : "border-line"}`}>
            <span className="mb-2 block text-sm font-semibold">{s.label}</span>
            <select name={s.name} defaultValue={s.value ?? ""} className="w-full rounded-xl border border-line bg-white px-3 py-2 text-base sm:text-sm">
              <option value="">{H.auto}</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>{o.title}{o.cover ? "" : ` (${H.noMedia})`}</option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <button disabled={pending} className="h-11 rounded-full bg-brand px-6 font-semibold text-white hover:bg-brand-dark disabled:opacity-50">
          {pending ? ru.common.loading : H.save}
        </button>
        <a href="/" target="_blank" rel="noopener" className="text-sm font-semibold text-brand hover:underline">{H.preview}</a>
        {state.ok && <span className="text-sm text-success" role="status">{state.ok}</span>}
        {state.error && <span className="text-sm text-danger" role="alert">{state.error}</span>}
      </div>
    </form>
  );
}
