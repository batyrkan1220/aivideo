import { kk } from "@/lib/i18n/kk";

/**
 * TrendMe mark: a rounded play button with speed lines (motion) and AI sparkles. Pure SVG, scales
 * with font-size. Black and white: lines, play button and sparkles in ink, the inner triangle in
 * the page colour. The app icons (src/app/icon.png, apple-icon.png, favicon.ico) are the same mark,
 * inverted on a black tile (scripts/make-icons.mjs).
 */
export function LogoMark({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="2 -1 60 56" fill="none" aria-hidden className={`h-[1.9em] w-auto shrink-0 ${className}`}>
      <g stroke="currentColor" strokeLinecap="round">
        <path d="M10 26h9M6 32h13M9 38h10M13 44h7" strokeWidth="3.2" />
        <circle cx="5" cy="26" r="1.7" fill="currentColor" stroke="none" />
      </g>
      <path d="M25.5 14.6c0-3.3 3.6-5.4 6.5-3.7l22.3 13.4c3 1.8 3 6.1 0 7.9L32 45.6c-2.9 1.7-6.5-.4-6.5-3.7z" transform="translate(-4 4)" fill="currentColor" stroke="currentColor" strokeWidth="3.6" strokeLinejoin="round" />
      <path d="M31.5 28.3c0-1.3 1.4-2.1 2.6-1.4l7.4 4.4c1.1.7 1.1 2.3 0 3l-7.4 4.4c-1.2.7-2.6-.1-2.6-1.4z" style={{ fill: "var(--logo-inner, #ffffff)" }} />
      <g fill="currentColor">
        <path d="M51 6.5c.4 2.6 1.6 3.8 4.2 4.2-2.6.4-3.8 1.6-4.2 4.2-.4-2.6-1.6-3.8-4.2-4.2 2.6-.4 3.8-1.6 4.2-4.2z" />
        <path d="M58 13.5c.25 1.6 1 2.35 2.6 2.6-1.6.25-2.35 1-2.6 2.6-.25-1.6-1-2.35-2.6-2.6 1.6-.25 2.35-1 2.6-2.6z" />
        <path d="M44.5 3c.2 1.2.8 1.8 2 2-1.2.2-1.8.8-2 2-.2-1.2-.8-1.8-2-2 1.2-.2 1.8-.8 2-2z" />
      </g>
    </svg>
  );
}

/** Mark + "TrendMe" wordmark in ink. Size it with a text-* class. */
export function Logo({ className = "", compact = false }: { className?: string; compact?: boolean }) {
  return (
    <span className={`inline-flex items-center gap-[0.35em] font-extrabold tracking-[-0.03em] text-[var(--logo-ink,#0e0e0e)] ${className}`}>
      <LogoMark />
      {!compact && (
        <span className="leading-none">
          TrendMe<span className="sr-only"> — {kk.brand.tagline}</span>
        </span>
      )}
    </span>
  );
}
