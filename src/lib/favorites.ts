"use client";
import { useSyncExternalStore } from "react";
import type { CardData } from "@/components/template-card";

/**
 * Favourite templates, kept on this device (localStorage): a per-viewer convenience, no account
 * needed. Stores the card data itself so the «Избранное» shelf renders without a request.
 */
const KEY = "trendme.favs";
const MAX = 60;
const EVENT = "trendme:favs";
let cache: CardData[] | null = null;

function read(): CardData[] {
  if (cache) return cache;
  try { cache = JSON.parse(localStorage.getItem(KEY) ?? "[]") as CardData[]; } catch { cache = []; }
  if (!Array.isArray(cache)) cache = [];
  return cache;
}
function write(list: CardData[]) {
  cache = list.slice(0, MAX);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* private mode: keep in memory */ }
  window.dispatchEvent(new Event(EVENT));
}
const subscribe = (cb: () => void) => {
  const onStorage = (e: StorageEvent) => { if (e.key === KEY) { cache = null; cb(); } };
  window.addEventListener(EVENT, cb);
  window.addEventListener("storage", onStorage);
  return () => { window.removeEventListener(EVENT, cb); window.removeEventListener("storage", onStorage); };
};
const EMPTY: CardData[] = [];

export function useFavorites(): CardData[] {
  return useSyncExternalStore(subscribe, read, () => EMPTY);
}
export function useIsFavorite(id: string): boolean {
  return useSyncExternalStore(subscribe, () => read().some((t) => t.id === id), () => false);
}
/** Adds or removes; returns true when it is now a favourite. */
export function toggleFavorite(t: CardData): boolean {
  const list = read();
  if (list.some((x) => x.id === t.id)) { write(list.filter((x) => x.id !== t.id)); return false; }
  const { id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, previewLiteUrl, previewAnimUrl, isTrending } = t;
  write([{ id, title, description: description.slice(0, 160), faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, previewLiteUrl, previewAnimUrl, isTrending }, ...list]);
  return true;
}
