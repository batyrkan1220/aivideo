"use client";
import { useActionState } from "react";
import type { AuthState } from "./actions";
import { kk } from "@/lib/i18n/kk";

type Field = { name: string; label: string; type: string; autoComplete: string; minLength?: number };

export function AuthForm({
  action, fields, submitLabel, next,
}: {
  action: (s: AuthState, fd: FormData) => Promise<AuthState>;
  fields: Field[];
  submitLabel: string;
  next?: string;
}) {
  const [state, formAction, pending] = useActionState(action, {});
  return (
    <form action={formAction} className="space-y-4" noValidate>
      {next && <input type="hidden" name="next" value={next} />}
      {fields.map((f) => (
        <label key={f.name} className="block">
          <span className="mb-1 block text-sm font-medium text-ink">{f.label}</span>
          <input
            name={f.name}
            type={f.type}
            autoComplete={f.autoComplete}
            minLength={f.minLength}
            required
            className="w-full rounded-xl border border-line bg-white px-4 py-3 text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand/15"
          />
        </label>
      ))}
      <div aria-live="polite" className="min-h-5 text-sm">
        {state.error && <p className="text-danger">{state.error}</p>}
        {state.message && <p className="text-success">{state.message}</p>}
      </div>
      <button
        type="submit"
        disabled={pending}
        className="h-12 w-full rounded-full bg-brand px-4 font-semibold text-white transition-colors hover:bg-brand-dark disabled:opacity-60"
      >
        {pending ? kk.common.loading : submitLabel}
      </button>
    </form>
  );
}
