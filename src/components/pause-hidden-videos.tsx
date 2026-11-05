"use client";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { pauseHiddenVideos } from "@/lib/sound-handoff";

/** Card and sample videos keep playing after a client navigation unless something pauses them. */
export function PauseHiddenVideos() {
  const pathname = usePathname();
  useEffect(() => {
    pauseHiddenVideos();
    const onVis = () => { if (document.hidden) pauseHiddenVideos(); };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, [pathname]);
  return null;
}
