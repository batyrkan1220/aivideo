import { Suspense } from "react";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { botUsername } from "@/lib/partners";

export const metadata = { title: kk.nav.support };

const S = kk.support;

/** Support: how to reach us (the Telegram bot) and answers to the common questions. */
export default function SupportPage() {
  return (
    <main className="mx-auto max-w-xl px-4 pb-6 pt-4 sm:pt-12">
      <section className="rounded-[24px] bg-night p-5 text-white">
        <span className="section-title text-lime">{S.eyebrow}</span>
        <h1 className="mt-1.5 text-[26px] font-extrabold leading-tight tracking-tight">{S.title}</h1>
        <p className="mt-1.5 text-sm text-white/70">{kk.legal.supportText}</p>
        <Suspense fallback={<div className="mt-4 h-11" />}>
          <Contact />
        </Suspense>
      </section>

      <h2 className="section-title mb-2 mt-6 px-1 text-muted">{S.faqTitle}</h2>
      <div className="divide-y divide-line overflow-hidden rounded-[20px] bg-surface ring-1 ring-line">
        {S.faq.map((f) => (
          <details key={f.q} className="group px-4 py-3.5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-3 text-[15px] font-semibold">
              {f.q}
              <span className="text-muted transition-transform group-open:rotate-45" aria-hidden>＋</span>
            </summary>
            <p className="mt-2 text-sm leading-relaxed text-muted">{f.a}</p>
          </details>
        ))}
      </div>
    </main>
  );
}

async function Contact() {
  await connection();
  const bot = await botUsername().catch(() => null);
  if (!bot) return null;
  return (
    <a href={`https://t.me/${bot}`} target="_blank" rel="noopener noreferrer" className="btn-glow mt-4 inline-flex h-11 items-center gap-2 rounded-full px-5 text-sm font-bold">
      ✈️ {S.write} @{bot}
    </a>
  );
}
