import type { ComponentProps, ReactNode } from "react";

/** White card on the off-white canvas: a soft hairline and a layered ambient shadow; 16/24 px padding. interactive = lifts on hover. */
export function Card({ className = "", interactive = false, padded = true, ...rest }: ComponentProps<"div"> & { interactive?: boolean; padded?: boolean }) {
  return <div className={`rounded-card border border-line/70 bg-surface elev-sm ${padded ? "p-4 sm:p-6" : ""} ${interactive ? "lift" : ""} ${className}`} {...rest} />;
}

/** Card heading row: title, optional hint and an action on the right. */
export function CardHeader({ title, hint, action, step }: { title: ReactNode; hint?: ReactNode; action?: ReactNode; step?: number }) {
  return (
    <div className="mb-4 flex items-start gap-3">
      {step !== undefined && <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-ink text-sm font-bold text-paper shadow-[inset_0_1px_0_rgb(255_255_255/0.15)]">{step}</span>}
      <div className="min-w-0 flex-1">
        <h2 className="t-h3">{title}</h2>
        {hint && <p className="t-small mt-1 text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}
