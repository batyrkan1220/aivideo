"use client";
import { useEffect } from "react";
import { pixelEvent, pixelEventOnce, type Item } from "@/lib/pixels/client";

/** ViewContent on a template page (after the pixels have had a moment to load). */
export function TrackView({ item }: { item: Item }) {
  useEffect(() => { const t = setTimeout(() => pixelEvent({ type: "view", item }), 800); return () => clearTimeout(t); }, [item]);
  return null;
}

/** Purchase in the browser once per order (the server sends the same event id; platforms keep one). */
export function TrackPurchase({ orderId, value, item }: { orderId: string; value: number; item: Item }) {
  useEffect(() => { const t = setTimeout(() => pixelEventOnce(`purchase.${orderId}`, { type: "purchase", orderId, value, item }), 800); return () => clearTimeout(t); }, [orderId, value, item]);
  return null;
}
