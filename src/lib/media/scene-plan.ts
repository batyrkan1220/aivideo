/** One shot of a template video, in seconds. */
export type Part = { start: number; len: number };

/**
 * Every scene is its own shot, also a short one: inside a shot Kling keeps the face only until the
 * next cut (TM-100039: scenes of 1.8 and 2.7 s were merged and lost the face). Kling edits 3 s or
 * more, so a shorter shot is sent held on its last frame up to 3 s and cut back after (KLING_MIN_SEC).
 * Under MIN_PART_SEC a "scene" is a flash or a double detection and stays with its neighbour.
 */
export const MIN_PART_SEC = 0.8;
export const KLING_MIN_SEC = 3;
export const MAX_PARTS = 6;

/**
 * Shots from the scene changes: a cut is used only when both sides are at least MIN_PART_SEC long (a shorter
 * shot stays with the one before it); with too many shots the shortest neighbours are merged.
 */
export function planParts(total: number, cuts: number[], min = MIN_PART_SEC, max = MAX_PARTS): Part[] {
  if (!(total > 0)) return [];
  const kept: number[] = [];
  for (const c of [...cuts].sort((a, b) => a - b)) {
    const last = kept.length ? kept[kept.length - 1] : 0;
    if (c - last >= min && total - c >= min) kept.push(c);
  }
  const edges = [0, ...kept, total];
  while (edges.length - 1 > max) {
    // Drop the inner edge whose two shots together are the shortest.
    let best = 1;
    for (let i = 1; i < edges.length - 1; i++) {
      if (edges[i + 1] - edges[i - 1] < edges[best + 1] - edges[best - 1]) best = i;
    }
    edges.splice(best, 1);
  }
  return edges.slice(0, -1).map((s, i) => ({ start: s, len: edges[i + 1] - s }));
}

/**
 * Length a shot is sent to Kling with: whole seconds, rounded up, at least 3. Kling returns whole
 * seconds only (5.27 s in → 5 s out lost the end of the shot, TM-100039), so the shot is held on its
 * last frame up to that length and the join cuts it back to its real length.
 */
export const klingShotSec = (len: number) => Math.max(KLING_MIN_SEC, Math.ceil(len - 0.01));
