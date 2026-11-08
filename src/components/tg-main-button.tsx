"use client";
import { useEffect, useState } from "react";
import { haptic, telegramApp, TG_READY_EVENT } from "@/lib/telegram/client";

/**
 * Telegram's native button under the Mini App: «Создать видео» on a template page until the order
 * form is on screen; a tap scrolls to it. Does nothing outside Telegram.
 */
export function TgMainButton({ text, targetId }: { text: string; targetId: string }) {
  const [ready, setReady] = useState(0);
  useEffect(() => {
    const on = () => setReady((n) => n + 1);
    window.addEventListener(TG_READY_EVENT, on);
    return () => window.removeEventListener(TG_READY_EVENT, on);
  }, []);

  useEffect(() => {
    const mb = telegramApp()?.MainButton;
    const target = document.getElementById(targetId);
    if (!mb || !target) return;
    const click = () => { haptic("tap"); target.scrollIntoView({ behavior: "smooth", block: "start" }); };
    mb.setParams({ text, color: "#0e0e0e", text_color: "#ffffff", has_shine_effect: true });
    mb.onClick(click);
    // Visible while the form is off screen.
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) mb.hide(); else mb.show(); }, { rootMargin: "0px 0px -35% 0px" });
    io.observe(target);
    return () => { io.disconnect(); mb.offClick(click); mb.hide(); };
  }, [text, targetId, ready]);
  return null;
}
