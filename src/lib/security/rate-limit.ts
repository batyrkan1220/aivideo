import "server-only";
import { headers } from "next/headers";
import { supabaseAdmin } from "@/lib/supabase/server";

/** Named limits: max hits per window (seconds). */
export const LIMITS = {
  login: [10, 15 * 60],
  signup: [5, 60 * 60],
  reset: [5, 60 * 60],
  order: [20, 60 * 60],
  checkout: [20, 60 * 60],
} as const satisfies Record<string, readonly [number, number]>;

/** Client IP as seen by Render's proxy (first X-Forwarded-For hop). */
export async function clientIp(): Promise<string> {
  const h = await headers();
  return (h.get("x-forwarded-for")?.split(",")[0] ?? h.get("x-real-ip") ?? "unknown").trim().slice(0, 64);
}

/**
 * Returns true if allowed. Fails OPEN on infrastructure errors (logged) so a limiter
 * outage never blocks paying customers; Supabase Auth has its own limits as a backstop.
 */
export async function allow(name: keyof typeof LIMITS, subject: string): Promise<boolean> {
  const [max, windowSec] = LIMITS[name];
  try {
    const { data, error } = await supabaseAdmin().rpc("hit_rate_limit", {
      p_key: `${name}:${subject}`.slice(0, 200), p_max: max, p_window_seconds: windowSec,
    });
    if (error) { console.error("[ratelimit]", error.code); return true; }
    return data !== false;
  } catch (err) {
    console.error("[ratelimit]", err instanceof Error ? err.message : err);
    return true;
  }
}
