import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

/**
 * Buttons. primary = obsidian pill (turns chartreuse on dark cards), lime = chartreuse,
 * secondary = white with a hairline, ghost = text only, danger = destructive.
 * Heights follow the 8pt grid: sm 32 · md 40 · lg 52 (thumb-friendly on phones).
 */
type Variant = "primary" | "lime" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

const base =
  "inline-flex select-none items-center justify-center gap-2 rounded-full font-semibold whitespace-nowrap " +
  "transition-[background-color,border-color,color,box-shadow,transform] duration-200 ease-[var(--ease-out)] " +
  "active:scale-[0.98] disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-offset-2";
const variants: Record<Variant, string> = {
  primary: "btn-glow",
  lime: "btn-lime",
  secondary: "border border-line bg-surface text-ink elev-xs hover:border-line-strong hover:bg-mist",
  ghost: "text-ink hover:bg-mist",
  danger: "bg-danger text-white hover:brightness-110",
};
const sizes: Record<Size, string> = { sm: "h-8 px-4 text-sm", md: "h-10 px-5 text-sm", lg: "h-13 px-7 text-base" };

export function buttonClass(variant: Variant = "primary", size: Size = "md", extra = "") {
  return `${base} ${variants[variant]} ${sizes[size]} ${extra}`;
}

function Spinner() {
  return <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden />;
}

export function Button({
  variant = "primary", size = "md", className = "", loading = false, icon, children, disabled, ...rest
}: ComponentProps<"button"> & { variant?: Variant; size?: Size; loading?: boolean; icon?: ReactNode }) {
  return (
    <button className={buttonClass(variant, size, className)} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  );
}

export function ButtonLink({
  variant = "primary", size = "md", className = "", icon, children, ...rest
}: ComponentProps<typeof Link> & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return <Link className={buttonClass(variant, size, className)} {...rest}>{icon}{children}</Link>;
}
