/**
 * Kling 4.0 accepts reference videos between 2:5 and 5:2 (width ÷ height 0.4 – 2.5) and renders
 * 9:16, 1:1 or 16:9. The customer's video picks the closest output, so nothing gets cropped away.
 */
export const KLING_MIN_ASPECT = 0.4;
export const KLING_MAX_ASPECT = 2.5;

export type OutputAspect = "9:16" | "1:1" | "16:9";
const OUTPUTS: [OutputAspect, number][] = [["9:16", 9 / 16], ["1:1", 1], ["16:9", 16 / 9]];

export const aspectAllowed = (a: number) => a >= KLING_MIN_ASPECT - 0.005 && a <= KLING_MAX_ASPECT + 0.005;

/** Closest Kling output format (compared on a log scale, so 3:4 → 9:16 and 4:3 → 16:9). */
export function nearestOutputAspect(a: number | null | undefined): OutputAspect {
  if (!a || !Number.isFinite(a) || a <= 0) return "9:16";
  const dist = (r: number) => Math.round(Math.abs(Math.log(a / r)) * 1e6);
  let best = OUTPUTS[0];
  for (const o of OUTPUTS) {
    const d = dist(o[1]), bd = dist(best[1]);
    // A tie (3:4, 4:3) goes to the vertical / horizontal format rather than square.
    if (d < bd || (d === bd && best[0] === "1:1")) best = o;
  }
  return best[0];
}
