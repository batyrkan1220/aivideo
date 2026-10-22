"use client";
import { useActionState } from "react";
import { ru } from "@/lib/i18n/ru";
import { saveCustomVideoSettings, type CustomVideoState } from "./actions";

export function CustomVideoForm({ value }: { value: { enabled: boolean; maxSeconds: number; maxMb: number } }) {
  const C = ru.admin.customVideo;
  const [state, action, pending] = useActionState<CustomVideoState, FormData>(saveCustomVideoSettings, {});
  const input = "mt-1 h-10 w-full rounded-xl border border-line px-3 text-base sm:text-sm";
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <h2 className="font-semibold">{C.title}</h2>
      <p className="mt-1 text-sm text-muted">{C.hint}</p>
      <form action={action} className="mt-4 grid gap-4 sm:grid-cols-3 sm:items-end">
        <label className="flex items-center gap-2 text-sm font-medium sm:col-span-3">
          <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="h-4 w-4 accent-brand" /> {C.enabled}
        </label>
        <label className="text-sm"><span className="font-medium">{C.maxSeconds}</span>
          <input name="maxSeconds" type="number" min={3} max={60} defaultValue={value.maxSeconds} className={input} /></label>
        <label className="text-sm"><span className="font-medium">{C.maxMb}</span>
          <input name="maxMb" type="number" min={5} max={50} defaultValue={value.maxMb} className={input} /></label>
        <div className="flex items-center gap-3">
          <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : C.save}</button>
          {state.ok && <span className="text-sm text-success">{C.saved}</span>}
          {state.error && <span className="text-sm text-danger">{C.errors[state.error]}</span>}
        </div>
      </form>
    </section>
  );
}
