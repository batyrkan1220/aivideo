"use client";
import { Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

type Status = { generationStatus: string; progress: number | null; error: string | null };
const ACTIVE = ["queued", "processing", "postprocessing"];

/**
 * Polls the order status while generation is active and refreshes the page when the
 * state changes. Shows a progress bar only when the provider reports real progress.
 */
export function GenerationStatus({ orderId, initial }: { orderId: string; initial: Status }) {
  const router = useRouter();
  const [s, setS] = useState(initial);
  const last = useRef(initial.generationStatus);

  useEffect(() => {
    if (!ACTIVE.includes(s.generationStatus)) return;
    let stop = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/orders/${orderId}/status`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (stop) return;
          setS({ generationStatus: j.generationStatus, progress: j.progress, error: j.error });
          if (j.generationStatus !== last.current) {
            last.current = j.generationStatus;
            router.refresh();
          }
        }
      } catch { /* network blip: try again on next tick */ }
    };
    const t = setInterval(tick, 5000);
    void tick();
    return () => { stop = true; clearInterval(t); };
  }, [orderId, router, s.generationStatus]);

  if (!ACTIVE.includes(s.generationStatus)) return null;
  const text = s.generationStatus === "queued" ? kk.generation.waiting
    : s.generationStatus === "postprocessing" ? kk.generation.finishing : kk.generation.working;

  return (
    <section className="relative overflow-hidden rounded-card border border-line/80 bg-surface p-6" aria-live="polite">
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-brand/40 blur-3xl" aria-hidden />
      <h2 className="t-h3 relative flex items-center gap-2"><Sparkles size={18} className="text-brand-ink" aria-hidden />{kk.generation.title}</h2>
      <p className="t-small relative mt-1 text-muted">{text}</p>
      {s.progress !== null && s.generationStatus !== "queued" ? (
        <div className="mt-4">
          <div className="relative h-2.5 overflow-hidden rounded-full bg-mist" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-night transition-[width] duration-700 ease-[var(--ease-out)]" style={{ width: `${s.progress}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-muted">{kk.generation.progress(s.progress)}</p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-night border-t-transparent" aria-hidden />
          {kk.order.generation[s.generationStatus as keyof typeof kk.order.generation]}
        </div>
      )}
    </section>
  );
}
