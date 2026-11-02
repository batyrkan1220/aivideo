"use client";

/*
  One call per funnel step fans out to every connected pixel / analytics tool:
    TikTok Pixel · Meta Pixel · Google Analytics 4 · Yandex Metrica.
  Purchase also goes server-side (Events API / Conversions API / Measurement Protocol) with the
  same event id, so the platforms count it once.
*/
type W = Window & {
  ttq?: { track: (e: string, p?: object, o?: object) => void; page: () => void };
  fbq?: (...a: unknown[]) => void;
  gtag?: (...a: unknown[]) => void;
  ym?: (...a: unknown[]) => void;
  dataLayer?: unknown[];
  __tmPixels?: { ym: string | null };
};

export type Item = { id: string; name: string; price: number };
export type FunnelEvent =
  | { type: "view"; item: Item }
  | { type: "add"; item: Item }
  | { type: "checkout"; item: Item; orderId: string; value: number }
  | { type: "purchase"; item: Item; orderId: string; value: number };

const CUR = "KZT";
const w = () => (typeof window === "undefined" ? null : (window as W));

export function pixelEvent(e: FunnelEvent) {
  const win = w();
  if (!win) return;
  const value = "value" in e ? e.value : e.item.price;
  const contents = [{ content_id: e.item.id, content_name: e.item.name, content_type: "product", quantity: 1, price: e.item.price }];
  const eventId = "orderId" in e ? `${e.type}_${e.orderId}` : undefined;
  const ttName = { view: "ViewContent", add: "AddToCart", checkout: "InitiateCheckout", purchase: "CompletePayment" }[e.type];
  const fbName = { view: "ViewContent", add: "AddToCart", checkout: "InitiateCheckout", purchase: "Purchase" }[e.type];
  const gaName = { view: "view_item", add: "add_to_cart", checkout: "begin_checkout", purchase: "purchase" }[e.type];
  try {
    win.ttq?.track(ttName, { contents, content_type: "product", value, currency: CUR }, eventId ? { event_id: eventId } : undefined);
  } catch { /* pixel blocked */ }
  try {
    win.fbq?.("track", fbName, { content_ids: [e.item.id], content_name: e.item.name, content_type: "product", value, currency: CUR }, eventId ? { eventID: eventId } : undefined);
  } catch { /* pixel blocked */ }
  try {
    win.gtag?.("event", gaName, {
      currency: CUR, value, ...(e.type === "purchase" ? { transaction_id: e.orderId } : {}),
      items: [{ item_id: e.item.id, item_name: e.item.name, price: e.item.price, quantity: 1 }],
    });
  } catch { /* blocked */ }
  try {
    const ym = win.__tmPixels?.ym;
    if (ym && win.ym) {
      win.dataLayer = win.dataLayer ?? [];
      const product = { id: e.item.id, name: e.item.name, price: e.item.price, quantity: 1 };
      const ecommerce = e.type === "view" ? { detail: { products: [product] } }
        : e.type === "add" ? { add: { products: [product] } }
        : e.type === "purchase" ? { purchase: { actionField: { id: e.orderId, revenue: value }, products: [{ ...product, price: value }] } }
        : null;
      if (ecommerce) win.dataLayer.push({ ecommerce: { currencyCode: CUR, ...ecommerce } });
      win.ym(Number(ym), "reachGoal", { view: "view_template", add: "photo_uploaded", checkout: "checkout", purchase: "purchase" }[e.type], { order_price: value, currency: CUR });
    }
  } catch { /* blocked */ }
}

/** Fires once per browser for this key (e.g. one Purchase per order). */
export function pixelEventOnce(key: string, e: FunnelEvent) {
  try {
    const k = `tm.px.${key}`;
    if (localStorage.getItem(k)) return;
    localStorage.setItem(k, "1");
  } catch { /* storage off: still send */ }
  pixelEvent(e);
}

/** SPA page view for all tools (the first one is sent by the base codes themselves). */
export function pixelPageView(url: string) {
  const win = w();
  if (!win) return;
  try { win.ttq?.page(); } catch { /* blocked */ }
  try { win.fbq?.("track", "PageView"); } catch { /* blocked */ }
  // GA4 counts SPA page changes itself (enhanced measurement → browser history events).
  try { const ym = win.__tmPixels?.ym; if (ym && win.ym) win.ym(Number(ym), "hit", url, { title: document.title, referer: document.referrer }); } catch { /* blocked */ }
}
