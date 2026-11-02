import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

/** "Second video −20% until tomorrow": offered the day after the first video. */
export const FOLLOWUP_DISCOUNT_PCT = 20;
export const FOLLOWUP_DISCOUNT_HOURS = 24;

export type ActiveDiscount = { id: string; percent: number; expiresAt: string };

/** The customer's unused, unexpired personal discount (the newest one), if any. */
export async function activeDiscount(userId: string): Promise<ActiveDiscount | null> {
  const { data } = await supabaseAdmin().from("user_discounts").select("id,percent,expires_at")
    .eq("user_id", userId).is("used_at", null).gt("expires_at", new Date().toISOString())
    .order("percent", { ascending: false }).limit(1).maybeSingle();
  return data ? { id: data.id, percent: data.percent, expiresAt: data.expires_at } : null;
}

export { discounted } from "./price";

/** Called when an order is paid: its personal discount (if any) is used up. Never throws. */
export async function markDiscountUsed(orderId: string | null | undefined) {
  if (!orderId) return;
  try {
    const db = supabaseAdmin();
    const { data: o } = await db.from("orders").select("user_id,pricing_breakdown_json").eq("id", orderId).maybeSingle();
    const id = (o?.pricing_breakdown_json as { discount?: { id?: string } } | null)?.discount?.id;
    if (!o || !id) return;
    await db.from("user_discounts").update({ used_order_id: orderId, used_at: new Date().toISOString() })
      .eq("id", id).eq("user_id", o.user_id).is("used_at", null);
  } catch {
    console.error(JSON.stringify({ src: "engage", event: "discount_mark_failed" }));
  }
}
