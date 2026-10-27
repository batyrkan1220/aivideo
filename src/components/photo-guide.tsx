import { kk } from "@/lib/i18n/kk";
import type { Framing } from "@/lib/uploads/photo-quality";

const g = kk.create.photoGuide;

/** Simple line drawings (no real people): a head-and-shoulders figure with variations. */
function Figure({ kind }: { kind: string }) {
  const head = <circle cx="24" cy="17" r="7.5" />;
  const body = <path d="M10 44c1.5-9 7-14 14-14s12.5 5 14 14" />;
  return (
    <svg viewBox="0 0 48 48" className="h-12 w-12" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      {kind === "group" ? (<>
        <circle cx="16" cy="18" r="6" /><path d="M5 43c1-7 5-11 11-11s10 4 11 11" />
        <circle cx="33" cy="18" r="6" /><path d="M22 43c1-7 5-11 11-11s10 4 11 11" />
      </>) : (<>{head}{body}</>)}
      {kind === "front" && <><circle cx="21.5" cy="16.5" r=".8" fill="currentColor" /><circle cx="26.5" cy="16.5" r=".8" fill="currentColor" /><path d="M21.5 20.5c1.5 1 3.5 1 5 0" /></>}
      {kind === "light" && <><path d="M40 6v4M44 10h-3M37 8l2 2" /><circle cx="40" cy="13" r="2.5" /></>}
      {kind === "glasses" && <><rect x="16" y="14" width="6.5" height="4.5" rx="1.5" fill="currentColor" /><rect x="25.5" y="14" width="6.5" height="4.5" rx="1.5" fill="currentColor" /><path d="M22.5 16h3" /></>}
      {kind === "dark" && <path d="M6 6l36 36" strokeDasharray="3 3" opacity=".6" />}
      {kind === "filter" && <><path d="M15 9l2 3M33 9l-2 3" /><path d="M17 12a3 3 0 0 1-3-3M31 12a3 3 0 0 0 3-3" /><path d="M36 30l3-3 3 3-3 3z" fill="currentColor" /></>}
    </svg>
  );
}

/** Shows which part of the body the photo must include for this template. */
function FramingPic({ framing }: { framing: Framing }) {
  const box = framing === "face" ? { y: 2, h: 22 } : framing === "half" ? { y: 2, h: 36 } : framing === "full" ? { y: 2, h: 76 } : { y: 2, h: 36 };
  return (
    <svg viewBox="0 0 40 80" className="h-20 w-10 shrink-0 text-ink" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" aria-hidden>
      <circle cx="20" cy="9" r="5" /><path d="M11 30c0-7 4-11 9-11s9 4 9 11v12M11 30v12M15 42v34M25 42v34M15 58h10" opacity=".55" />
      <rect x="4" y={box.y} width="32" height={box.h} rx="4" className="text-brand" stroke="currentColor" strokeDasharray={framing === "auto" ? "3 3" : undefined} strokeWidth={2} />
    </svg>
  );
}

export function PhotoGuide({ framing = "auto" }: { framing?: Framing }) {
  return (
    <div className="mt-3 rounded-xl border border-line bg-paper/60 p-3 sm:p-4">
      <p className="font-semibold">📸 {g.title}</p>
      <p className="mt-1 text-sm text-muted">{g.lead}</p>
      <div className="mt-3 flex items-center gap-3 rounded-xl bg-white p-3 ring-1 ring-brand/30">
        <FramingPic framing={framing} />
        <div className="min-w-0">
          <span className="inline-block rounded-full bg-brand-soft px-2.5 py-0.5 text-xs font-semibold text-brand">{g.framingLabel[framing]}</span>
          <p className="mt-1 text-sm font-medium leading-snug">{g.framing[framing]}</p>
        </div>
      </div>
      <ul className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        {g.cards.map((c) => (
          <li key={c.icon} className={`relative rounded-xl border bg-white p-2.5 ${c.ok ? "border-emerald-200" : "border-red-200"}`}>
            <span className={`absolute right-2 top-2 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-bold text-white ${c.ok ? "bg-success" : "bg-danger"}`} aria-label={c.ok ? g.good : g.bad}>{c.ok ? "✓" : "✕"}</span>
            <span className={c.ok ? "text-success" : "text-danger"}><Figure kind={c.icon} /></span>
            <p className="mt-1 text-sm font-semibold leading-tight">{c.title}</p>
            <p className="mt-0.5 text-xs leading-snug text-muted">{c.text}</p>
          </li>
        ))}
      </ul>
      <details className="group mt-3">
        <summary className="cursor-pointer list-none text-sm font-semibold text-brand">
          <span className="group-open:hidden">＋ </span><span className="hidden group-open:inline">− </span>{g.moreTitle}
        </summary>
        <ul className="mt-2 space-y-1.5 text-sm text-muted">
          {g.more.map((t) => <li key={t} className="flex gap-2"><span className="text-success">✓</span><span>{t}</span></li>)}
        </ul>
      </details>
    </div>
  );
}
