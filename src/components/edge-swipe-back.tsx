"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronLeft } from "lucide-react";
import { backTarget } from "@/lib/nav-back";
import { haptic, launchInitData } from "@/lib/telegram/client";

let depth = -1; // pages opened inside the app since it started
let last = "";
const TRIGGER = 80;

/**
 * Swipe from the left edge to go back (iOS-style) — in the Telegram Mini App and in the installed
 * app (home-screen PWA), where there is no browser gesture for it. Normal browsers keep their own.
 * A round arrow follows the finger; letting go past the threshold goes back.
 */
export function EdgeSwipeBack() {
  const router = useRouter();
  const path = usePathname();
  const [dx, setDx] = useState(0);
  const st = useRef<{ x: number; y: number; on: boolean } | null>(null);
  const dxRef = useRef(0);

  useEffect(() => { if (path !== last) { last = path; depth++; } }, [path]);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;
    if (!window.matchMedia("(pointer: coarse)").matches || !(launchInitData() || standalone)) return;

    const down = (e: TouchEvent) => {
      const t = e.touches[0];
      st.current = t.clientX <= 22 && backTarget(window.location.pathname) ? { x: t.clientX, y: t.clientY, on: false } : null;
    };
    const move = (e: TouchEvent) => {
      const s = st.current;
      if (!s) return;
      const t = e.touches[0];
      const mx = t.clientX - s.x, my = t.clientY - s.y;
      if (!s.on) {
        if (Math.abs(my) > 14 && Math.abs(my) > mx) { st.current = null; return; }
        if (mx > 10) s.on = true; else return;
      }
      if (e.cancelable) e.preventDefault();
      const v = Math.max(0, mx);
      if ((dxRef.current < TRIGGER) !== (v < TRIGGER) && v >= TRIGGER) haptic("select");
      dxRef.current = v;
      setDx(v);
    };
    const up = () => {
      const s = st.current;
      st.current = null;
      const v = dxRef.current;
      dxRef.current = 0;
      setDx(0);
      if (!s?.on || v < TRIGGER) return;
      const parent = backTarget(window.location.pathname);
      if (!parent) return;
      if (depth > 0) { depth = Math.max(0, depth - 2); router.back(); } else router.replace(parent);
    };
    window.addEventListener("touchstart", down, { passive: true });
    window.addEventListener("touchmove", move, { passive: false });
    window.addEventListener("touchend", up, { passive: true });
    window.addEventListener("touchcancel", up, { passive: true });
    return () => {
      window.removeEventListener("touchstart", down);
      window.removeEventListener("touchmove", move);
      window.removeEventListener("touchend", up);
      window.removeEventListener("touchcancel", up);
    };
  }, [router]);

  if (!dx) return null;
  const p = Math.min(dx / TRIGGER, 1);
  return (
    <span aria-hidden className="pointer-events-none fixed left-0 top-1/2 z-[90] flex h-11 w-11 items-center justify-center rounded-full bg-ink text-paper shadow-lg"
      style={{ transform: `translate(${Math.min(dx, TRIGGER + 20) * 0.6 - 30}px,-50%) scale(${0.6 + p * 0.4})`, opacity: 0.3 + p * 0.7 }}>
      <ChevronLeft size={22} strokeWidth={2.4} />
    </span>
  );
}
