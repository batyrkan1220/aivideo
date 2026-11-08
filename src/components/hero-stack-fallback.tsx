"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { DepthStack, DepthStackShell, type HeroItem } from "./cinematic-hero";

const KEY = "trendme.showcase";
const read = () => { try { return sessionStorage.getItem(KEY); } catch { return null; } };
const noop = () => () => {};

/**
 * Placeholder for the hero's three cards while the server streams them. Going back to the home page,
 * the browser can keep this placeholder from its page cache and never receive the cards; so it shows
 * the last cards seen in this tab at once and loads fresh ones itself. When the server's cards arrive,
 * React replaces this component anyway.
 */
export function HeroStackFallback() {
  const cached = useSyncExternalStore(noop, read, () => null);
  const [fresh, setFresh] = useState<HeroItem[] | null>(null);
  useEffect(() => {
    let stop = false;
    fetch("/api/showcase").then((r) => r.json()).then((j: { items?: HeroItem[] }) => {
      if (stop || !j.items?.length) return;
      try { sessionStorage.setItem(KEY, JSON.stringify(j.items)); } catch { /* ignore */ }
      setFresh(j.items);
    }).catch(() => {});
    return () => { stop = true; };
  }, []);
  let items: HeroItem[] | null = fresh;
  if (!items && cached) { try { items = JSON.parse(cached) as HeroItem[]; } catch { items = null; } }
  return items?.length ? <DepthStack items={items} /> : <DepthStackShell />;
}

/** Keeps the cards the server sent, so a later placeholder can show them instantly. */
export function RememberShowcase({ items }: { items: HeroItem[] }) {
  useEffect(() => { try { sessionStorage.setItem(KEY, JSON.stringify(items)); } catch { /* ignore */ } }, [items]);
  return null;
}
