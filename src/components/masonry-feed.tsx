"use client";
import { useSyncExternalStore } from "react";
import { TemplateCard, type CardData } from "./template-card";

/*
  Home feed laid out like a wall of videos (Higgsfield-style): columns of cards with different
  heights, almost no gap. Each card goes to the shortest column, so loading more only adds at the
  bottom and nothing already on screen moves. A card's shape comes from its id: the same on every visit.
*/
const SHAPES = [16 / 9, 4 / 3, 3 / 2, 16 / 9, 5 / 4, 3 / 2]; // height / width
const CLASSES: Record<number, string> = {
  [16 / 9]: "aspect-[9/16]", [4 / 3]: "aspect-[3/4]", [3 / 2]: "aspect-[2/3]", [5 / 4]: "aspect-[4/5]",
};

function shapeOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return SHAPES[Math.abs(h) % SHAPES.length];
}

// Columns by width; Telegram keeps the app phone-width (2 columns). The server renders 2 (phones first).
const QUERIES: [string, number][] = [["(min-width: 1280px)", 5], ["(min-width: 1024px)", 4], ["(min-width: 640px)", 3]];
function cols(): number {
  if (document.documentElement.hasAttribute("data-tg")) return 2;
  for (const [q, n] of QUERIES) if (window.matchMedia(q).matches) return n;
  return 2;
}
function subscribe(f: () => void) {
  const mqs = QUERIES.map(([q]) => window.matchMedia(q));
  mqs.forEach((m) => m.addEventListener("change", f));
  return () => mqs.forEach((m) => m.removeEventListener("change", f));
}

export function MasonryFeed({ items, priorityCount = 0 }: { items: CardData[]; priorityCount?: number }) {
  const n = useSyncExternalStore(subscribe, cols, () => 2);
  const columns: { t: CardData; i: number; shape: number }[][] = Array.from({ length: n }, () => []);
  const heights = new Array<number>(n).fill(0);
  items.forEach((t, i) => {
    const shape = shapeOf(t.id);
    let c = 0;
    for (let k = 1; k < n; k++) if (heights[k] < heights[c] - 0.01) c = k;
    columns[c].push({ t, i, shape });
    heights[c] += shape;
  });
  return (
    <div className="flex items-start gap-1 sm:gap-1.5">
      {columns.map((col, k) => (
        <ul key={k} className="flex min-w-0 flex-1 flex-col gap-1 sm:gap-1.5">
          {col.map(({ t, i, shape }) => (
            <li key={t.id}><TemplateCard t={t} priority={i < priorityCount} aspect={CLASSES[shape]} wall /></li>
          ))}
        </ul>
      ))}
    </div>
  );
}
