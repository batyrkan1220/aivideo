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
    let delay = 4_000;
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

  return (
    <p className="mt-4 text-center text-sm text-muted" aria-live="polite">
      {done === "paid" ? kk.tole.paid : done === "failed" ? kk.tole.failed : ready ? kk.tole.waiting : null}
    </p>
  );
}
