import { kk } from "@/lib/i18n/kk";

/**
 * TrendMe mark: obsidian squircle, a chartreuse play triangle (video) and a white AI sparkle.
 * Pure SVG, scales with font-size (1.9em square).
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 64 64" aria-hidden className={`h-[1.9em] w-[1.9em] shrink-0 ${className}`}>
      <rect width="64" height="64" rx="18" fill="#161616" />
      <path d="M24 19.5c0-2.3 2.5-3.7 4.5-2.5l17.2 10.5c1.9 1.2 1.9 3.9 0 5.1L28.5 43.1c-2 1.2-4.5-.2-4.5-2.5z" fill="#D7F443" transform="translate(-2 2)" />
      <path d="M48 9.5c.5 3.6 2.4 5.5 6 6-3.6.5-5.5 2.4-6 6-.5-3.6-2.4-5.5-6-6 3.6-.5 5.5-2.4 6-6z" fill="#fff" />
    </svg>
  );
}

/** Mark + wordmark: "Trend" in ink, "Me" on a chartreuse pill. Size it with a text-* class. */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[0.45em] font-extrabold tracking-[-0.03em] ${className}`}>
      <LogoMark />
      {!compact && (
        <span className="inline-flex items-center leading-none text-ink">
          Trend
          <span className="ml-[0.08em] rounded-[0.32em] bg-[#d7f443] px-[0.24em] pb-[0.08em] pt-[0.06em] text-[#161616]">Me</span>
          <span className="sr-only"> — {kk.brand.tagline}</span>
        </span>
      )}
    </span>
  );
}
