"use client";
import { useEffect } from "react";
import { pauseHiddenVideos } from "@/lib/sound-handoff";

/** Card and sample videos keep playing after a client navigation unless something pauses them. */
export function PauseHiddenVideos() {
  useEffect(() => {
    const pause = () => pauseHiddenVideos();
    const onVis = () => { if (document.hidden) pause(); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", pause);
    const id = window.setInterval(pause, 500);
    pause();
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", pause);
      window.clearInterval(id);
    };
  }, []);
  return null;
}
