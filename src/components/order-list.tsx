import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { supabaseServer } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";
import { mediaUrl } from "@/lib/templates/queries";

type Row = {
  id: string; public_order_number: string; created_at: string; amount_kzt: number;
  payment_status: string; generation_status: string; template_snapshot_json: unknown;
  templates: { cover_asset_path: string | null } | { cover_asset_path: string | null }[] | null;
};

/** The signed-in user's videos/orders as cards (RLS restricts the query to their own rows). */
export async function OrderList({ limit = 50 }: { limit?: number }) {
  const sb = await supabaseServer();
  const { data } = await sb.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json,templates(cover_asset_path)")
    .order("created_at", { ascending: false }).limit(limit);
  const orders = (data ?? []) as unknown as Row[];
  if (!orders.length) {
    return (
      <div className="py-8 text-center">
        <p className="text-sm text-muted">{kk.account.ordersEmpty}</p>
        <Link href="/" className="mt-4 inline-flex h-11 items-center rounded-full bg-brand px-6 text-sm font-semibold text-white hover:bg-brand-dark">
          {kk.myVideos.browse}
        </Link>
      </div>
    );
  }
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "medium", timeZone: "Asia/Almaty" });

  const state = (o: Row) => {
    if (o.payment_status === "refunded") return { text: kk.order.payment.refunded, cls: "bg-line text-ink", cta: kk.myVideos.open };
    if (o.payment_status !== "succeeded") {
      return { text: kk.order.payment[o.payment_status as keyof typeof kk.order.payment], cls: "bg-flash/40 text-ink", cta: kk.myVideos.pay };
    }
    const g = o.generation_status as keyof typeof kk.order.generation;
    if (g === "completed") return { text: kk.order.generation.completed, cls: "bg-emerald-100 text-success", cta: kk.myVideos.watch };
    if (g === "failed") return { text: kk.order.generation.failed, cls: "bg-red-50 text-danger", cta: kk.myVideos.open };
    return { text: kk.order.generation[g] ?? kk.myVideos.progress, cls: "bg-brand-soft text-brand", cta: kk.myVideos.progress };
  };

  return (
    <ul className="grid gap-3 sm:grid-cols-2">
      {orders.map((o) => {
        const st = state(o);
        const t = Array.isArray(o.templates) ? o.templates[0] : o.templates;
        const cover = mediaUrl(t?.cover_asset_path ?? null);
        return (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="flex gap-4 rounded-card border border-line bg-white p-3 transition-colors hover:border-ink">
              <div className="aspect-[9/16] w-16 shrink-0 overflow-hidden rounded-xl bg-ink/90">
                {cover && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={cover} alt="" loading="lazy" className="h-full w-full object-cover" />
                )}
              </div>
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="truncate font-semibold">{(o.template_snapshot_json as { title_kk?: string }).title_kk}</span>
                <span className="text-xs text-muted">{fmt.format(new Date(o.created_at))} · {formatKzt(o.amount_kzt)}</span>
                <span className={`mt-2 self-start rounded-full px-2.5 py-0.5 text-xs font-semibold ${st.cls}`}>{st.text}</span>
                <span className="mt-auto pt-2 text-sm font-semibold text-brand">{st.cta} →</span>
              </div>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
