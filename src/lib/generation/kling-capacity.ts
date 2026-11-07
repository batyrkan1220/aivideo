import "server-only";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";
import { klingPasses, klingUnits, qualityCostFactor } from "@/lib/pricing-seedance";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { klingStatus } from "./kling";
import { klingBalanceSignal } from "./kling-balance";

/*
  No payment is taken for a video Kling cannot make: before checkout the order's Kling units are
  checked against what is left in the Kling packs (the owner's rule). Kling's own counter lags up to
  12 h, so the units of videos still running and of the last 12 h are taken off it, plus a margin.
  The pack counter decides (after a top-up it shows the new units at once). Only when Kling cannot be
  asked does the last job's pack refusal block; otherwise payment is not blocked by a network hiccup.
*/

const MARGIN = 1.15;
const ACTIVE = ["queued", "processing", "postprocessing"];

type Snap = { video_duration_sec?: unknown; quality?: { key?: string; providerQuality?: string } | string; provider_config_json?: { people?: unknown } };

/** Kling units one order needs (every person's run, its quality). */
export function orderUnits(snap: Snap | null, unitsFor: (sec: number) => number): number {
  const sec = Number(snap?.video_duration_sec) || 0;
  if (!(sec > 0)) return 0;
  const q = typeof snap?.quality === "string" ? snap.quality : snap?.quality?.providerQuality ?? snap?.quality?.key;
  return unitsFor(sec) * klingPasses({ people: Number(snap?.provider_config_json?.people) || 1 }) * qualityCostFactor(q);
}

/** Units left for Kling 4.0 (cached 1 min), or null when Kling cannot be asked. */
const unitsLeft = () => memo("kling:units-left", 60_000, async () => {
  const s = await klingStatus();
  if (s.state !== "ok" || !s.packs) return null;
  const for40 = s.packs.filter((p) => p.for40);
  return (for40.length ? for40 : s.packs).reduce((n, p) => n + p.remaining, 0);
});

export async function klingCanTake(snap: Snap | null): Promise<{ ok: boolean; need: number; free: number | null }> {
  const s = await seedancePricingSettings();
  const unitsFor = (sec: number) => klingUnits(sec, s);
  const need = Math.round(orderUnits(snap, unitsFor) * MARGIN * 100) / 100;
  const [left, signal] = await Promise.all([unitsLeft().catch(() => null), klingBalanceSignal().catch(() => null)]);
  // Kling cannot be asked: the last job's pack refusal decides (until a job succeeds again).
  if (left === null) return { ok: !signal?.noBalance, need, free: null };
  if (need <= 0) return { ok: true, need, free: left };
  // Units of videos running now and of the last 12 h (the pack counter may not show them yet).
  const since = new Date(Date.now() - 12 * 3600_000).toISOString();
  const { data: jobs } = await supabaseAdmin().from("generation_jobs")
    .select("status,provider_cost,created_at,orders!inner(template_snapshot_json)")
    .neq("provider", "combo").or(`status.in.(${ACTIVE.join(",")}),and(status.eq.completed,created_at.gt."${since}")`).limit(200);
  let busy = 0;
  for (const j of jobs ?? []) {
    const cost = Number(j.provider_cost);
    if (j.status === "completed" && cost > 0 && s.klingUnitUsd > 0) { busy += cost / s.klingUnitUsd; continue; }
    const o = (Array.isArray(j.orders) ? j.orders[0] : j.orders) as { template_snapshot_json?: Snap } | null;
    busy += orderUnits(o?.template_snapshot_json ?? null, unitsFor);
  }
  const free = Math.round((left - busy) * 100) / 100;
  if (free < need) console.error("[kling] not enough units for a new order", `left=${left} busy=${busy.toFixed(1)} need=${need}`);
  return { ok: free >= need, need, free };
}
