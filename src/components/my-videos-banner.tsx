import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Home-page reminder so customers never lose their order: a ready video, one in progress,
 * or an unpaid order from the last day links straight to it.
 */
/** Picks the most relevant recent order (request-time helper; keeps the component pure). */
async function latestRelevantOrder() {
  const sb = await supabaseServer();
  const now = Date.now();
  const { data } = await sb.from("orders")
    .select("id,payment_status,generation_status,created_at,completed_at,template_snapshot_json")
    .gte("created_at", new Date(now - 7 * 864e5).toISOString()).order("created_at", { ascending: false }).limit(5);
  const orders = data ?? [];
  const working = orders.find((o) => o.payment_status === "succeeded" && ["queued", "processing", "postprocessing"].includes(o.generation_status));
  const ready = orders.find((o) => o.generation_status === "completed");
  const unpaid = orders.find((o) => o.generation_status === "awaiting_payment" && ["pending", "failed", "cancelled"].includes(o.payment_status) &&
    now - new Date(o.created_at).getTime() < 864e5);
  return working ? { o: working, text: kk.myVideos.workingBanner, cta: kk.myVideos.open, cls: "bg-brand-soft" }
    : ready ? { o: ready, text: kk.myVideos.readyBanner, cta: kk.myVideos.watch, cls: "bg-emerald-50" }
    : unpaid ? { o: unpaid, text: kk.myVideos.unpaidBanner, cta: kk.myVideos.pay, cls: "bg-flash/25" }
    : null;
}

export async function MyVideosBanner() {
  const user = await getSessionUser();
  if (!user) return null;
  const pick = await latestRelevantOrder();
  if (!pick) return null;
  const title = (pick.o.template_snapshot_json as { title_kk?: string }).title_kk;
  return (
    <div className="mx-auto mt-4 max-w-6xl px-4">
      <Link href={`/orders/${pick.o.id}`} className={`flex items-center justify-between gap-4 rounded-card px-5 py-4 ${pick.cls} hover:ring-1 hover:ring-ink/20`}>
        <span className="min-w-0">
          <span className="block font-semibold">{pick.text}</span>
          {title && <span className="block truncate text-sm text-muted">{title}</span>}
        </span>
        <span className="shrink-0 rounded-full bg-ink px-4 py-2 text-sm font-semibold text-white">{pick.cta} →</span>
      </Link>
    </div>
  );
}
