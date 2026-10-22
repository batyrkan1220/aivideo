"use client";
import { useState, useSyncExternalStore } from "react";

const KEY = "trendme.kaspiPhone";
const noop = () => () => {};
const read = () => { try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; } };

/** Kaspi number remembered on this device (convenience only; storage may be unavailable). */
export function useSavedPhone() {
  const stored = useSyncExternalStore(noop, read, () => "");
  const [typed, setTyped] = useState<string | null>(null);
  return [typed ?? stored, setTyped] as const;
}

export function savePhone(v: string) {
  try { if (v) localStorage.setItem(KEY, v); } catch { /* ignore */ }
}
