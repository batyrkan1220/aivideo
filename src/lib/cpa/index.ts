import "server-only";
import { cookies } from "next/headers";
import { z } from "zod";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isTestPaymentProvider } from "@/lib/payments/types";

/**
 * CPA network integration (Offer18, used by the Teliks webmaster cabinet).
 *
 *   Offer URL in Offer18:  https://t.me/<bot>?start=o18_{tid}        (Telegram bot)
 *                          https://trendme.kz/?o18={tid}             (website)
 *   We keep the click id on the customer (first touch) and send the network's global
 *   postback on conversions: lead = first sign-in, sale = every real payment.
 *
 * Postback URL template (admin): any URL with macros {click_id} (also {tid}, {aff_click_id}),
 * {event}, {sum}, {currency}, {order_id}, {txn_id}.
 */
export const CPA_KEY = "cpa";
export const CPA_COOKIE = "tm_cpa";
export const CLICK_RE = /^[A-Za-z0-9_-]{4,64}$/;
const PAYLOAD_RE = /^o18_([A-Za-z0-9_-]{4,60})$/;

export const cpaSettingsSchema = z.object({
  enabled: z.boolean().default(false),
  network: z.string().default("offer18"),
  postbackUrl: z.string().max(1000).default(""),
  sendLead: z.boolean().default(false),
  sendSale: z.boolean().default(true),
});
export type CpaSettings = z.infer<typeof cpaSettingsSchema>;

export async function cpaSettings(): Promise<CpaSettings> {
  try {
    const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", CPA_KEY).maybeSingle();
    const p = cpaSettingsSchema.safeParse(data?.value ?? {});
    return p.success ? p.data : cpaSettingsSchema.parse({});
  } catch {
    return cpaSettingsSchema.parse({});
  }
}

export const clickFromPayload = (payload: string | null | undefined) => PAYLOAD_RE.exec((payload ?? "").trim())?.[1] ?? null;

export function renderPostback(template: string, v: { clickId: string; event: string; sum: number; orderId: string; txnId: string }) {
  const map: Record<string, string> = {
    click_id: v.clickId, tid: v.clickId, aff_click_id: v.clickId, event: v.event, sum: String(v.sum),
    sale: String(v.sum), currency: "KZT", order_id: v.orderId, txn_id: v.txnId,
  };
  return template.replace(/\{(\w+)\}/g, (m, k: string) => (k in map ? encodeURIComponent(map[k]) : m));
}

/** Sets the customer's click id once (first touch). Returns true when newly set. */
async function attribute(userId: string, network: string, clickId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().from("profiles")
    .update({ cpa_network: network, cpa_click_id: clickId, cpa_at: new Date().toISOString() })
    .eq("id", userId).is("cpa_click_id", null).select("id");
  return !!data?.length;
}

/** Bot /start o18_<tid>: remember the click for this Telegram user. */
export async function cpaTouchFromBot(telegramId: number, clickId: string) {
  const db = supabaseAdmin();
  await db.from("cpa_touches").upsert({ telegram_id: telegramId, network: "offer18", click_id: clickId }, { onConflict: "telegram_id", ignoreDuplicates: true });
  const { data: prof } = await db.from("profiles").select("id").eq("telegram_id", telegramId).maybeSingle();
  if (prof && (await attribute(prof.id, "offer18", clickId))) await sendCpaEvent("lead", { userId: prof.id });
}

/** After Mini App sign-in: click from start_param, else from an earlier bot touch. */
export async function cpaAttributeTelegram(userId: string, telegramId: number, startParam: string | null) {
  try {
    let clickId = clickFromPayload(startParam);
    if (!clickId) {
      const { data } = await supabaseAdmin().from("cpa_touches").select("click_id").eq("telegram_id", telegramId).maybeSingle();
      clickId = data?.click_id ?? null;
    }
    if (clickId && (await attribute(userId, "offer18", clickId))) await sendCpaEvent("lead", { userId });
  } catch (err) {
    console.error("[cpa.attribute.tg]", err instanceof Error ? err.message : err);
  }
}

/** Website: ?o18={tid} kept in a cookie, applied when the customer orders. */
export async function cpaAttributeFromCookie(userId: string) {
  try {
    const clickId = (await cookies()).get(CPA_COOKIE)?.value;
    if (clickId && CLICK_RE.test(clickId) && (await attribute(userId, "offer18", clickId))) await sendCpaEvent("lead", { userId });
  } catch { /* never block an order */ }
}

/** Records and sends one conversion postback (idempotent per order / per lead). Never throws. */
export async function sendCpaEvent(event: "lead" | "sale", ref: { userId?: string; orderId?: string }) {
  try {
    const s = await cpaSettings();
    if (!s.enabled || !s.postbackUrl || (event === "lead" && !s.sendLead) || (event === "sale" && !s.sendSale)) return;
    const db = supabaseAdmin();
    let userId = ref.userId ?? null;
    let amount = 0;
    let orderNo = "";
    if (event === "sale") {
      const { data: o } = await db.from("orders").select("user_id,amount_kzt,public_order_number").eq("id", ref.orderId!).maybeSingle();
      if (!o?.user_id) return;
      const { data: pay } = await db.from("payments").select("provider").eq("order_id", ref.orderId!).eq("status", "succeeded").limit(1).maybeSingle();
      if (!pay || isTestPaymentProvider(pay.provider)) return; // test payments never convert
      userId = o.user_id; amount = o.amount_kzt; orderNo = o.public_order_number;
    }
    const { data: prof } = await db.from("profiles").select("cpa_network,cpa_click_id").eq("id", userId!).maybeSingle();
    if (!prof?.cpa_click_id) return;
    const { data: row, error } = await db.from("cpa_postbacks").insert({
      network: prof.cpa_network ?? "offer18", event, click_id: prof.cpa_click_id, user_id: userId,
      order_id: ref.orderId ?? null, amount_kzt: event === "sale" ? amount : null,
    }).select("id").single();
    if (error || !row) return; // duplicate (already sent) or DB error
    await deliver(row.id, s.postbackUrl, { clickId: prof.cpa_click_id, event, sum: amount, orderId: orderNo, txnId: orderNo || row.id });
  } catch (err) {
    console.error("[cpa.event]", err instanceof Error ? err.message : err);
  }
}

async function deliver(id: string, template: string, v: Parameters<typeof renderPostback>[1]) {
  const db = supabaseAdmin();
  const url = renderPostback(template, v);
  let httpStatus: number | null = null;
  let lastError: string | null = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { method: "GET", signal: AbortSignal.timeout(10_000), cache: "no-store" });
      httpStatus = res.status;
      if (res.ok) break;
      lastError = `http ${res.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message.slice(0, 120) : "error";
    }
    if (attempt < 3) await new Promise((r) => setTimeout(r, attempt * 1000));
  }
  const ok = httpStatus !== null && httpStatus >= 200 && httpStatus < 300;
  const { data: cur } = await db.from("cpa_postbacks").select("attempts").eq("id", id).single();
  await db.from("cpa_postbacks").update({
    status: ok ? "sent" : "failed", http_status: httpStatus, last_error: ok ? null : lastError,
    attempts: (cur?.attempts ?? 0) + 1, ...(ok ? { sent_at: new Date().toISOString() } : {}),
  }).eq("id", id);
  console.log(JSON.stringify({ src: "cpa", event: "postback", type: v.event, ok, httpStatus }));
}

/** Admin "retry" for a failed postback. */
export async function retryCpaPostback(id: string) {
  const s = await cpaSettings();
  if (!s.postbackUrl) return;
  const db = supabaseAdmin();
  const { data: p } = await db.from("cpa_postbacks").select("id,event,click_id,amount_kzt,order_id,status").eq("id", id).maybeSingle();
  if (!p || p.status === "sent") return;
  let orderNo = "";
  if (p.order_id) orderNo = (await db.from("orders").select("public_order_number").eq("id", p.order_id).maybeSingle()).data?.public_order_number ?? "";
  await deliver(p.id, s.postbackUrl, { clickId: p.click_id, event: p.event, sum: p.amount_kzt ?? 0, orderId: orderNo, txnId: orderNo || p.id });
}
