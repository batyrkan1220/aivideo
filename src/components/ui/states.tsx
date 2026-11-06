import type { ReactNode } from "react";

/** Loading placeholder block. */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`skeleton rounded-2xl ${className}`} aria-hidden />;
}

/** Grid of card placeholders (catalog, orders) while data loads. */
export function CardGridSkeleton({ count = 6, aspect = "aspect-[3/4]" }: { count?: number; aspect?: string }) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4" role="status" aria-label="Загрузка">
      {Array.from({ length: count }, (_, i) => <Skeleton key={i} className={`${aspect} rounded-[1.25rem]`} />)}
    </div>
  );
}

/** Nothing here yet: icon, title, one line and the next action. */
export function EmptyState({ icon, title, text, action }: { icon?: ReactNode; title: ReactNode; text?: ReactNode; action?: ReactNode }) {
  return (
    <div className="animate-fade-up rounded-card border border-dashed border-line-strong bg-surface/60 px-6 py-12 text-center">
      {icon && <div className="mx-auto mb-4 grid h-14 w-14 place-items-center rounded-full bg-mist text-ink">{icon}</div>}
      <h2 className="t-h3">{title}</h2>
      {text && <p className="t-small mx-auto mt-2 max-w-sm text-muted">{text}</p>}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

type Tone = "info" | "success" | "warning" | "danger";
const tones: Record<Tone, string> = {
  info: "bg-info-soft text-info",
  success: "bg-success-soft text-success",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

/** Inline message: info, success, warning or error. */
export function Alert({ tone = "info", icon, title, children }: { tone?: Tone; icon?: ReactNode; title?: ReactNode; children?: ReactNode }) {
  return (
    <div role={tone === "danger" ? "alert" : "status"} className={`flex gap-3 rounded-2xl p-4 ${tones[tone]}`}>
      {icon && <span className="mt-0.5 shrink-0">{icon}</span>}
      <div className="t-small min-w-0">
        {title && <p className="font-bold">{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}

/** Hover/focus hint (CSS only). */
export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <span className="group relative inline-flex">
      {children}
      <span role="tooltip" className="t-micro pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-night px-2.5 py-1.5 text-white opacity-0 shadow-lg transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
        {label}
      </span>
    </span>
  );
}
