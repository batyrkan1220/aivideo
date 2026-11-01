"use client";
import { useEffect, useRef } from "react";
import { autoplayRefused, imgPreviewFailed, useImgPreviews } from "@/lib/video-autoplay";

/** Hero's front phone: muted autoplay loop; on iOS Low Power Mode the MP4 plays through <img>. */
export function HeroVideo({ src, poster }: { src: string; poster?: string }) {
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
  if (imgMode) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt="" aria-hidden onError={imgPreviewFailed} className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />;
  }
  return (
    <video ref={ref} src={src} poster={poster} data-hero-video="" autoPlay muted loop playsInline preload="auto" aria-hidden
      className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden" />
  );
}
