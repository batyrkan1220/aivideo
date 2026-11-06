import type { ComponentProps, ReactNode } from "react";

/** Text input: 48 px tall, cream inset, clear focus ring, red when invalid. */
export const inputClass = (invalid = false) =>
  "h-12 w-full rounded-2xl border bg-mist/60 px-4 text-base text-ink placeholder:text-faint outline-none " +
  "transition-[border-color,box-shadow,background-color] duration-200 focus:bg-surface focus:shadow-[0_0_0_4px_rgba(22,22,22,0.08)] " +
  (invalid ? "border-danger focus:border-danger" : "border-line focus:border-ink");

export function Field({ label, hint, error, children, htmlFor }: { label: ReactNode; hint?: ReactNode; error?: ReactNode; children: ReactNode; htmlFor?: string }) {
  return (
    <div className="grid gap-2">
      <label htmlFor={htmlFor} className="t-small font-semibold">{label}</label>
      {children}
      {error ? <p role="alert" className="t-small text-danger">{error}</p> : hint ? <p className="t-small text-muted">{hint}</p> : null}
    </div>
  );
}

export function Input({ invalid = false, className = "", ...rest }: ComponentProps<"input"> & { invalid?: boolean }) {
  return <input className={`${inputClass(invalid)} ${className}`} aria-invalid={invalid || undefined} {...rest} />;
}
