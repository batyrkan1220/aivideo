"use client";
import { launchInitData, telegramApp } from "@/lib/telegram/client";

const BOT = "Trendmekzbot";

/** Small message at the bottom of the screen. */
export function toast(text: string) {
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.textContent = text;
  el.style.cssText = "position:fixed;left:50%;bottom:calc(6.5rem + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:300;background:#0e0e0e;color:#f5f4f1;padding:10px 16px;border-radius:999px;font:500 13px/1.3 system-ui,sans-serif;box-shadow:0 10px 30px -10px rgba(0,0,0,.5);transition:opacity .3s;max-width:calc(100vw - 32px)";
  document.body.append(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 1800);
}

/**
 * Shares a template: in Telegram — Telegram's own «send to chat» with a link that opens the Mini App
 * right on this template; elsewhere — the phone's share sheet, or the link is copied.
 */
export async function shareTemplate(id: string, title: string, copiedText: string) {
  const text = `${title} — сделай такое видео с собой в TrendMe`;
  const wa = telegramApp();
  if (wa?.openTelegramLink || launchInitData()) {
    const link = `https://t.me/${BOT}?startapp=t_${id}`;
    const url = `https://t.me/share/url?url=${encodeURIComponent(link)}&text=${encodeURIComponent(text)}`;
    if (wa?.openTelegramLink) wa.openTelegramLink(url); else window.open(url, "_blank");
    return;
  }
  const url = `${location.origin}/templates/${id}`;
  if (navigator.share) {
    try { await navigator.share({ title, text, url }); return; } catch (e) { if ((e as Error).name === "AbortError") return; }
  }
  try { await navigator.clipboard.writeText(url); toast(copiedText); } catch { window.prompt("", url); }
}
