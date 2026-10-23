"use client";
import { useActionState } from "react";
import { ru } from "@/lib/i18n/ru";
import { saveCpaSettings, type CpaState } from "./actions";

export function CpaForm({ value }: { value: { enabled: boolean; postbackUrl: string; sendLead: boolean; sendSale: boolean } }) {
  const C = ru.admin.cpa;
  const [state, action, pending] = useActionState<CpaState, FormData>(saveCpaSettings, {});
  return (
    <form action={action} className="space-y-4 rounded-card border border-line bg-white p-5">
      <label className="flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="enabled" defaultChecked={value.enabled} className="h-4 w-4 accent-brand" /> {C.enabled}
      </label>
      <label className="block text-sm"><span className="font-medium">{C.postbackUrl}</span>
        <input name="postbackUrl" defaultValue={value.postbackUrl} placeholder="https://xxxx.o18.click/p?m=1234&tid={click_id}&event={event}&sale={sum}&currency={currency}&adv_sub1={order_id}" className="mt-1 h-10 w-full rounded-xl border border-line px-3 font-mono text-xs" />
        <span className="mt-1 block text-xs text-muted">{C.macros}</span>
      </label>
      <div className="flex flex-wrap gap-5 text-sm">
        <label className="flex items-center gap-2"><input type="checkbox" name="sendSale" defaultChecked={value.sendSale} className="h-4 w-4 accent-brand" /> {C.sendSale}</label>
        <label className="flex items-center gap-2"><input type="checkbox" name="sendLead" defaultChecked={value.sendLead} className="h-4 w-4 accent-brand" /> {C.sendLead}</label>
      </div>
      <div className="flex items-center gap-3">
        <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : C.save}</button>
        {state.ok && <span className="text-sm text-success">{C.saved}</span>}
        {state.error && <span className="text-sm text-danger">{C.errors[state.error]}</span>}
      </div>
    </form>
  );
}
