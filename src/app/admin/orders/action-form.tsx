"use client";
import { useActionState } from "react";
import type { AdminState } from "./actions";

/** Small form for one privileged action: hidden fields, confirm dialog, result message. */
export function ActionForm({
  action, fields, label, confirm, tone = "default", children,
}: {
  action: (s: AdminState, fd: FormData) => Promise<AdminState>;
  fields: Record<string, string>;
  label: string;
  confirm?: string;
  tone?: "default" | "danger";
  children?: React.ReactNode;
}) {
  const [state, run, pending] = useActionState(action, {});
  const cls = tone === "danger"
    ? "border-danger text-danger hover:bg-danger hover:text-white"
    : "border-ink hover:bg-ink hover:text-white";
  return (
    <form action={run} className="inline-flex flex-col gap-1">
      {Object.entries(fields).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <div className="flex items-center gap-2">
        {children}
        <button
          type="submit"
          disabled={pending}
          onClick={(e) => { if (confirm && !window.confirm(confirm)) e.preventDefault(); }}
          className={`rounded-full border px-4 py-2 text-sm font-semibold transition-colors disabled:opacity-50 ${cls}`}
        >
          {pending ? "…" : label}
        </button>
      </div>
      {state.ok && <span className="text-xs text-success" role="status">{state.ok}</span>}
      {state.error && <span className="text-xs text-danger" role="alert">{state.error}</span>}
    </form>
  );
}
