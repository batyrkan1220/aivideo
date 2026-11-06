/** One shot of a template video, in seconds. */
export type Part = { start: number; len: number };

/** Kling edits 3 s or more; at most this many shots per order (one Kling task each). */
export const MIN_PART_SEC = 3;
export const MAX_PARTS = 5;

/**
 * Shots from the scene changes: a cut is used only when both sides are at least 3 s long (a shorter
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
