import Link from "next/link";

/** Shared admin building blocks: page header, cards, stat tiles, chips, badges. */

export function PageHead({ title, lead, children }: { title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-2xl font-extrabold tracking-tight">{title}</h1>
        {lead && <p className="mt-1 max-w-2xl text-sm text-muted">{lead}</p>}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2">{children}</div>}
    </div>
  );
}

export function Card({ title, action, children, className = "" }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`rounded-2xl border border-line bg-white p-5 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-3">
          {title && <h2 className="font-bold">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

type Tone = "default" | "good" | "bad" | "warn" | "dark";
const TONES: Record<Tone, string> = {
  default: "bg-white border-line",
  good: "bg-emerald-50 border-emerald-200",
  bad: "bg-red-50 border-red-200",
  warn: "bg-amber-50 border-amber-200",
  dark: "bg-night border-night text-white",
};

export function Stat({ label, value, sub, tone = "default", href }: { label: string; value: React.ReactNode; sub?: React.ReactNode; tone?: Tone; href?: string }) {
  const body = (
    <>
      <p className={`text-xs font-medium ${tone === "dark" ? "text-white/60" : "text-muted"}`}>{label}</p>
      <p className="mt-1 text-2xl font-extrabold tracking-tight">{value}</p>
      {sub && <p className={`mt-0.5 text-xs ${tone === "dark" ? "text-white/60" : "text-muted"}`}>{sub}</p>}
    </>
  );
  const cls = `block rounded-2xl border p-4 ${TONES[tone]}`;
  return href ? <Link href={href} className={`${cls} transition-colors hover:border-ink`}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function Chips({ items, active }: { items: { href: string; label: string; count?: number; key: string }[]; active: string }) {
  return (
    <div className="no-scrollbar -mx-4 mb-4 flex gap-1.5 overflow-x-auto px-4 sm:mx-0 sm:flex-wrap sm:px-0">
      {items.map((c) => (
        <Link key={c.key} href={c.href} scroll={false}
          className={`flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-semibold transition-colors ${active === c.key ? "bg-night text-white" : "border border-line bg-white text-ink hover:border-ink"}`}>
          {c.label}
          {c.count !== undefined && <span className={`rounded-full px-1.5 text-xs ${active === c.key ? "bg-white/15" : "bg-paper text-muted"}`}>{c.count}</span>}
        </Link>
      ))}
    </div>
  );
}

const BADGE: Record<string, string> = {
  green: "bg-emerald-100 text-emerald-800",
  red: "bg-red-100 text-red-700",
  amber: "bg-amber-100 text-amber-800",
  blue: "bg-blue-100 text-blue-800",
  gray: "bg-paper text-muted ring-1 ring-line",
  lime: "bg-brand text-night",
};

export function Badge({ color = "gray", children }: { color?: keyof typeof BADGE; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${BADGE[color]}`}>{children}</span>;
}

/** Order status → one human label + color. */
export function orderState(payment: string, generation: string, amountKzt: number, providers: string[] = []) {
  if (payment === "refunded") return { label: "Возврат", color: "gray" as const };
  if (payment === "failed" || payment === "cancelled") return { label: "Оплата не прошла", color: "red" as const };
  if (payment === "pending") return { label: "Ждёт оплаты", color: "amber" as const };
  const free = providers.includes("free");
  const tag = free ? " · бесплатно" : providers.some((p) => p === "sandbox" || p === "tole_sandbox") ? " · тест" : "";
  if (generation === "completed") return { label: `Готово${tag}`, color: "green" as const };
  if (generation === "failed") return { label: `Ошибка генерации${tag}`, color: "red" as const };
  if (generation === "cancelled") return { label: `Остановлено${tag}`, color: "gray" as const };
  void amountKzt;
  return { label: `В работе${tag}`, color: "blue" as const };
}

export const fmtDate = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Almaty" });
export const usd = (n: number) => `$${n.toFixed(2)}`;

/** Tolepay failure reasons in plain words. */
export const REASONS: Record<string, string> = {
  create_failed: "Счёт не создан (ошибка Tolepay / номер)",
  failed: "Оплата отклонена",
  cancelled: "Отменено клиентом",
  expired: "Счёт истёк",
  duplicate_charge_refund_required: "Двойное списание",
};

/** Request-time clock for server components (kept out of render bodies for the purity lint). */
export function nowMs(): number {
  return Date.now();
}
