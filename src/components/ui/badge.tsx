import type { ReactNode } from "react";

type Tone = "neutral" | "brand" | "success" | "warning" | "danger" | "info" | "dark";
const tones: Record<Tone, string> = {
  neutral: "bg-mist text-ink",
  brand: "bg-brand text-night",
  success: "bg-success-soft text-success ring-1 ring-inset ring-current/15",
  warning: "bg-warning-soft text-warning ring-1 ring-inset ring-current/15",
  danger: "bg-danger-soft text-danger ring-1 ring-inset ring-current/15",
  info: "bg-info-soft text-info ring-1 ring-inset ring-current/15",
  dark: "bg-night text-white",
};

/** Small status pill. dot = a coloured dot before the text (live states). */
export function Badge({ tone = "neutral", dot = false, icon, children, className = "" }: { tone?: Tone; dot?: boolean; icon?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <span className={`t-micro inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 ${tones[tone]} ${className}`}>
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current" aria-hidden />}
      {icon}
      {children}
    </span>
  );
}
