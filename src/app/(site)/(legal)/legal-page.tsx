import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { env } from "@/lib/env";
import { botUsername } from "@/lib/partners";
import { LEGAL_EDITION } from "@/lib/legal/company";
import type { LegalCtx, LegalDoc } from "@/lib/legal/docs";

const LINKS = [
  { href: "/terms", label: kk.footer.terms },
  { href: "/privacy", label: kk.footer.privacy },
  { href: "/refund", label: kk.footer.refund },
];

/** A legal document page: title, edition date, contents, sections. */
export function LegalPage({ path, doc }: { path: string; doc: (c: LegalCtx) => LegalDoc }) {
  return (
    <main className="mx-auto w-full max-w-3xl px-4 pb-16 pt-6 sm:px-6 sm:pt-12">
      <nav aria-label="Документы" className="-mx-1 mb-6 flex gap-2 overflow-x-auto px-1 pb-1">
        {LINKS.map((l) => (
          <Link key={l.href} href={l.href} aria-current={l.href === path ? "page" : undefined}
            className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm transition-colors ${l.href === path ? "border-ink bg-ink text-paper" : "border-line bg-surface text-muted hover:border-ink hover:text-ink"}`}>
            {l.label}
          </Link>
        ))}
      </nav>
      <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
        <Doc doc={doc} />
      </Suspense>
    </main>
  );
}

async function Doc({ doc }: { doc: (c: LegalCtx) => LegalDoc }) {
  await connection();
  const e = env();
  const bot = await botUsername().catch(() => null);
  const d = doc({ uploadDays: e.UPLOAD_RETENTION_DAYS, videoDays: e.VIDEO_RETENTION_DAYS, site: "trendme.kz", bot });
  return (
    <article>
      <h1 className="font-display text-[1.75rem] leading-tight sm:text-4xl">{d.title}</h1>
      <p className="mt-2 text-sm text-muted">Редакция от {LEGAL_EDITION}</p>
      <p className="mt-5 text-[15px] leading-relaxed">{d.lead}</p>

      <details className="mt-6 rounded-card border border-line/80 bg-surface px-4 py-3 sm:px-5">
        <summary className="cursor-pointer text-sm font-semibold">Содержание</summary>
        <ol className="mt-2 space-y-1 text-sm">
          {d.sections.map((s, i) => (
            <li key={s.h}><a href={`#s${i + 1}`} className="text-muted underline-offset-4 hover:text-ink hover:underline">{s.h}</a></li>
          ))}
        </ol>
      </details>

      <div className="mt-8 space-y-8">
        {d.sections.map((s, i) => (
          <section key={s.h} id={`s${i + 1}`} className="scroll-mt-20">
            <h2 className="font-display text-lg leading-snug sm:text-xl">{s.h}</h2>
            <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-ink/85">
              {s.body.map((b, j) => "p" in b
                ? <p key={j}>{b.p}</p>
                : <ul key={j} className="list-disc space-y-1.5 pl-5 marker:text-muted">{b.ul.map((li) => <li key={li}>{li}</li>)}</ul>)}
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}
