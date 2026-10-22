"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

/** Polls our status endpoint (which reconciles with Tole) until the payment settles. */
export function ToleStatus({ paymentId, orderId, ready }: { paymentId: string; orderId: string; ready: boolean }) {
  const router = useRouter();
  const [done, setDone] = useState<null | "paid" | "failed">(null);

  useEffect(() => {
    let stop = false;
    let delay = 3_000;
    const tick = async () => {
      if (stop || document.hidden) { if (!stop) setTimeout(tick, delay); return; }
      try {
        const r = await fetch(`/api/payments/tole/${paymentId}`, { cache: "no-store" });
        if (r.ok) {
          const s = (await r.json()) as { status: string; ready: boolean };
          if (s.status === "succeeded") { setDone("paid"); router.push(`/orders/${orderId}`); return; }
          if (s.status === "failed" || s.status === "cancelled") { setDone("failed"); router.refresh(); return; }
          if (s.ready && !ready) { router.refresh(); return; }
        }
      } catch { /* network blip: keep polling */ }
      delay = Math.min(delay * 1.25, 10_000);
      if (!stop) setTimeout(tick, delay);
    };
    const t = setTimeout(tick, delay);
    return () => { stop = true; clearTimeout(t); };
  }, [paymentId, orderId, ready, router]);

  if (done === "failed") {
    return <p className="mt-4 text-center text-sm font-semibold text-danger" aria-live="polite">{kk.tole.failed}</p>;
  }
  if (done === "paid") {
    return (
      <p className="mt-4 flex items-center justify-center gap-2 text-sm font-semibold text-success" aria-live="polite">
        <Spinner className="text-success" />{kk.tole.paid}
      </p>
    );
  }
  return (
    <div className="mt-5 flex flex-col items-center gap-3 rounded-card bg-brand-soft/60 px-4 py-5 text-center" aria-live="polite" role="status">
      <Spinner className="h-8 w-8 text-brand" />
      <p className="text-sm font-medium text-ink">{ready ? kk.tole.waiting : kk.tole.preparing}</p>
    </div>
  );
}

function Spinner({ className = "" }: { className?: string }) {
  return (
    <svg className={`h-5 w-5 animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}
