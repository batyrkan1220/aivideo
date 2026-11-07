import Link from "next/link";
import { Logo } from "@/components/logo";
import { kk } from "@/lib/i18n/kk";
import { PendingTelegramLogin } from "@/components/pending-telegram-login";

// Same "Soft Neo" look as the site: cream canvas, white cards, obsidian text, chartreuse and pastel accents.
const STEP_TINT = ["bg-peach", "bg-lavender", "bg-rose"];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="theme-app theme-mono relative min-h-dvh overflow-hidden bg-paper text-ink">
      {/* Soft colour behind the content, like the home hero. */}
      <div className="pointer-events-none absolute -left-32 -top-40 h-96 w-96 rounded-full bg-brand/35 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-lavender blur-3xl" aria-hidden />

      <header className="relative mx-auto flex max-w-6xl items-center justify-between px-4 pt-[max(1.25rem,env(safe-area-inset-top))] sm:px-6">
        <Link href="/" aria-label={kk.brand.name}><Logo className="text-xl" /></Link>
        <Link href="/" className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-semibold hover:border-ink">{kk.auth.toCatalog}</Link>
      </header>

      <PendingTelegramLogin />
      <div className="relative mx-auto grid max-w-6xl items-center gap-10 px-4 py-10 sm:px-6 md:min-h-[calc(100dvh-5rem)] md:grid-cols-[1fr_minmax(0,440px)] md:py-12">
        {/* What you get (tablet/desktop). */}
        <section className="hidden md:block">
          <span className="inline-flex items-center gap-2 rounded-full bg-surface px-3 py-1.5 text-xs font-semibold ring-1 ring-line">
            <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />{kk.auth.badge}
          </span>
          <p className="mt-5 max-w-lg font-display text-5xl font-extrabold leading-[1.05] tracking-tight">{kk.home.title}</p>
          <ol className="mt-8 grid max-w-lg gap-3">
            {kk.home.steps.map((s, i) => (
              <li key={s.t} className="flex items-start gap-4 rounded-card bg-surface p-4 ring-1 ring-line">
                <span className={`grid h-10 w-10 shrink-0 place-items-center rounded-full font-display text-lg font-extrabold ${STEP_TINT[i % STEP_TINT.length]}`}>{i + 1}</span>
                <span className="text-sm text-muted"><span className="block text-base font-semibold text-ink">{s.t}</span>{s.d}</span>
              </li>
            ))}
          </ol>
        </section>

        <section className="mx-auto w-full max-w-sm md:max-w-none">
          <div className="rounded-card border border-line bg-surface p-6 sm:p-8">{children}</div>
          <p className="mt-4 text-center text-xs text-muted">{kk.auth.safeNote}</p>
        </section>
      </div>
    </main>
  );
}
