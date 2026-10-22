"use client";
import { useEffect, useRef, useState } from "react";
import { kk } from "@/lib/i18n/kk";

/**
 * Muted, looping, inline video that reliably autoplays — also inside the Telegram WebView,
 * where the `muted` attribute from server HTML is not always honoured. Pauses off-screen.
 * With `soundToggle`, a small button lets the viewer turn the sound on.
 */
export function AutoVideo(props: { src: string; poster?: string; controls?: boolean; soundToggle?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
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

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    if (!v.muted) v.play().catch(() => {});
  };

  return (
    <>
      <video ref={ref} src={props.src} poster={props.poster} controls={props.controls} muted loop playsInline autoPlay preload="auto" className={props.className} />
      {props.soundToggle && (
        <button
          type="button" onClick={toggle} aria-label={muted ? kk.video.soundOn : kk.video.soundOff}
          className="absolute right-3 top-3 z-10 flex h-10 w-10 items-center justify-center rounded-full bg-black/50 text-white backdrop-blur-sm transition-colors hover:bg-black/70"
        >
          <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M11 5 6 9H3v6h3l5 4z" />
            {muted ? <path d="m22 9-6 6M16 9l6 6" /> : <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" />}
          </svg>
        </button>
      )}
    </>
  );
}
