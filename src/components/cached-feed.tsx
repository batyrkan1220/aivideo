"use client";
import { useMemo, useSyncExternalStore } from "react";
import { TemplateCard, type CardData } from "./template-card";
import { GridSkeleton } from "./catalog-bits";

/*
  The last catalog the customer saw, kept on the phone (localStorage). While the server renders
  the fresh feed, the saved cards show instantly instead of a skeleton; the fresh feed replaces them.
*/
const KEY = "tm:feed:v1";
const MAX_AGE_MS = 7 * 86400_000;
const keyFor = (category?: string) => `${KEY}:${category || "all"}`;

export function saveFeed(category: string | undefined, items: CardData[]) {
  try { localStorage.setItem(keyFor(category), JSON.stringify({ at: Date.now(), items: items.slice(0, 12) })); } catch { /* private mode / quota */ }
}

function rawFeed(): string | null {
  try {
    const category = new URLSearchParams(window.location.search).get("category") ?? undefined;
    return localStorage.getItem(keyFor(category));
  } catch {
    return null;
  }
}

function parse(raw: string | null): CardData[] | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { at: number; items: CardData[] };
    return Date.now() - v.at < MAX_AGE_MS && Array.isArray(v.items) && v.items.length ? v.items : null;
  } catch {
    return null;
  }
}

/** Suspense fallback for the home feed: saved cards if there are any, otherwise the skeleton. */
export function CachedFeedFallback() {
  // Read on the client only (the server snapshot is "nothing saved", so hydration stays clean).
  const raw = useSyncExternalStore(() => () => {}, rawFeed, () => null);
  const items = useMemo(() => parse(raw), [raw]);
  if (!items) return <GridSkeleton />;
  return (
    <ul className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      {items.map((t, i) => <li key={t.id}><TemplateCard t={t} priority={i < 4} /></li>)}
    </ul>
  );
}
