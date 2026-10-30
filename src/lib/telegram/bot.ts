import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";
import { botMessage } from "./messages";

/**
 * Minimal Telegram Bot API client. The token is never logged; errors are reported by method name only.
 */
export function botConfigured() { return !!env().TELEGRAM_BOT_TOKEN; }

export async function tg<T = unknown>(method: string, payload: Record<string, unknown>): Promise<T | null> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10_000),
      cache: "no-store",
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: T; error_code?: number } | null;
    if (!body?.ok) { console.error(JSON.stringify({ src: "telegram", event: "api_error", method, code: body?.error_code ?? res.status })); return null; }
    return body.result ?? null;
  } catch {
    console.error(JSON.stringify({ src: "telegram", event: "api_unreachable", method }));
    return null;
  }
}

/** Secret for X-Telegram-Bot-Api-Secret-Token, derived from the bot token (1–256 chars of A-Za-z0-9_-). */
export function webhookSecret(): string | null {
  const token = env().TELEGRAM_BOT_TOKEN;
  return token ? createHmac("sha256", token).update("trendme-telegram-webhook-v1").digest("hex") : null;
}

export function checkWebhookSecret(header: string | null): boolean {
  const s = webhookSecret();
  if (!s || !header) return false;
  const a = Buffer.from(header);
  const b = Buffer.from(s);
  return a.length === b.length && timingSafeEqual(a, b);
}

const appUrl = (path = "/") => `${env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "")}${path}`;

/** Inline button that opens a page of the Mini App inside Telegram. */
export const openAppButton = (text: string, path = "/") => ({ inline_keyboard: [[{ text, web_app: { url: appUrl(path) } }]] });

/**
 * Sends an HTML message. If Telegram rejects the markup (e.g. an admin typed an unclosed tag),
 * it is resent once as plain text so the user still gets it.
 */
export async function sendMessage(chatId: number, text: string, button?: { text: string; path: string } | null) {
  const markup = button ? { reply_markup: openAppButton(button.text, button.path) } : {};
  const sent = await tg("sendMessage", { chat_id: chatId, text, parse_mode: "HTML", link_preview_options: { is_disabled: true }, ...markup });
  if (sent) return sent;
  const plain = text.replace(/<[^>]+>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  return tg("sendMessage", { chat_id: chatId, text: plain, link_preview_options: { is_disabled: true }, ...markup });
}

/** Sends one of the editable order notifications to the order's owner if they use Telegram. Never throws. */
export async function notifyOrderOwner(orderId: string, key: "invoice_sent" | "paid" | "ready" | "failed") {
  if (!botConfigured()) return;
  try {
    const db = supabaseAdmin();
    const { data: o } = await db.from("orders").select("user_id,template_snapshot_json").eq("id", orderId).maybeSingle();
    if (!o?.user_id) return;
    const { data: p } = await db.from("profiles").select("telegram_id").eq("id", o.user_id).maybeSingle();
    if (!p?.telegram_id) return;
    const title = (o.template_snapshot_json as { title_kk?: string } | null)?.title_kk ?? "TrendMe";
    const m = await botMessage(key, { title });
    await sendMessage(Number(p.telegram_id), m.text, m.button ? { text: m.button, path: `/orders/${orderId}` } : null);
  } catch {
    console.error(JSON.stringify({ src: "telegram", event: "notify_failed" }));
  }
}

/** Uploads a video file to a chat (multipart, up to 50 MB). Returns false on any error; never logs the token. */
export async function sendVideoFile(chatId: number, file: Blob, fileName: string, caption?: string): Promise<boolean> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    fd.set("supports_streaming", "true");
    if (caption) fd.set("caption", caption);
    fd.set("video", file, fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: "POST", body: fd, signal: AbortSignal.timeout(90_000), cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error_code?: number } | null;
    if (!body?.ok) { console.error(JSON.stringify({ src: "telegram", event: "api_error", method: "sendVideo", code: body?.error_code ?? res.status })); return false; }
    return true;
  } catch {
    console.error(JSON.stringify({ src: "telegram", event: "api_unreachable", method: "sendVideo" }));
    return false;
  }
}

/** Sends a photo as a document (original quality, can be saved). */
export async function sendPhotoFile(chatId: number, file: Blob, fileName: string, caption?: string): Promise<boolean> {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  try {
    const fd = new FormData();
    fd.set("chat_id", String(chatId));
    if (caption) fd.set("caption", caption);
    fd.set("document", file, fileName);
    const res = await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", body: fd, signal: AbortSignal.timeout(60_000), cache: "no-store" });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error_code?: number } | null;
    if (!body?.ok) { console.error(JSON.stringify({ src: "telegram", event: "api_error", method: "sendDocument", code: body?.error_code ?? res.status })); return false; }
    return true;
  } catch {
    console.error(JSON.stringify({ src: "telegram", event: "api_unreachable", method: "sendDocument" }));
    return false;
  }
}

export const escapeHtml = (s: string) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!);
