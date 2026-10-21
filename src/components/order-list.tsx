import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { supabaseServer } from "@/lib/supabase/server";
import { formatKzt } from "@/lib/pricing";

/** The signed-in user's orders (RLS restricts the query to their own rows). */
export async function OrderList({ limit = 50 }: { limit?: number }) {
  const sb = await supabaseServer();
  const { data: orders } = await sb.from("orders")
    .select("id,public_order_number,created_at,amount_kzt,payment_status,generation_status,template_snapshot_json")
    .order("created_at", { ascending: false }).limit(limit);
  if (!orders?.length) return <p className="text-sm text-muted">{kk.account.ordersEmpty}</p>;
  const fmt = new Intl.DateTimeFormat("kk-KZ", { dateStyle: "medium", timeZone: "Asia/Almaty" });

  const badge = (o: { payment_status: string; generation_status: string }) => {
    if (o.payment_status === "refunded") return { text: kk.order.payment.refunded, cls: "bg-line text-ink" };
    if (o.payment_status !== "succeeded") return { text: kk.order.payment[o.payment_status as keyof typeof kk.order.payment], cls: "bg-flash/30 text-ink" };
    const g = o.generation_status as keyof typeof kk.order.generation;
    const cls = g === "completed" ? "bg-emerald-100 text-success" : g === "failed" ? "bg-red-50 text-danger" : "bg-brand-soft text-brand";
    return { text: kk.order.generation[g], cls };
  };

  return (
    <ul className="divide-y divide-line">
      {orders.map((o) => {
        const b = badge(o);
        return (
          <li key={o.id}>
            <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-4 py-3 hover:text-brand">
              <span className="min-w-0">
                <span className="block truncate font-medium">{(o.template_snapshot_json as { title_kk?: string }).title_kk}</span>
                <span className="block text-xs text-muted">{o.public_order_number}, {fmt.format(new Date(o.created_at))}</span>
              </span>
              <span className="shrink-0 text-right text-sm">
                <span className="block font-semibold">{formatKzt(o.amount_kzt)}</span>
                <span className={`mt-1 inline-block rounded-full px-2 py-0.5 text-xs font-semibold ${b.cls}`}>{b.text}</span>
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
