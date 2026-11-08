"use client";
import { useEffect, useState, useSyncExternalStore } from "react";
import { MonitorSmartphone, X } from "lucide-react";
import { haptic, telegramApp, tgSupports, TG_READY_EVENT, launchInitData } from "@/lib/telegram/client";
import { installPromptReady, onInstallPrompt, promptInstall } from "@/lib/install-prompt";
import { kk } from "@/lib/i18n/kk";

type Mode = "telegram" | "prompt" | "ios" | null;

const isIosSafari = () => {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) && /Safari/.test(ua) && !/CriOS|FxiOS|Instagram|FBAN|FBAV|TikTok|Line\//.test(ua);
};
const standalone = () => window.matchMedia("(display-mode: standalone)").matches || (navigator as { standalone?: boolean }).standalone === true;

/**
 * «Добавить на главный экран»: Telegram's home-screen shortcut for the Mini App (Bot API 8.0+),
 * the browser's install prompt (Android / Chrome), or how-to steps on iPhone Safari.
 * Hidden when already installed or not possible.
 */
export function AddToHome() {
  const prompt = useSyncExternalStore(onInstallPrompt, installPromptReady, () => false);
  const [tgStatus, setTgStatus] = useState<string | null>(null);
  const [ios, setIos] = useState(false);
  const [help, setHelp] = useState(false);

  useEffect(() => {
    const check = () => {
      const wa = telegramApp();
      if (wa && tgSupports("8.0") && wa.checkHomeScreenStatus) wa.checkHomeScreenStatus((s) => setTgStatus(s));
    };
    check();
    window.addEventListener(TG_READY_EVENT, check);
    const wa = telegramApp();
    const added = () => setTgStatus("added");
    wa?.onEvent?.("homeScreenAdded", added);
    // iPhone Safari has no install prompt: show the steps instead.
    const t = setTimeout(() => setIos(!launchInitData() && !standalone() && isIosSafari()), 0);
    return () => { window.removeEventListener(TG_READY_EVENT, check); wa?.offEvent?.("homeScreenAdded", added); clearTimeout(t); };
  }, []);

  const mode: Mode = tgStatus === "missed" || tgStatus === "unknown" ? "telegram" : prompt ? "prompt" : ios ? "ios" : null;
  if (!mode) return null;

  const go = async () => {
    haptic("tap");
    if (mode === "telegram") telegramApp()?.addToHomeScreen?.();
    else if (mode === "prompt") await promptInstall();
    else setHelp(true);
  };

  return (
    <>
      <button type="button" onClick={() => void go()}
        className="mt-4 flex w-full items-center gap-3.5 rounded-card border border-line/80 bg-surface px-4 py-3.5 text-left transition-colors hover:bg-mist/60 sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-ink text-paper" aria-hidden><MonitorSmartphone size={18} /></span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-tight">{kk.home2.addHome}</span>
          <span className="mt-0.5 block text-xs text-muted">{kk.home2.addHomeHint}</span>
        </span>
      </button>
      {help && (
        <div role="dialog" aria-modal="true" aria-label={kk.home2.addHome} className="fixed inset-0 z-[120] flex items-end justify-center bg-black/40 p-4" onClick={() => setHelp(false)}>
          <div className="w-full max-w-sm rounded-[1.5rem] bg-surface p-5 pb-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-3">
              <p className="font-display text-lg">{kk.home2.addHome}</p>
              <button type="button" onClick={() => setHelp(false)} aria-label="Закрыть" className="-mr-1 -mt-1 flex h-9 w-9 items-center justify-center rounded-full hover:bg-mist"><X size={18} /></button>
            </div>
            <ol className="mt-3 space-y-2.5 text-[15px]">
              {kk.home2.iosSteps.map((s, i) => (
                <li key={s} className="flex gap-3"><span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-ink text-xs font-semibold text-paper">{i + 1}</span>{s}</li>
              ))}
            </ol>
          </div>
        </div>
      )}
    </>
  );
}
