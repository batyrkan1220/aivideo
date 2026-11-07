"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { TemplateCard, type CardData } from "./template-card";

/**
 * A category shelf: its templates in one row that scrolls sideways (swipe on phones). On screens with
 * a mouse, round arrows at the edges scroll it by a page; each arrow shows only when there is more.
 */
export function ShelfRow({ items, label }: { items: CardData[]; label: string }) {
  const ref = useRef<HTMLUListElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => setEdge({ start: el.scrollLeft < 8, end: el.scrollLeft + el.clientWidth > el.scrollWidth - 8 });
    update();
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => { el.removeEventListener("scroll", update); window.removeEventListener("resize", update); };
  }, []);
  const go = (dir: 1 | -1) => ref.current?.scrollBy({ left: dir * ref.current.clientWidth * 0.85, behavior: "smooth" });
  const arrow = "absolute top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-line/70 bg-surface/90 text-ink elev-md backdrop-blur-xl transition-[opacity,transform] duration-200 hover:scale-105 [@media(hover:hover)]:grid";
  return (
    <div className="relative">
      <ul ref={ref} aria-label={label} className="no-scrollbar -mx-1.5 flex snap-x snap-mandatory gap-1.5 overflow-x-auto scroll-px-3 px-1.5 pb-1 sm:-mx-3 sm:px-3">
        {items.map((t, i) => (
          <li key={t.id} className="w-[44%] shrink-0 snap-start sm:w-[30%] md:w-[23%] lg:w-[18.5%] xl:w-[15.5%]">
            <TemplateCard t={t} priority={i < 2} aspect="aspect-[3/4]" wall />
          </li>
        ))}
      </ul>
      {!edge.start && <button type="button" onClick={() => go(-1)} aria-label="Назад" className={`${arrow} left-1`}><ChevronLeft size={20} aria-hidden /></button>}
      {!edge.end && <button type="button" onClick={() => go(1)} aria-label="Вперёд" className={`${arrow} right-1`}><ChevronRight size={20} aria-hidden /></button>}
    </div>
  );
}
