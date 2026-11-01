"use client";
import { useEffect, useRef } from "react";
import { autoplayRefused, useImgPreviews } from "@/lib/video-autoplay";

/** Hero's front phone: muted autoplay loop; where autoplay is refused, an animated WebP. */
export function HeroVideo({ src, poster, anim }: { src: string; poster?: string; anim?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const imgMode = useImgPreviews();
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; v.defaultMuted = true;
    const tryPlay = () => v.play().catch((err) => { autoplayRefused(err); });
    if (v.readyState >= 2) tryPlay(); else v.addEventListener("loadeddata", tryPlay, { once: true });
    tryPlay();
  }, []);
  if (imgMode && anim) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={anim} alt="" aria-hidden className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />;
  }
  return (
    <video ref={ref} src={src} poster={poster} data-hero-video="" autoPlay muted loop playsInline preload="auto" aria-hidden
      className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />
  );
}
