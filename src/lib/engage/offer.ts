import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DISCOUNTS_ON } from "./price";

/**
 * "First video −20%" for people who came from an ad: the proxy sets a signed tm_offer cookie on the
 * first ad visit; it is valid 24 h and only until the first paid order.
 */
export const FIRST_ORDER_PCT = 20;
const TTL = 24 * 3600_000;

function verify(raw: string | undefined): number | null {
  const [ts, sig] = (raw ?? "").split(".");
  if (!ts || !sig || !/^\d{12,14}$/.test(ts) || !/^[0-9a-f]{24}$/.test(sig)) return null;
  const secret = process.env.WORKER_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const want = createHmac("sha256", secret).update(ts).digest().subarray(0, 12);
  const got = Buffer.from(sig, "hex");
  if (got.length !== want.length || !timingSafeEqual(got, want)) return null;
  return Number(ts);
}

export async function adOffer(userId: string | null): Promise<{ percent: number; expiresAt: string } | null> {
  if (!DISCOUNTS_ON) return null;
  try {
    const ts = verify((await cookies()).get("tm_offer")?.value);
    if (!ts || Date.now() - ts > TTL) return null;
    if (userId) {
      const { count } = await supabaseAdmin().from("orders").select("id", { count: "exact", head: true })
        .eq("user_id", userId).eq("payment_status", "succeeded");
      if (count) return null;
    }
    return { percent: FIRST_ORDER_PCT, expiresAt: new Date(ts + TTL).toISOString() };
  } catch {
    return null;
  }
}
