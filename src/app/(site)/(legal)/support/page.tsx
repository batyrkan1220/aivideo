import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronDown, ChevronRight, Clapperboard, FileText, MessageCircle, Send, Undo2 } from "lucide-react";
import { kk } from "@/lib/i18n/kk";
import { botUsername } from "@/lib/partners";
import { COMPANY } from "@/lib/legal/company";

export const metadata = { title: kk.nav.support };

const S = kk.support;

/** Support: how to reach us (the Telegram bot), quick links and answers to the common questions. */
export default function SupportPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-10 pt-4 sm:pt-10 md:max-w-5xl md:px-6 md:pb-16 lg:px-8">
      <div className="grid gap-x-8 md:grid-cols-[360px_minmax(0,1fr)] md:items-start lg:grid-cols-[400px_minmax(0,1fr)]">
        <aside className="md:sticky md:top-20">
          {/* Contact */}
          <section className="relative overflow-hidden rounded-card border border-line/80 bg-surface p-5 elev-sm sm:p-7">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-mist to-transparent" aria-hidden />
            <div className="relative">
              <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-ink text-paper" aria-hidden>
                <MessageCircle size={22} strokeWidth={2} />
              </span>
              <p className="t-eyebrow mt-4 text-muted">{S.eyebrow}</p>
              <h1 className="mt-1 font-display text-[1.75rem] leading-tight">{S.title}</h1>
              <p className="mt-2 text-[15px] leading-relaxed text-muted">{S.lead}</p>
              <Suspense fallback={<div className="mt-5 h-12 rounded-full bg-mist" />}>
                <Contact />
              </Suspense>
              <div className="mt-4 rounded-2xl bg-mist/70 px-4 py-3 text-sm">
                <p className="font-medium">{S.tip}</p>
                <p className="mt-1 text-muted">{S.tipExample} <span className="rounded-md bg-surface px-1.5 py-0.5 font-mono text-[13px] text-ink ring-1 ring-line">TM-100050</span></p>
              </div>
            </div>
          </section>

          {/* Quick links */}
          <h2 className="t-eyebrow mb-2.5 mt-6 px-1 text-muted">{S.quickTitle}</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">
            <Quick href="/orders" icon={Clapperboard} title={S.quick.orders.t} hint={S.quick.orders.d} />
            <Quick href="/refund" icon={Undo2} title={S.quick.refund.t} hint={S.quick.refund.d} />
            <Quick href="/terms" icon={FileText} title={S.quick.terms.t} hint={S.quick.terms.d} />
          </ul>
        </aside>

        {/* FAQ */}
        <div className="mt-8 min-w-0 md:mt-0">
          <h2 className="t-eyebrow mb-2.5 px-1 text-muted">{S.faqTitle}</h2>
          <div className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">
            {S.faq.map((f, i) => (
              <details key={f.q} open={i === 0} className="group">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-4 px-4 py-3.5 text-[15px] font-medium transition-colors hover:bg-mist/50 sm:px-5 [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown size={18} className="shrink-0 text-muted transition-transform duration-200 group-open:rotate-180" aria-hidden />
                </summary>
                <p className="px-4 pb-4 text-[15px] leading-relaxed text-muted sm:px-5">{f.a}</p>
              </details>
            ))}
          </div>

          <section className="mt-6 flex flex-col items-start gap-3 rounded-card bg-ink p-5 text-paper sm:flex-row sm:items-center sm:justify-between sm:p-6">
            <div>
              <p className="font-display text-lg">{S.stillTitle}</p>
              <p className="mt-1 text-sm text-paper/70">{S.stillText}</p>
            </div>
            <Suspense fallback={null}>
              <Contact light />
            </Suspense>
          </section>

          {COMPANY.name && (
            <p className="mt-6 px-1 text-xs leading-relaxed text-muted">
              {S.requisites}: {COMPANY.name}, ИИН {COMPANY.idNumber}{COMPANY.address ? `, ${COMPANY.address}` : ""}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}

function Quick({ href, icon: Icon, title, hint }: { href: string; icon: LucideIcon; title: string; hint: string }) {
  return (
    <li>
      <Link href={href} className="group flex min-h-14 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-mist/60 active:bg-mist sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mist text-ink" aria-hidden><Icon size={18} strokeWidth={1.9} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-tight">{title}</span>
          <span className="mt-0.5 block truncate text-xs text-muted">{hint}</span>
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

async function Contact({ light = false }: { light?: boolean }) {
  await connection();
  // The button must never disappear: if Telegram's getMe is unreachable, use the known bot name.
  const bot = (await botUsername().catch(() => null)) ?? "trendmebot";
  return (
    <a href={`https://t.me/${bot}?start=support`} target="_blank" rel="noopener noreferrer"
      className={light
        ? "inline-flex h-11 shrink-0 items-center gap-2 rounded-full bg-paper px-5 text-sm font-semibold text-ink transition-opacity hover:opacity-90"
        : "btn-glow mt-5 flex h-12 w-full items-center justify-center gap-2 rounded-full text-sm font-semibold"}>
      <Send size={16} strokeWidth={2.2} aria-hidden />{S.write}
    </a>
  );
}
