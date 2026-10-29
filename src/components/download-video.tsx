"use client";
import { useState, useSyncExternalStore } from "react";
import { kk } from "@/lib/i18n/kk";
import { haptic, launchInitData, telegramApp } from "@/lib/telegram/client";

const r = kk.result;
const btn = "inline-flex h-12 items-center justify-center gap-2 rounded-full px-6 font-semibold transition-transform active:scale-[0.98]";

/**
 * Video download that also works inside the Telegram Mini App, where a plain download link does nothing:
 *  - Telegram 8.0+: the native save dialog (WebApp.downloadFile);
 *  - always in Telegram: the bot sends the video into the chat, where it can be saved to the gallery.
 * In a normal browser it is the usual download link.
 */
export function DownloadVideo({ orderId }: { orderId: string }) {
  const inTg = useSyncExternalStore(() => () => {}, () => !!launchInitData(), () => false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "too_large">("idle");
  const href = `/api/orders/${orderId}/video?download=1`;

  if (!inTg) {
    return <a href={href} className={`${btn} bg-brand text-white hover:bg-brand-dark`}>{r.download}</a>;
  }

  const sendToChat = async () => {
    if (state === "sending") return;
    haptic("tap");
    setState("sending");
    try {
      const res = await fetch(`/api/orders/${orderId}/video/telegram`, { method: "POST", credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      if (j.ok) { haptic("success"); setState("sent"); return; }
      haptic("error");
      setState(j.error === "too_large" ? "too_large" : "error");
    } catch {
      haptic("error");
      setState("error");
    }
  };

  const nativeDownload = async () => {
    const wa = telegramApp();
    if (!wa?.downloadFile || !wa.isVersionAtLeast?.("8.0")) return sendToChat();
    haptic("tap");
    try {
      const res = await fetch(`${href}&json=1`, { credentials: "same-origin" });
      const j = (await res.json()) as { url: string; fileName: string };
      wa.downloadFile({ url: j.url, file_name: j.fileName });
    } catch {
      return sendToChat();
    }
  };

  return (
    <div className="w-full space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={sendToChat} disabled={state === "sending"}
          className={`${btn} flex-1 bg-[#2AABEE] text-white disabled:opacity-70`}>
          {state === "sending" ? <><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />{r.sending}</> : <>✈️ {r.sendToChat}</>}
        </button>
        <button type="button" onClick={nativeDownload} className={`${btn} flex-1 border border-line bg-white text-ink`}>
          ⬇️ {r.download}
        </button>
      </div>
      <p className={`text-sm ${state === "sent" ? "font-medium text-success" : state === "error" || state === "too_large" ? "text-danger" : "text-muted"}`} aria-live="polite">
        {state === "sent" ? r.sentToChat : state === "error" ? r.sendFailed : state === "too_large" ? r.tooLarge : r.tgDownloadHint}
      </p>
    </div>
  );
}
