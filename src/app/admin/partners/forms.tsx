"use client";
import { useActionState, useState } from "react";
import { ru } from "@/lib/i18n/ru";
import { createPartner, updatePartner, addPayout, createTeliksLogin, resetTeliksLogin, type PartnerState, type TeliksState } from "./actions";

const input = "mt-1 h-10 w-full rounded-xl border border-line px-3 text-base sm:text-sm";
type P = { id: string; name: string; code: string; telegram_username: string | null; percent: number; contact: string | null; notes: string | null; active: boolean };

function Status({ state }: { state: PartnerState }) {
  const T = ru.admin.partners;
  if (state.ok) return <span className="text-sm text-success">{T.saved}</span>;
  if (state.error) return <span className="text-sm text-danger">{T.errors[state.error]}</span>;
  return null;
}

function Fields({ p }: { p?: P }) {
  const T = ru.admin.partners;
  return (
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-sm"><span className="font-medium">{T.name}</span><input name="name" required maxLength={80} defaultValue={p?.name} className={input} /></label>
      <label className="text-sm"><span className="font-medium">{T.telegram}</span><input name="telegram_username" placeholder="@username" defaultValue={p?.telegram_username ? `@${p.telegram_username}` : ""} className={input} /></label>
      <label className="text-sm"><span className="font-medium">{T.percent}</span><input name="percent" inputMode="decimal" required defaultValue={p?.percent ?? 20} className={input} /></label>
      <label className="text-sm"><span className="font-medium">{T.code}</span><input name="code" placeholder={T.codeAuto} defaultValue={p?.code} maxLength={24} className={input} /></label>
      <label className="text-sm"><span className="font-medium">{T.contact}</span><input name="contact" maxLength={200} defaultValue={p?.contact ?? ""} className={input} /></label>
      <label className="text-sm"><span className="font-medium">{T.notes}</span><input name="notes" maxLength={1000} defaultValue={p?.notes ?? ""} className={input} /></label>
    </div>
  );
}

export function CreatePartnerForm() {
  const T = ru.admin.partners;
  const [state, action, pending] = useActionState<PartnerState, FormData>(createPartner, {});
  const [open, setOpen] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white">+ {T.add}</button>;
  return (
    <form action={action} className="rounded-card border border-line bg-white p-5">
      <h2 className="mb-4 font-semibold">{T.add}</h2>
      <Fields />
      <p className="mt-2 text-xs text-muted">{T.telegramHint}</p>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : T.create}</button>
        <button type="button" onClick={() => setOpen(false)} className="text-sm text-muted">{T.cancel}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function EditPartnerForm({ p }: { p: P }) {
  const T = ru.admin.partners;
  const [state, action, pending] = useActionState<PartnerState, FormData>(updatePartner, {});
  return (
    <form action={action} className="rounded-card border border-line bg-white p-5">
      <input type="hidden" name="id" value={p.id} />
      <Fields p={p} />
      <label className="mt-4 flex items-center gap-2 text-sm font-medium">
        <input type="checkbox" name="active" defaultChecked={p.active} className="h-4 w-4 accent-brand" /> {T.active}
      </label>
      <p className="mt-2 text-xs text-muted">{T.percentHint}</p>
      <div className="mt-4 flex items-center gap-3">
        <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : T.save}</button>
        <Status state={state} />
      </div>
    </form>
  );
}

export function PayoutForm({ id }: { id: string }) {
  const T = ru.admin.partners;
  const [state, action, pending] = useActionState<PartnerState, FormData>(addPayout, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <input type="hidden" name="id" value={id} />
      <label className="text-sm"><span className="font-medium">{T.payoutAmount}</span><input name="amount" inputMode="numeric" required className={input} /></label>
      <label className="min-w-48 flex-1 text-sm"><span className="font-medium">{T.payoutNote}</span><input name="note" maxLength={300} className={input} /></label>
      <button disabled={pending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{pending ? ru.common.loading : T.payoutAdd}</button>
      <Status state={state} />
    </form>
  );
}

export function CopyLink({ label, url }: { label: string; url: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl bg-paper px-3 py-2 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <code className="min-w-0 flex-1 truncate">{url}</code>
      <button type="button" className="shrink-0 font-semibold text-brand" onClick={() => { void navigator.clipboard?.writeText(url).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
        {done ? "✓" : ru.admin.partners.copy}
      </button>
    </div>
  );
}

export function TeliksAccessForm({ id, email, teliksUrl }: { id: string; email: string | null; teliksUrl: string }) {
  const T = ru.admin.partners;
  const [cState, create, cPending] = useActionState<TeliksState, FormData>(createTeliksLogin, {});
  const [rState, reset, rPending] = useActionState<TeliksState, FormData>(resetTeliksLogin, {});
  const pw = cState.password ?? rState.password;
  const err = cState.error ?? rState.error;
  return (
    <div className="space-y-3">
      {email ? (
        <form action={reset} className="flex flex-wrap items-center gap-3 text-sm">
          <input type="hidden" name="id" value={id} />
          <span>{T.teliksLogin}: <b>{email}</b></span>
          <button disabled={rPending} className="rounded-full border border-line px-3 py-1.5 font-semibold hover:border-ink disabled:opacity-50">{rPending ? ru.common.loading : T.teliksReset}</button>
        </form>
      ) : (
        <form action={create} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="id" value={id} />
          <label className="min-w-56 flex-1 text-sm"><span className="font-medium">{T.teliksEmail}</span><input name="email" type="email" required className={input} /></label>
          <button disabled={cPending} className="h-10 rounded-full bg-ink px-4 text-sm font-semibold text-white disabled:opacity-50">{cPending ? ru.common.loading : T.teliksCreate}</button>
        </form>
      )}
      {pw && (
        <div className="rounded-xl bg-flash/20 p-4 text-sm">
          <p className="font-semibold">{T.teliksPasswordOnce}</p>
          <CopyLink label={T.teliksPassword} url={pw} />
          <p className="mt-2 text-xs text-muted">{T.teliksSend(teliksUrl)}</p>
        </div>
      )}
      {err && <p className="text-sm text-danger">{T.teliksErrors[err]}</p>}
    </div>
  );
}
