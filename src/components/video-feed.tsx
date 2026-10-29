"use client";
import { useEffect, useRef, useState } from "react";
import { kk } from "@/lib/i18n/kk";
import { TemplateCard, type CardData } from "./template-card";
import { loadMoreVideos } from "@/app/(site)/home-actions";

/**
 * Endless video feed: shows the first page, then loads the next page automatically when the
 * end of the list comes into view. Cards themselves load video lazily (see TemplateCard).
 */
export function VideoFeed({ title, category, initial, initialHasMore, exclude = [], priorityCount = 0 }: { title?: string; category?: string; initial: CardData[]; initialHasMore: boolean; exclude?: string[]; priorityCount?: number }) {
  const [items, setItems] = useState(initial);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(initialHasMore);
  const [loading, setLoading] = useState(false);
  const sentinel = useRef<HTMLDivElement>(null);
  const skip = new Set(exclude);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasMore) return;
    const io = new IntersectionObserver(async ([e]) => {
      if (!e.isIntersecting || loading) return;
      setLoading(true);
      try {
        const next = await loadMoreVideos(page + 1, category);
        setItems((prev) => {
          const seen = new Set(prev.map((x) => x.id));
          return [...prev, ...next.items.filter((x) => !seen.has(x.id))];
        });
        setPage((p) => p + 1);
        setHasMore(next.hasMore);
      } catch {
        setHasMore(false);
      } finally {
        setLoading(false);
      }
    }, { rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [page, hasMore, loading, category]);

  const shown = items.filter((t) => !skip.has(t.id));
  if (!shown.length && !hasMore) return null;
  return (
    <>
      {title && <h2 className="mb-5 font-display text-xl font-bold tracking-tight sm:text-2xl">{title}</h2>}
      <ul className="grid grid-cols-3 gap-1.5 sm:gap-4 lg:grid-cols-4">
        {shown.map((t, i) => (
          <li key={t.id}><TemplateCard t={t} priority={i < priorityCount} /></li>
        ))}
      </ul>
      {hasMore && (
        <div ref={sentinel} className="flex h-20 items-center justify-center text-sm text-muted" aria-live="polite">
          {loading ? kk.common.loading : ""}
        </div>
      )}
    </>
  );
}
