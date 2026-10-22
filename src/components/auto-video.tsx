"use client";
import { useEffect, useRef } from "react";

/**
 * Muted, looping, inline video that reliably autoplays — also inside the Telegram WebView,
 * where the `muted` attribute from server HTML is not always honoured. Pauses off-screen.
 */
export function AutoVideo(props: { src: string; poster?: string; controls?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true;
    v.defaultMuted = true;
    v.setAttribute("muted", "");
    const tryPlay = () => { v.play().catch(() => {}); };
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? tryPlay() : v.pause()), { threshold: 0.25 });
    io.observe(v);
    v.addEventListener("loadeddata", tryPlay);
    // Some WebViews only allow playback after the first touch.
    document.addEventListener("touchstart", tryPlay, { once: true, passive: true });
    return () => { io.disconnect(); v.removeEventListener("loadeddata", tryPlay); document.removeEventListener("touchstart", tryPlay); };
  }, [props.src]);
  return (
    <video ref={ref} src={props.src} poster={props.poster} controls={props.controls} muted loop playsInline autoPlay preload="auto" className={props.className} />
  );
}
