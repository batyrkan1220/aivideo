"use client";
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
    <section className="rounded-card border border-line bg-surface p-5 sm:p-6" aria-live="polite">
      <h2 className="font-semibold">{kk.generation.title}</h2>
      <p className="mt-1 text-sm text-muted">{text}</p>
      {s.progress !== null && s.generationStatus !== "queued" ? (
        <div className="mt-4">
          <div className="h-2.5 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={s.progress} aria-valuemin={0} aria-valuemax={100}>
            <div className="h-full rounded-full bg-brand transition-[width] duration-700" style={{ width: `${s.progress}%` }} />
          </div>
          <p className="mt-1 text-right text-xs text-muted">{kk.generation.progress(s.progress)}</p>
        </div>
      ) : (
        <div className="mt-4 flex items-center gap-3 text-sm text-muted">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand border-t-transparent" aria-hidden />
          {kk.order.generation[s.generationStatus as keyof typeof kk.order.generation]}
        </div>
      )}
    </section>
  );
}
