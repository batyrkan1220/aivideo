"use client";
import { useEffect } from "react";
import { captureInstallPrompt } from "@/lib/install-prompt";

/** Registers the service worker (app code + template covers cached on the device). Production only. */
export function SwRegister() {
  useEffect(() => { captureInstallPrompt(); }, []);
  useEffect(() => {
    if (process.env.NODE_ENV !== "production" || !("serviceWorker" in navigator)) return;
    const go = () => navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {});
    if (document.readyState === "complete") go();
    else window.addEventListener("load", go, { once: true });
  }, []);
  return null;
}
