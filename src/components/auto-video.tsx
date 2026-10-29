"use client";
import { useEffect, useRef, useState } from "react";
import { kk } from "@/lib/i18n/kk";

/**
 * Muted, looping, inline video that reliably autoplays — also inside the Telegram WebView,
 * where the `muted` attribute from server HTML is not always honoured. Pauses off-screen.
 * With `soundToggle`, a small button lets the viewer turn the sound on.
 */
const SOUND_KEY = "trendme.videoSound";
const soundOff = () => { try { return sessionStorage.getItem(SOUND_KEY) === "off"; } catch { return false; } };
const rememberSound = (on: boolean) => { try { sessionStorage.setItem(SOUND_KEY, on ? "on" : "off"); } catch { /* ignore */ } };

/**
 * `preferSound`: start with sound. Opening the page is a tap, so most browsers and the Telegram
 * WebView allow it; where they refuse, the video plays muted and the sound turns on at the
 * viewer's first touch. Once the viewer mutes it, it stays muted for the session.
 */
export function AutoVideo(props: { src: string; poster?: string; controls?: boolean; soundToggle?: boolean; preferSound?: boolean; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let alive = true;
    const wantSound = !!props.preferSound && !soundOff();
    const playMuted = () => {
      v.muted = true;
      v.defaultMuted = true;
      v.setAttribute("muted", "");
      setMuted(true);
      v.play().catch(() => {});
    };
    const playWithSound = () => {
      if (!alive) return Promise.resolve(true);
      v.muted = false;
      v.removeAttribute("muted");
      return v.play().then(() => { setMuted(false); return true; }).catch(() => false);
    };
    const tryPlay = () => { v.play().catch(() => {}); };
    // Blocked autoplay with sound: turn the sound on at the first touch anywhere.
    const unmuteOnTouch = (e: Event) => {
      if ((e.target as Element | null)?.closest?.("[data-sound-toggle]")) return; // the toggle handles itself
      document.removeEventListener("pointerdown", unmuteOnTouch);
      if (!soundOff()) void playWithSound();
    };
    if (wantSound) {
      void playWithSound().then((ok) => {
        if (ok || !alive) return;
        playMuted();
        document.addEventListener("pointerdown", unmuteOnTouch, { passive: true });
      });
    } else {
      playMuted();
    }
    const io = new IntersectionObserver(([e]) => (e.isIntersecting ? tryPlay() : v.pause()), { threshold: 0.25 });
    io.observe(v);
    v.addEventListener("loadeddata", tryPlay);
    // Some WebViews only allow playback after the first touch.
    document.addEventListener("touchstart", tryPlay, { once: true, passive: true });
    // Mini App minimised / tab hidden: stop the sound; resume when it comes back.
    const onVisibility = () => { if (document.hidden) v.pause(); else if (v.isConnected) tryPlay(); };
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      io.disconnect(); v.removeEventListener("loadeddata", tryPlay);
      document.removeEventListener("touchstart", tryPlay); document.removeEventListener("pointerdown", unmuteOnTouch);
      document.removeEventListener("visibilitychange", onVisibility);
      // Leaving the page (Back in Telegram): the router may keep this page alive in the
      // background, so silence and stop the video explicitly.
      alive = false;
      v.muted = true;
      v.pause();
    };
  }, [props.src, props.preferSound]);

  const toggle = () => {
    const v = ref.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    rememberSound(!v.muted);
    if (!v.muted) v.play().catch(() => {});
  };

  return (
    <>
      <video ref={ref} src={props.src} poster={props.poster} controls={props.controls} muted={!props.preferSound} loop playsInline autoPlay preload="auto" className={props.className} />
      {props.soundToggle && (
        <button
          type="button" onClick={toggle} data-sound-toggle aria-label={muted ? kk.video.soundOn : kk.video.soundOff}
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
