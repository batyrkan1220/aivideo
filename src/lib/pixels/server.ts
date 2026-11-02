import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabase/server";
import { pixelSettings } from "./settings";
import type { AdContext } from "./context";

/*
  Server-side Purchase, sent once per paid order to whichever tools have server credentials:
   - TikTok Events API  (POST business-api.tiktok.com/open_api/v1.3/event/track/, Access-Token header)
   - Meta Conversions API (POST graph.facebook.com/<ver>/<pixel>/events)
   - GA4 Measurement Protocol (POST google-analytics.com/mp/collect)
  The event id equals the browser's ("purchase_<order id>"), so each platform counts it once.
  Nothing personal is logged; user ids are SHA-256 hashed.
*/
const META_API = "v23.0";
const sha = (s: string) => createHash("sha256").update(s.trim().toLowerCase()).digest("hex");

export async function sendServerPurchase(orderId: string | null | undefined) {
  if (!orderId) return;
  try {
    const s = await pixelSettings();
    const tiktok = !!(s.tiktokPixelId && s.tiktokToken), meta = !!(s.metaPixelId && s.metaToken), ga = !!(s.ga4Id && s.ga4Secret);
    if (!tiktok && !meta && !ga) return;
    const db = supabaseAdmin();
    // Claim: only the first caller sends (webhook and status polling can both report the payment).
    const { data: o } = await db.from("orders").update({ pixels_sent_at: new Date().toISOString() })
      .eq("id", orderId).is("pixels_sent_at", null).eq("payment_status", "succeeded")
      .select("id,user_id,template_id,amount_kzt,ad_ctx,template_snapshot_json").maybeSingle();
    if (!o) return;
    const ctx = (o.ad_ctx ?? {}) as AdContext;
    const value = Number(o.amount_kzt) || 0;
    const itemId = o.template_id ?? "custom";
    const itemName = (o.template_snapshot_json as { title_kk?: string } | null)?.title_kk ?? "TrendMe";
    const eventId = `purchase_${o.id}`;
    const time = Math.floor(Date.now() / 1000);
    const ext = sha(o.user_id);

    const jobs: Promise<unknown>[] = [];
    if (tiktok) {
      jobs.push(post("tiktok", "https://business-api.tiktok.com/open_api/v1.3/event/track/", { "Access-Token": s.tiktokToken }, {
        event_source: "web", event_source_id: s.tiktokPixelId,
        ...(s.tiktokTestCode ? { test_event_code: s.tiktokTestCode } : {}),
        data: [{
          event: "CompletePayment", event_time: time, event_id: eventId,
          user: { external_id: ext, ...(ctx.ttclid ? { ttclid: ctx.ttclid } : {}), ...(ctx.ttp ? { ttp: ctx.ttp } : {}), ...(ctx.ip ? { ip: ctx.ip } : {}), ...(ctx.ua ? { user_agent: ctx.ua } : {}) },
          ...(ctx.url ? { page: { url: ctx.url } } : {}),
          properties: { currency: "KZT", value, content_type: "product", order_id: o.id, contents: [{ content_id: itemId, content_name: itemName, price: value, quantity: 1 }] },
        }],
      }));
    }
    if (meta) {
      jobs.push(post("meta", `https://graph.facebook.com/${META_API}/${s.metaPixelId}/events?access_token=${encodeURIComponent(s.metaToken)}`, {}, {
        ...(s.metaTestCode ? { test_event_code: s.metaTestCode } : {}),
        data: [{
          event_name: "Purchase", event_time: time, event_id: eventId, action_source: "website",
          ...(ctx.url ? { event_source_url: ctx.url } : {}),
          user_data: { external_id: [ext], ...(ctx.ip ? { client_ip_address: ctx.ip } : {}), ...(ctx.ua ? { client_user_agent: ctx.ua } : {}), ...(ctx.fbp ? { fbp: ctx.fbp } : {}), ...(ctx.fbc ? { fbc: ctx.fbc } : {}) },
          custom_data: { currency: "KZT", value, order_id: o.id, content_type: "product", content_ids: [itemId], content_name: itemName, num_items: 1 },
        }],
      }));
    }
    if (ga) {
      jobs.push(post("ga4", `https://www.google-analytics.com/mp/collect?measurement_id=${encodeURIComponent(s.ga4Id)}&api_secret=${encodeURIComponent(s.ga4Secret)}`, {}, {
        client_id: ctx.ga ?? `${parseInt(ext.slice(0, 8), 16)}.${time}`,
        user_id: ext,
        events: [{ name: "purchase", params: { transaction_id: o.id, value, currency: "KZT", items: [{ item_id: itemId, item_name: itemName, price: value, quantity: 1 }] } }],
      }));
    }
    await Promise.all(jobs);
  } catch {
    console.error(JSON.stringify({ src: "pixels", event: "server_purchase_failed" }));
  }
}

async function post(tool: string, url: string, extra: Record<string, string>, body: unknown) {
  try {
    const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...extra }, body: JSON.stringify(body), signal: AbortSignal.timeout(8000) });
    const ok = r.ok && (tool !== "tiktok" || ((await r.json().catch(() => ({}))) as { code?: number }).code === 0);
    console.log(JSON.stringify({ src: "pixels", event: "server_purchase", tool, ok, status: r.status }));
  } catch {
    console.error(JSON.stringify({ src: "pixels", event: "server_purchase", tool, ok: false }));
  }
}
