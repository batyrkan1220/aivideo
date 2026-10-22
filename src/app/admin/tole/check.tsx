"use client";
import { useState, useTransition } from "react";
import { ru } from "@/lib/i18n/ru";
import { checkTole, type ToleCheck } from "./actions";

export function ToleCheckPanel() {
  const [r, setR] = useState<ToleCheck | null>(null);
  const [pending, start] = useTransition();
  const T = ru.admin.tole;
  const row = (label: string, ok: boolean, text: string) => (
    <li className="flex justify-between gap-4"><span className="text-muted">{label}</span><span className={ok ? "text-success" : "text-danger"}>{text}</span></li>
  );
  return (
    <section className="rounded-card border border-line bg-white p-5">
      <h2 className="font-semibold">{T.title}</h2>
      <p className="mt-1 text-sm text-muted">{T.hint}</p>
      <button type="button" disabled={pending} onClick={() => start(async () => setR(await checkTole()))}
        className="mt-3 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
        {pending ? ru.common.loading : T.run}
      </button>
      {r?.error && <p className="mt-3 text-sm text-danger">{T.forbidden}</p>}
      {r?.ran && (
        <ul className="mt-4 space-y-1 text-sm">
          {row("PAYMENT_PROVIDER", r.provider === "tole" || r.provider === "tole_sandbox", r.provider ?? "—")}
          {row("TOLE_API_KEY", r.keyMode !== "missing", T.key[r.keyMode!])}
          {row("TOLE_CONNECTION_ID", !!r.connectionId, r.connectionId ? T.set : T.missing)}
          {row("TOLE_WEBHOOK_SECRET", r.webhookSecret === "ok", T.secret[r.webhookSecret!])}
          {row(T.apiLabel, r.api === "ok", T.api[r.api!])}
        </ul>
      )}
    </section>
  );
}
