import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { mediaUrl } from "@/lib/templates/queries";

type Row = {
  id: string; public_order_number: string; created_at: string; amount_kzt: number;
  payment_status: string; generation_status: string; template_snapshot_json: unknown;
  templates: { cover_asset_path: string | null } | { cover_asset_path: string | null }[] | null;
};

const IMG = /\.(jpe?g|png|webp)$/i;

/**
 * The signed-in user's works as a gallery grid (RLS restricts the query to their own rows).
 * Finished photos show the result itself; videos show the template cover; status sits on the card.
 */
export async function OrderList({ limit = 50 }: { limit?: number }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json,templates(cover_asset_path)")
    .order("created_at", { ascending: false }).limit(limit);
  const orders = (data ?? []) as unknown as Row[];
  if (!orders.length) {
    return (
      <div className="rounded-[24px] bg-surface px-6 py-14 text-center ring-1 ring-line">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-brand text-2xl" aria-hidden>✨</span>
        <p className="mt-4 text-lg font-bold">{kk.gallery.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{kk.account.ordersEmpty}</p>
        <Link href="/" className="btn-glow mt-5 inline-flex h-11 items-center rounded-full px-6 text-sm font-bold">{kk.myVideos.browse}</Link>
      </div>
    );
  }

  // Finished results: which are photos (shown as the thumbnail itself, via a short-lived signed URL).
  const done = orders.filter((o) => o.generation_status === "completed").map((o) => o.id);
  const { data: files } = done.length
    ? await supabaseAdmin().from("generated_videos").select("order_id,private_storage_path").in("order_id", done)
    : { data: [] as { order_id: string; private_storage_path: string }[] };
  const photoPaths = (files ?? []).filter((f) => IMG.test(f.private_storage_path));
  const { data: signed } = photoPaths.length
    ? await supabaseAdmin().storage.from("generated-videos").createSignedUrls(photoPaths.map((f) => f.private_storage_path), 600)
    : { data: [] as { signedUrl: string | null }[] };
  const photoUrl = new Map(photoPaths.map((f, i) => [f.order_id, signed?.[i]?.signedUrl ?? null]));
  const isPhoto = (o: Row) => photoUrl.has(o.id) || (o.template_snapshot_json as { provider_key?: string }).provider_key === "kling_photo";

  const fmt = new Intl.DateTimeFormat("kk-KZ", { day: "numeric", month: "short", timeZone: "Asia/Almaty" });
  const state = (o: Row): { text: string; tone: "ok" | "work" | "pay" | "bad" | "muted" } => {
    if (o.payment_status === "refunded") return { text: kk.order.payment.refunded, tone: "muted" };
    if (o.payment_status !== "succeeded") return { text: kk.myVideos.pay, tone: "pay" };
    const g = o.generation_status as keyof typeof kk.order.generation;
    if (g === "completed") return { text: kk.gallery.ready, tone: "ok" };
    if (g === "failed") return { text: kk.order.generation.failed, tone: "bad" };
    return { text: kk.myVideos.progress, tone: "work" };
  };
  const toneCls = { ok: "bg-[#d4ff32] text-black", work: "bg-white/90 text-black", pay: "bg-[#ff453a] text-white", bad: "bg-[#ff453a] text-white", muted: "bg-white/80 text-black" };

  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-4">
      {orders.map((o) => {
        const st = state(o);
        const t = Array.isArray(o.templates) ? o.templates[0] : o.templates;
        const photo = isPhoto(o);
        const thumb = photoUrl.get(o.id) ?? mediaUrl(t?.cover_asset_path ?? null);
        const title = (o.template_snapshot_json as { title_kk?: string }).title_kk ?? "TrendMe";
        return (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="group relative block aspect-[3/4] overflow-hidden rounded-[20px] bg-night ring-1 ring-black/5">
              {thumb ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={thumb} alt="" loading="lazy" className={`absolute inset-0 h-full w-full object-cover transition-transform duration-300 group-active:scale-[1.03] ${st.tone === "ok" ? "" : "opacity-60"}`} />
              ) : (
                <span className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[#2a2a2e] to-[#111113] text-4xl" aria-hidden>{photo ? "📸" : "🎬"}</span>
              )}
              <span className="pointer-events-none absolute inset-x-0 bottom-0 h-2/3 bg-gradient-to-t from-black/85 to-transparent" />
              <span className={`absolute left-2 top-2 inline-flex items-center gap-1 rounded-full px-2 py-1 text-[11px] font-bold ${toneCls[st.tone]}`}>
                {st.tone === "work" && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-black/25 border-t-black" aria-hidden />}
                {st.text}
              </span>
              <span className="absolute right-2 top-2 flex h-7 w-7 items-center justify-center rounded-full bg-black/45 text-[13px] backdrop-blur" aria-label={photo ? kk.nav.tabPhoto : kk.nav.tabHome}>
                {photo ? "📸" : "▶"}
              </span>
              <span className="absolute inset-x-2.5 bottom-2.5 text-white">
                <span className="block truncate text-[14px] font-bold leading-tight">{title}</span>
                <span className="mt-0.5 block text-[11px] text-white/70">{fmt.format(new Date(o.created_at))} · {formatKzt(o.amount_kzt)}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
