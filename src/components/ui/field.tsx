import type { ComponentProps, ReactNode } from "react";

/** Text input: 48 px tall, white field, soft hairline, a clear ink focus ring, red when invalid. */
export const inputClass = (invalid = false) =>
  "h-12 w-full rounded-2xl border bg-surface px-4 text-base text-ink shadow-[inset_0_1px_2px_rgb(14_14_14/0.04)] placeholder:text-faint outline-none " +
  "transition-[border-color,box-shadow] duration-200 hover:border-line-strong focus:shadow-[0_0_0_4px_rgb(14_14_14/0.08)] focus-visible:outline-none " +
  (invalid ? "border-danger focus:border-danger focus:shadow-[0_0_0_4px_rgb(159_29_19/0.12)]" : "border-line focus:border-ink");

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={htmlFor} className="t-small font-semibold text-ink">{label}</label>
      {children}
      {error ? <p role="alert" className="t-small text-danger">{error}</p> : hint ? <p className="t-small text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ invalid = false, className = "", ...rest }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={`${inputClass(invalid)} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}
