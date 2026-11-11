"use client";
import { CircleFadingPlus, Download, Send, Share2 } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { kk } from "@/lib/i18n/kk";
import { haptic, launchInitData, telegramApp, tgSupports, TG_READY_EVENT } from "@/lib/telegram/client";

const r = kk.result;

/** iPhone / iPad (iPadOS reports itself as a Mac with touch). */
const isIOS = () => typeof navigator !== "undefined" && (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1));
/** Browsers inside Instagram, Facebook, TikTok…: downloads and the share sheet usually do not work there. */
const isInApp = () => typeof navigator !== "undefined" && /Instagram|FBAN|FBAV|FB_IAB|musical_ly|BytedanceWebview|TikTok|Line\//i.test(navigator.userAgent);
type Env = "ios" | "android" | "inapp" | "other";
const envNow = (): Env => (isInApp() ? "inapp" : isIOS() ? "ios" : /Android/i.test(typeof navigator !== "undefined" ? navigator.userAgent : "") ? "android" : "other");
const btn = "inline-flex h-13 items-center justify-center gap-2 rounded-full px-6 font-semibold transition-[transform,background-color] duration-200 active:scale-[0.98]";

/**
 * Video download that also works inside the Telegram Mini App, where a plain download link does nothing:
 *  - Telegram 8.0+: the native save dialog (WebApp.downloadFile);
 *  - always in Telegram: the bot sends the video into the chat, where it can be saved to the gallery.
 * In a normal browser it is the usual download link.
 */
export function DownloadVideo({ orderId, photo = false }: { orderId: string; photo?: boolean }) {
  const label = photo ? kk.photos.download : r.download;
  const inTg = useSyncExternalStore(() => () => {}, () => !!launchInitData(), () => false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error" | "too_large">("idle");
  const href = `/api/orders/${orderId}/video?download=1`;

  if (!inTg) return <SaveToGallery href={href} photo={photo} label={label} />;

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
      {/* One under the other: side by side «Отправить в чат Telegram» broke into 3 lines on a phone. */}
      <div className="grid gap-2">
        <button type="button" onClick={sendToChat} disabled={state === "sending"}
          className={`${btn} w-full whitespace-nowrap bg-[#2AABEE] text-white shadow-[0_12px_28px_-12px_rgba(42,171,238,0.9)] hover:bg-[#229ED9] disabled:opacity-70`}>
          {state === "sending" ? <><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />{r.sending}</> : <><Send size={18} aria-hidden />{r.sendToChat}</>}
        </button>
        <button type="button" onClick={nativeDownload} className={`${btn} w-full whitespace-nowrap border border-line bg-surface text-ink elev-xs hover:bg-mist`}>
          <Download size={18} aria-hidden />{label}
        </button>
      </div>
      <p className={`t-small text-center md:text-left ${state === "sent" ? "font-medium text-success" : state === "error" || state === "too_large" ? "text-danger" : "text-muted"}`} aria-live="polite">
        {state === "sent" ? r.sentToChat : state === "error" ? r.sendFailed : state === "too_large" ? r.tooLarge : r.tgDownloadHint}
      </p>
    </div>
  );
}

/** Photo combo: one tap sends every finished photo into the Telegram chat with the bot. */
export function SendComboToChat({ orderId }: { orderId: string }) {
  const inTg = useSyncExternalStore(() => () => {}, () => !!launchInitData(), () => false);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  if (!inTg) return <p className="text-center text-xs text-muted">{kk.result.tgDownloadHint}</p>;
  const send = async () => {
    if (state === "sending") return;
    haptic("tap");
    setState("sending");
    try {
      const res = await fetch(`/api/orders/${orderId}/combo/telegram`, { method: "POST", credentials: "same-origin" });
      const j = (await res.json().catch(() => ({}))) as { ok?: boolean };
      haptic(j.ok ? "success" : "error");
      setState(j.ok ? "sent" : "error");
    } catch {
      haptic("error");
      setState("error");
    }
  };
  return (
    <div className="space-y-2">
      <button type="button" onClick={send} disabled={state === "sending"}
        className={`${btn} w-full bg-[#2AABEE] text-white shadow-[0_12px_28px_-12px_rgba(42,171,238,0.9)] hover:bg-[#229ED9] disabled:opacity-70`}>
        {state === "sending" ? <><span className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-white" aria-hidden />{r.sending}</> : <><Send size={18} aria-hidden />{kk.combo.sendAll}</>}
      </button>
      <p className={`text-center text-sm ${state === "sent" ? "font-medium text-success" : state === "error" ? "text-danger" : "text-muted"}`} aria-live="polite">
        {state === "sent" ? kk.combo.sentAll : state === "error" ? r.sendFailed : ""}
      </p>
    </div>
  );
}

/** Phones: share the finished video file straight to Instagram, TikTok, WhatsApp… (Web Share with files). */
export function ShareVideo({ orderId, title, photo = false }: { orderId: string; title: string; photo?: boolean }) {
  const can = useSyncExternalStore(() => () => {}, () => typeof navigator !== "undefined" && "canShare" in navigator && !launchInitData() && !isIOS() && !isInApp(), () => false);
  const [busy, setBusy] = useState(false);
  if (!can) return null;
  const share = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/orders/${orderId}/video?download=1`, { credentials: "same-origin" });
      const blob = await res.blob();
      const file = new File([blob], photo ? "trendme.jpg" : "trendme.mp4", { type: blob.type || (photo ? "image/jpeg" : "video/mp4") });
      if (navigator.canShare?.({ files: [file] })) await navigator.share({ files: [file], title });
      else await navigator.share({ title, url: location.href });
    } catch { /* closed or not supported */ } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void share()} disabled={busy}
      className={`${btn} w-full border border-line bg-surface text-ink elev-xs hover:bg-mist disabled:opacity-70`}>
      {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" aria-hidden /> : <Share2 size={18} aria-hidden />}
      {r.share}
    </button>
  );
}

/** Telegram 7.8+: opens Telegram's story editor with the finished video or photo. */
export function ShareToStory({ orderId }: { orderId: string }) {
  const can = useSyncExternalStore(
    (cb) => { window.addEventListener(TG_READY_EVENT, cb); return () => window.removeEventListener(TG_READY_EVENT, cb); },
    () => !!telegramApp()?.shareToStory && tgSupports("7.8"), () => false,
  );
  const [busy, setBusy] = useState(false);
  if (!can) return null;
  const go = async () => {
    if (busy) return;
    setBusy(true);
    haptic("tap");
    try {
      const res = await fetch(`/api/orders/${orderId}/video?json=1`, { credentials: "same-origin" });
      const j = (await res.json().catch(() => null)) as { url?: string } | null;
      if (j?.url) telegramApp()?.shareToStory?.(j.url, { text: kk.result.storyText });
    } catch { /* closed */ } finally { setBusy(false); }
  };
  return (
    <button type="button" onClick={() => void go()} disabled={busy}
      className={`${btn} w-full border border-line bg-surface text-ink elev-xs hover:bg-mist disabled:opacity-70`}>
      {busy ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" aria-hidden /> : <CircleFadingPlus size={18} aria-hidden />}
      {kk.home2.story}
    </button>
  );
}

/**
 * Browser (not Telegram): straight into the phone's gallery where the phone allows it.
 *  - iPhone: a site cannot write to Photos; the share sheet can ("Сохранить видео"). The file is loaded
 *    in advance, so the sheet opens right on the tap (Safari needs the tap and the share together).
 *  - Android: a normal download goes to Downloads, which the gallery shows.
 *  - Instagram / TikTok in-app browsers: saving does not work there; say how to open the real browser.
 */
function SaveToGallery({ href, photo, label }: { href: string; photo: boolean; label: string }) {
  const env = useSyncExternalStore(() => () => {}, envNow, () => "other" as Env);
  const file = useRef<File | null>(null);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const canShareFiles = env === "ios" && typeof navigator !== "undefined" && "canShare" in navigator;

  useEffect(() => {
    if (!canShareFiles) return;
    let stop = false;
    fetch(href, { credentials: "same-origin" }).then((res) => (res.ok ? res.blob() : null)).then((blob) => {
      if (stop || !blob) return;
      const f = new File([blob], photo ? "trendme.jpg" : "trendme.mp4", { type: blob.type || (photo ? "image/jpeg" : "video/mp4") });
      if (navigator.canShare?.({ files: [f] })) { file.current = f; setReady(true); }
    }).catch(() => {});
    return () => { stop = true; };
  }, [canShareFiles, href, photo]);

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (!file.current) {
        // Not loaded yet: load now, then share (works while the tap still counts).
        const blob = await (await fetch(href, { credentials: "same-origin" })).blob();
        file.current = new File([blob], photo ? "trendme.jpg" : "trendme.mp4", { type: blob.type || (photo ? "image/jpeg" : "video/mp4") });
      }
      await navigator.share({ files: [file.current] });
    } catch (e) {
      // Closed by the user: nothing to do. Anything else: the plain download.
      if (!(e instanceof DOMException && e.name === "AbortError")) location.href = href;
    } finally {
      setBusy(false);
    }
  };

  const galleryLabel = photo ? r.savePhotoToGallery : r.saveToGallery;
  if (env === "ios" && canShareFiles) {
    return (
      <div className="w-full space-y-2">
        <button type="button" onClick={() => void save()} disabled={busy} className={`${btn} btn-glow w-full disabled:opacity-70`}>
          {busy || !ready ? <span className="h-5 w-5 animate-spin rounded-full border-2 border-black/15 border-t-black" aria-hidden /> : <Download size={18} strokeWidth={2.2} aria-hidden />}
          {!ready && !busy ? r.preparing : galleryLabel}
        </button>
        <p className="t-small text-center text-muted">{photo ? r.iosPhotoHint : r.iosHint}</p>
      </div>
    );
  }
  return (
    <div className="w-full space-y-2">
      <a href={href} className={`${btn} btn-glow w-full`}><Download size={18} strokeWidth={2.2} aria-hidden />{env === "android" ? galleryLabel : label}</a>
      {env === "android" && !photo && <p className="t-small text-center text-muted">{r.androidHint}</p>}
      {env === "inapp" && <p className="t-small text-center text-muted">{r.inAppHint}</p>}
    </div>
  );
}
