import { kk } from "@/lib/i18n/kk";

/** TrendMe mark: white Unbounded "T" on brand violet with the flash-yellow dot. Pure CSS, scales with font-size. */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={`relative inline-flex aspect-square h-[1.9em] shrink-0 items-center justify-center rounded-[0.5em] bg-brand font-display font-extrabold leading-none text-white ${className}`}
    >
      <span className="-translate-x-[0.03em] -translate-y-[0.04em] text-[1.1em]">T</span>
      <span className="absolute left-[62%] top-[59%] h-[0.23em] w-[0.23em] rounded-full bg-flash" />
    </span>
  );
}

/** Mark + wordmark ("Trend" ink, "Me" brand). Size it with a text-* class. */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[0.45em] font-display font-bold tracking-tight ${className}`}>
      <LogoMark />
      {!compact && (
        <span>
          Trend<span className="text-brand">Me</span>
          <span className="sr-only"> — {kk.brand.tagline}</span>
        </span>
      )}
    </span>
  );
}
