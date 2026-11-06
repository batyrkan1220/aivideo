import { ChevronRight, Sparkles } from "lucide-react";
import { ButtonLink } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
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
      <EmptyState icon={<Sparkles size={26} strokeWidth={1.8} aria-hidden />} title={kk.gallery.emptyTitle} text={kk.account.ordersEmpty}
        action={<ButtonLink href="/" size="lg">{kk.myVideos.browse}</ButtonLink>} />
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
  const head = new Intl.DateTimeFormat("ru-RU", { day: "numeric", month: "long", weekday: "long", ...tz });
  const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", ...tz });
  const noon = (k: string) => new Date(`${k}T12:00:00+05:00`);
  const state = (o: Row): { text: string; tone: "ok" | "work" | "pay" | "bad" | "muted"; action: string } => {
    if (o.payment_status === "refunded") return { text: kk.order.payment.refunded, tone: "muted", action: kk.order.open };
    if (o.payment_status !== "succeeded") return { text: kk.status.awaiting_payment, tone: "pay", action: kk.myVideos.pay };
    const g = o.generation_status as keyof typeof kk.order.generation;
    if (g === "completed") return { text: kk.gallery.ready, tone: "ok", action: kk.myVideos.watch };
    if (g === "failed") return { text: kk.gallery.error, tone: "bad", action: kk.order.open };
    return { text: kk.myVideos.progress, tone: "work", action: kk.order.open };
  };
  const groups = (active ? [active] : days).map((k) => ({ k, items: orders.filter((o) => keyOf(o) === k) })).filter((g) => g.items.length);

  // Status colours from the design system (AAA text on soft backgrounds).
  const chipCls = { ok: "bg-success-soft text-success", work: "bg-warning-soft text-warning", pay: "bg-info-soft text-info", bad: "bg-danger-soft text-danger", muted: "bg-mist text-muted" };

  return (
    <>
      {groups.map((g) => (
        <section key={g.k} className="mb-5">
          <h2 className="t-eyebrow mb-3 px-1 text-muted">{head.format(noon(g.k))}</h2>
          {/* Phone-first list: one row per work, the whole row is the button */}
          <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">
            {g.items.map((o) => {
              const st = state(o);
              const t = Array.isArray(o.templates) ? o.templates[0] : o.templates;
              const photo = isPhoto(o);
              const thumb = photoUrl.get(o.id) ?? mediaUrl(t?.cover_asset_path ?? null);
              const title = (o.template_snapshot_json as { title_kk?: string }).title_kk ?? "TrendMe";
              const combo = comboInfo.get(o.id);
              return (
                <li key={o.id}>
                  <Link href={`/orders/${o.id}`} className="flex items-center gap-4 px-4 py-3 transition-colors hover:bg-mist/60 active:bg-mist">
                    <span className="relative block h-[64px] w-[48px] shrink-0 overflow-hidden rounded-[12px] bg-night">
                      {thumb ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={thumb} alt="" loading="lazy" className={`h-full w-full object-cover ${st.tone === "ok" ? "" : "opacity-60"}`} />
                      ) : (
                        <span className="flex h-full w-full items-center justify-center text-xl" aria-hidden>{photo ? "📸" : "🎬"}</span>
                      )}
                      <span className="absolute bottom-0.5 right-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/55 text-[8px] text-white" aria-hidden>{photo ? "📸" : "▶"}</span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-bold leading-tight">{title}</span>
                      <span className="mt-0.5 block truncate text-[12px] text-muted">
                        {time.format(new Date(o.created_at))} · {formatKzt(o.amount_kzt)}{combo ? ` · ${kk.combo.ready(combo.ok, combo.all)}` : ""}
                      </span>
                      <span className={`mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold ${chipCls[st.tone]}`}>
                        {st.tone === "work" && <span className="h-2.5 w-2.5 animate-spin rounded-full border-2 border-black/20 border-t-black" aria-hidden />}
                        {st.tone === "pay" ? st.action : st.text}
                      </span>
                    </span>
                    <ChevronRight size={20} className="shrink-0 text-faint" aria-hidden />
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </>
  );
}
