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
export async function OrderList({ limit = 50, day }: { limit?: number; day?: string }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json,templates(cover_asset_path)")
    .is("parent_order_id", null) // combo parts live inside their combo card
    .order("created_at", { ascending: false }).limit(limit);
  const all = (data ?? []) as unknown as Row[];
  if (!all.length) {
    return (
      <div className="rounded-[28px] bg-surface px-6 py-14 text-center ring-1 ring-line">
        <span className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-brand text-2xl" aria-hidden>✨</span>
        <p className="mt-4 text-lg font-bold">{kk.gallery.emptyTitle}</p>
        <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{kk.account.ordersEmpty}</p>
        <Link href="/" className="btn-glow mt-5 inline-flex h-11 items-center rounded-full px-6 text-sm font-bold">{kk.myVideos.browse}</Link>
      </div>
    );
  }

  // Almaty calendar day of each order; the date strip shows the days that have works.
  const dayKey = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Almaty" });
  const keyOf = (o: Row) => dayKey.format(new Date(o.created_at));
  const days = [...new Set(all.map(keyOf))];
  const active = day && days.includes(day) ? day : undefined;
  const orders = active ? all.filter((o) => keyOf(o) === active) : all;

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

  // Photo combos: one card each — its first finished photo as the thumbnail, "7/10" progress.
  const comboIds = orders.filter((o) => (o.template_snapshot_json as { provider_key?: string }).provider_key === "combo").map((o) => o.id);
  const comboInfo = new Map<string, { ok: number; all: number }>();
  if (comboIds.length) {
    const { data: kids } = await supabaseAdmin().from("orders").select("id,parent_order_id,generation_status").in("parent_order_id", comboIds);
    for (const k of kids ?? []) {
      const c = comboInfo.get(k.parent_order_id as string) ?? { ok: 0, all: 0 };
      c.all++; if (k.generation_status === "completed") c.ok++;
      comboInfo.set(k.parent_order_id as string, c);
    }
    const doneKids = (kids ?? []).filter((k) => k.generation_status === "completed");
    const { data: kf } = doneKids.length
      ? await supabaseAdmin().from("generated_videos").select("order_id,private_storage_path").in("order_id", doneKids.map((k) => k.id))
      : { data: [] as { order_id: string; private_storage_path: string }[] };
    const firstOf = new Map<string, string>();
    for (const k of doneKids) {
      const f = kf?.find((x) => x.order_id === k.id);
      if (f && !firstOf.has(k.parent_order_id as string)) firstOf.set(k.parent_order_id as string, f.private_storage_path);
    }
    const parents = [...firstOf.keys()];
    const { data: ks } = parents.length
      ? await supabaseAdmin().storage.from("generated-videos").createSignedUrls(parents.map((p) => firstOf.get(p)!), 600)
      : { data: [] as { signedUrl: string | null }[] };
    parents.forEach((p, i) => photoUrl.set(p, ks?.[i]?.signedUrl ?? null));
  }
  const isPhoto = (o: Row) => photoUrl.has(o.id) || ["kling_photo", "combo"].includes((o.template_snapshot_json as { provider_key?: string }).provider_key ?? "");

  const tz = { timeZone: "Asia/Almaty" } as const;
  const head = new Intl.DateTimeFormat("kk-KZ", { day: "numeric", month: "long", weekday: "long", ...tz });
  const time = new Intl.DateTimeFormat("kk-KZ", { hour: "2-digit", minute: "2-digit", ...tz });
  const noon = (k: string) => new Date(`${k}T12:00:00+05:00`);
  const state = (o: Row): { text: string; tone: "ok" | "work" | "pay" | "bad" | "muted"; action: string } => {
    if (o.payment_status === "refunded") return { text: kk.order.payment.refunded, tone: "muted", action: kk.order.open };
    if (o.payment_status !== "succeeded") return { text: kk.status.awaiting_payment, tone: "pay", action: kk.myVideos.pay };
    const g = o.generation_status as keyof typeof kk.order.generation;
    if (g === "completed") return { text: kk.gallery.ready, tone: "ok", action: kk.myVideos.watch };
    if (g === "failed") return { text: kk.order.generation.failed, tone: "bad", action: kk.order.open };
    return { text: kk.myVideos.progress, tone: "work", action: kk.order.open };
  };
  const toneCls = { ok: "bg-brand-soft", work: "bg-peach", pay: "bg-lavender", bad: "bg-rose", muted: "bg-line" };
  const groups = (active ? [active] : days).map((k) => ({ k, items: orders.filter((o) => keyOf(o) === k) })).filter((g) => g.items.length);

  return (
    <>
      {groups.map((g) => (
        <section key={g.k} className="mb-6">
          <h2 className="mb-3 text-[15px] font-extrabold first-letter:uppercase">{head.format(noon(g.k))}</h2>
          {/* Timeline: time on the left, dashed connector, white work cards */}
          <ol className="relative">
            {g.items.map((o, i) => {
              const st = state(o);
              const t = Array.isArray(o.templates) ? o.templates[0] : o.templates;
              const photo = isPhoto(o);
              const thumb = photoUrl.get(o.id) ?? mediaUrl(t?.cover_asset_path ?? null);
              const title = (o.template_snapshot_json as { title_kk?: string }).title_kk ?? "TrendMe";
              const combo = comboInfo.get(o.id);
              const last = i === g.items.length - 1;
              return (
                <li key={o.id} className="relative grid grid-cols-[44px_1fr] gap-3 pb-3">
                  <div className="relative flex flex-col items-center pt-4">
                    <span className="text-[11px] font-semibold text-muted">{time.format(new Date(o.created_at))}</span>
                    <span className={`mt-2 h-2.5 w-2.5 rounded-full ring-4 ring-paper ${st.tone === "ok" ? "bg-[#9cbf12]" : st.tone === "bad" ? "bg-danger" : "bg-night"}`} aria-hidden />
                    {!last && <span className="mt-1 w-0 flex-1 border-l-2 border-dashed border-line" aria-hidden />}
                  </div>
                  <Link href={`/orders/${o.id}`} className="flex items-center gap-3 rounded-[24px] bg-surface p-2.5 pr-3.5 ring-1 ring-line transition-transform active:scale-[0.99]">
                    <span className="relative block h-[76px] w-[60px] shrink-0 overflow-hidden rounded-[16px] bg-night">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${st.tone === "ok" ? "" : "opacity-60"}`} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-2xl" aria-hidden>{photo ? "📸" : "🎬"}</span>
                      )}
                      <span className="absolute bottom-1 right-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/55 text-[10px] text-white" aria-hidden>{photo ? "📸" : "▶"}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold leading-tight">{title}</span>
                      <span className="mt-0.5 block text-[12px] text-muted">{o.public_order_number} · {formatKzt(o.amount_kzt)}</span>
                      <span className="mt-2 flex flex-wrap items-center gap-1.5">
                        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold text-night ${toneCls[st.tone]}`}>
                          {st.tone === "work" && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-black/20 border-t-black" aria-hidden />}
                          {st.text}
                        </span>
                        <span className="rounded-full bg-lavender px-2.5 py-1 text-[11px] font-bold text-night">{combo ? `${kk.combo.section} · ${kk.combo.ready(combo.ok, combo.all)}` : photo ? kk.nav.tabPhoto : kk.nav.tabHome}</span>
                      </span>
                    </span>
                    <span className={`shrink-0 rounded-full px-3 py-2 text-[12px] font-bold ${st.tone === "ok" ? "bg-night text-white" : st.tone === "pay" ? "bg-cobalt text-white" : "bg-paper text-ink"}`}>{st.action}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </>
  );
}
