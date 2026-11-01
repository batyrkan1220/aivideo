"use client";
import { useEffect, useState } from "react";
import { kk } from "@/lib/i18n/kk";

const T = kk.create.photoGuide;

/** Simple drawn portraits (no real people): what a good and a bad reference photo looks like. */
function Face({ kind }: { kind: "front" | "single" | "covered" | "angle" }) {
  const skin = "#e9b99a", hair = "#2b211c";
  const bg = kind === "front" ? "#e3e6fd" : kind === "single" ? "#ddf3a5" : kind === "covered" ? "#cfd6dd" : "#fde1c8";
  return (
    <svg viewBox="0 0 100 100" className="h-full w-full" aria-hidden>
      <rect width="100" height="100" fill={bg} />
      {kind === "angle" ? (
        <g transform="rotate(-28 50 60)">
          <path d="M22 100c2-18 14-28 28-28s26 10 28 28z" fill="#3b4a6b" />
          <rect x="44" y="58" width="12" height="16" fill={skin} />
          <ellipse cx="58" cy="44" rx="15" ry="19" fill={skin} />
          <path d="M40 40c0-16 12-24 24-20 10 3 12 12 10 20-4-6-10-8-18-8-6 0-12 3-16 8z" fill={hair} />
          <circle cx="66" cy="45" r="1.8" fill="#222" />
        </g>
      ) : (
        <>
          <path d="M18 100c2-20 16-30 32-30s30 10 32 30z" fill={kind === "single" ? "#161616" : "#3b4a6b"} />
          <rect x="44" y="56" width="12" height="16" fill={skin} />
          <ellipse cx="50" cy="42" rx="17" ry="21" fill={skin} />
          <path d="M32 40c-1-17 9-26 19-26s20 8 18 26c-3-8-9-12-18-12s-15 4-19 12z" fill={hair} />
          <circle cx="43" cy="44" r="2" fill="#222" /><circle cx="57" cy="44" r="2" fill="#222" />
          <path d="M44 54c4 3 8 3 12 0" stroke="#a5644a" strokeWidth="2" fill="none" strokeLinecap="round" />
          {kind === "covered" && (
            <>
              <path d="M30 26c10-4 26-2 30 12 4 12-2 30-8 36-2-14-8-26-22-30z" fill={hair} />
              <rect x="44" y="47" width="20" height="9" rx="4.5" fill="#d9a887" transform="rotate(-12 54 51)" />
            </>
          )}
        </>
      )}
    </svg>
  );
}

/** Real example photos (AI-generated people) where we have them; a drawing otherwise. */
const EXAMPLES: { kind: "front" | "single" | "covered" | "angle"; good: boolean; photo?: string }[] = [
  { kind: "front", good: true, photo: "/photo-tips/front.jpg" },
  { kind: "single", good: true, photo: "/photo-tips/single.jpg" },
  { kind: "covered", good: false },
  { kind: "angle", good: false },
];

/** "How to get the perfect photo" banner + bottom sheet with good/bad examples and tips. */
export function PhotoTips({ initialOpen = false }: { initialOpen?: boolean }) {
  const [open, setOpen] = useState(initialOpen);
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => { document.body.style.overflow = prev; window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="mt-3 flex w-full items-center gap-3 rounded-2xl bg-[#fffbe6] p-3 text-left ring-1 ring-[#f0dc8a] transition-transform active:scale-[0.99]">
        <span className="text-2xl" aria-hidden>📸</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[14px] font-extrabold leading-tight">{T.banner}</span>
          <span className="block text-xs text-muted">{T.bannerSub}</span>
        </span>
        <span className="text-lg text-muted" aria-hidden>›</span>
      </button>

      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/50 sm:items-center" onClick={() => setOpen(false)} role="dialog" aria-modal aria-label={T.title}>
          <div onClick={(e) => e.stopPropagation()}
            className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-[28px] bg-surface p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl sm:rounded-[28px]">
            <div className="mx-auto mb-3 h-1.5 w-10 rounded-full bg-line sm:hidden" />
            <div className="flex items-start justify-between gap-3">
              <h2 className="text-xl font-extrabold tracking-tight">{T.title}</h2>
              <button type="button" onClick={() => setOpen(false)} aria-label={kk.common.close} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-paper text-muted">✕</button>
            </div>
            <p className="mt-1 text-sm text-muted">{T.lead}</p>

            <div className="mt-4 grid grid-cols-2 gap-x-3 text-xs font-bold">
              <span className="text-emerald-700">✓ {T.better}</span>
              <span className="text-red-600">✕ {T.worse}</span>
            </div>
            <div className="mt-2 grid grid-cols-4 gap-2">
              {EXAMPLES.map((x) => (
                <figure key={x.kind}>
                  <div className={`relative aspect-square overflow-hidden rounded-2xl ring-2 ${x.good ? "ring-emerald-400" : "ring-red-300"}`}>
                    {x.photo
                      // eslint-disable-next-line @next/next/no-img-element
                      ? <img src={x.photo} alt="" loading="lazy" className="h-full w-full object-cover" />
                      : <Face kind={x.kind} />}
                    <span className={`absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full text-[11px] font-black text-white ${x.good ? "bg-emerald-500" : "bg-red-500"}`}>{x.good ? "✓" : "✕"}</span>
                  </div>
                  <figcaption className="mt-1 text-[11px] leading-tight text-muted">{T.examples[x.kind]}</figcaption>
                </figure>
              ))}
            </div>

            <ul className="mt-4 space-y-2 text-sm">
              {T.rules.map((r) => <li key={r} className="flex gap-2"><span className="text-emerald-600" aria-hidden>●</span>{r}</li>)}
            </ul>

            <button type="button" onClick={() => setOpen(false)} className="btn-glow mt-5 h-12 w-full rounded-full text-[15px] font-extrabold">{T.ok}</button>
          </div>
        </div>
      )}
    </>
  );
}
