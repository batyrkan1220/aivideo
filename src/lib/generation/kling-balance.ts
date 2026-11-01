import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";

/**
 * What actually happened at Kling, from our own jobs: Kling's pack counter lags up to 12 h, and a pack
 * with units left still refuses a video that needs more units than remain.
 *  - noBalance: the latest generation was refused for balance (and nothing succeeded after it)
 *  - avgUnits: units an average finished video used (for "enough for ~N videos")
 */
export async function klingBalanceSignal(): Promise<{ noBalance: boolean; at: string | null; avgUnits: number | null }> {
  const db = supabaseAdmin();
  const [{ data: last }, { data: done }, s] = await Promise.all([
    db.from("generation_jobs").select("status,error_code,created_at").neq("provider", "combo")
      .in("status", ["completed", "failed"]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    db.from("generation_jobs").select("provider_cost").eq("status", "completed").neq("provider", "combo")
      .not("provider_cost", "is", null).order("created_at", { ascending: false }).limit(20),
    seedancePricingSettings(),
  ]);
  const costs = (done ?? []).map((j) => Number(j.provider_cost)).filter((x) => x > 0);
  const avgUnits = costs.length && s.klingUnitUsd > 0 ? Math.round((costs.reduce((a, b) => a + b, 0) / costs.length / s.klingUnitUsd) * 10) / 10 : null;
  const noBalance = last?.status === "failed" && last.error_code === "provider_no_balance";
  return { noBalance, at: noBalance ? last!.created_at : null, avgUnits };
}
