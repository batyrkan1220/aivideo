"use client";
import { TemplateCard, type CardData } from "./template-card";

/*
  Home feed: a grid of video cards, all the same size, in even rows with thin gaps. 9:16 like the
  videos themselves, so nothing is cropped. Columns by width: 2 on phones and in the Mini App, then
  3, 4 and 5. Loading more only adds rows at the bottom.
*/
export function MasonryFeed({ items, priorityCount = 0 }: { items: CardData[]; priorityCount?: number }) {
  return (
    <ul className="grid grid-cols-2 gap-1 sm:grid-cols-3 sm:gap-1.5 lg:grid-cols-4 xl:grid-cols-5">
      {items.map((t, i) => (
        <li key={t.id}><TemplateCard t={t} priority={i < priorityCount} aspect="aspect-[9/16]" wall /></li>
      ))}
    </ul>
  );
}
