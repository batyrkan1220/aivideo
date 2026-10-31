import "server-only";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Users the admin allowed to order without payment (tests, gifts). */
export async function isFreeOrderUser(userId: string): Promise<boolean> {
  // Cached briefly (admin toggles clear it); the real check is repeated in place_free_order().
  return memo(`free:${userId}`, 60_000, async () => {
    const { data } = await supabaseAdmin().from("free_order_users").select("user_id").eq("user_id", userId).maybeSingle();
    return !!data;
  });
}

/** Marks the order paid (0 ₸, provider "free") and queues generation. */
export async function placeFreeOrder(orderId: string, userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("place_free_order", { p_order_id: orderId, p_user_id: userId });
  if (error) { console.error("[order.free]", error.code, error.message); return false; }
  return data === "applied";
}
