"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { haptic } from "@/lib/telegram/client";
import { kk } from "@/lib/i18n/kk";

type Neighbor = { id: string; title: string; cover: string | null };
const HINT_KEY = "trendme.swipeHint";

/**
 * Swipe between templates on the template page (like Reels): drag the sample left → next video,
 * right → previous. Vertical scrolling stays native (touch-action: pan-y). Desktop: side arrows
 * and the ← / → keys. Neighbours are prefetched; the page is replaced (Back returns to the feed).
 */
export function TemplateSwipe({ prev, next, children }: { prev: Neighbor; next: Neighbor; children: React.ReactNode }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const start = useRef<{ x: number; y: number; t: number; locked: "x" | "y" | null } | null>(null);
  const [dx, setDx] = useState(0);
  const [leaving, setLeaving] = useState<"prev" | "next" | null>(null);
  const [hint, setHint] = useState(false);

  useEffect(() => {
    router.prefetch(`/templates/${next.id}`);
    router.prefetch(`/templates/${prev.id}`);
    // Warm the neighbours' covers so the next page paints at once.
    for (const n of [next, prev]) if (n.cover) { const i = new Image(); i.src = n.cover; }
  }, [router, next, prev]);

  // One-time hint on touch screens.
  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) return;
    try { if (localStorage.getItem(HINT_KEY)) return; localStorage.setItem(HINT_KEY, "1"); } catch { return; }
    const on = setTimeout(() => setHint(true), 900);
    const off = setTimeout(() => setHint(false), 4200);
    return () => { clearTimeout(on); clearTimeout(off); };
  }, []);

  const go = (dir: "prev" | "next") => {
    if (leaving) return;
    haptic("select");
    setLeaving(dir);
    router.replace(`/templates/${(dir === "next" ? next : prev).id}`, { scroll: true });
  };

  // Keyboard (desktop), ignored while typing.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      if (e.key === "ArrowRight") go("next");
      if (e.key === "ArrowLeft") go("prev");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    // Leave the screen edges to the system / swipe-back gesture.
    if (t.clientX < 24 || t.clientX > window.innerWidth - 24) { start.current = null; return; }
    start.current = { x: t.clientX, y: t.clientY, t: Date.now(), locked: null };
  };
  const onTouchMove = (e: React.TouchEvent) => {
    const s = start.current;
    if (!s) return;
    const t = e.touches[0];
    const mx = t.clientX - s.x, my = t.clientY - s.y;
    if (!s.locked && Math.hypot(mx, my) > 10) s.locked = Math.abs(mx) > Math.abs(my) * 1.2 ? "x" : "y";
    if (s.locked === "x") setDx(mx);
  };
  const onTouchEnd = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.locked !== "x") { setDx(0); return; }
    const fast = Math.abs(dx) / Math.max(1, Date.now() - s.t) > 0.5;
    if (Math.abs(dx) > 70 || (fast && Math.abs(dx) > 30)) go(dx < 0 ? "next" : "prev");
    else setDx(0);
  };

  const shift = leaving ? (leaving === "next" ? -60 : 60) : dx * 0.55;
  const arrow = "absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full border border-line bg-surface/90 text-ink shadow-[0_8px_24px_-12px_rgb(0_0_0/0.4)] backdrop-blur transition-transform hover:scale-105 md:flex";

  return (
    <div className="relative">
      <div
        ref={box}
        onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} onTouchCancel={onTouchEnd}
        style={{ transform: `translate3d(${shift}px,0,0)`, opacity: leaving ? 0.35 : 1 - Math.min(Math.abs(dx) / 600, 0.35), transition: dx && !leaving ? "none" : "transform .28s cubic-bezier(.2,.8,.2,1), opacity .28s" }}
        className="touch-pan-y select-none"
      >
        {children}
      </div>

      {/* Which way the drag leads */}
      {Math.abs(dx) > 30 && !leaving && (
        <span className={`pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 rounded-full bg-ink px-3 py-1.5 text-xs font-semibold text-paper ${dx < 0 ? "right-2" : "left-2"}`}>
          {dx < 0 ? `${kk.template.swipeNext} →` : `← ${kk.template.swipePrev}`}
        </span>
      )}

      <button type="button" onClick={() => go("prev")} aria-label={`${kk.template.swipePrev}: ${prev.title}`} title={prev.title} className={`${arrow} -left-5`}>
        <ChevronLeft size={20} aria-hidden />
      </button>
      <button type="button" onClick={() => go("next")} aria-label={`${kk.template.swipeNext}: ${next.title}`} title={next.title} className={`${arrow} -right-5`}>
        <ChevronRight size={20} aria-hidden />
      </button>

      {hint && (
        <span role="status" className="pointer-events-none absolute inset-x-0 bottom-4 z-10 mx-auto flex w-fit items-center gap-2 rounded-full bg-ink/85 px-4 py-2 text-xs font-medium text-paper backdrop-blur">
          <span className="animate-[tm-swipe_1.4s_ease-in-out_infinite]" aria-hidden>👆</span>{kk.template.swipeHint}
        </span>
      )}
    </div>
  );
}
