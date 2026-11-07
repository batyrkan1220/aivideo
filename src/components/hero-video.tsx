"use client";
import { useEffect, useRef, useState } from "react";
import { autoplayRefused, useImgPreviews, useInTelegram } from "@/lib/video-autoplay";

/*
  Hero's front card: muted autoplay loop; where autoplay is refused (and in the Mini App), the
  animated WebP. Fast on every visit:
  - the cover (poster) paints at once, the video streams over it (preload="auto");
  - the light video is kept in the browser's Cache Storage after the first visit, so the next visit
    plays it from the phone without downloading (cache "tm-video-v1", a few files at most);
  - the animated WebP starts right away at low priority (it used to wait for the whole page to load).
*/
const VIDEO_CACHE = "tm-video-v1";
const MAX_CACHED = 6;

async function cachedBlobUrl(src: string): Promise<string | null> {
  try {
    if (!("caches" in window)) return null;
    const c = await caches.open(VIDEO_CACHE);
    const hit = await c.match(src);
    return hit ? URL.createObjectURL(await hit.blob()) : null;
  } catch {
    return null;
  }
}

/** After the video played from the network: keep a copy for the next visit (in the background). */
function keepForNextVisit(src: string) {
  try {
    if (!("caches" in window)) return;
    const idle = (f: () => void) => ("requestIdleCallback" in window ? window.requestIdleCallback(f, { timeout: 4000 }) : setTimeout(f, 1500));
    idle(async () => {
      try {
        const c = await caches.open(VIDEO_CACHE);
        if (await c.match(src)) return;
        const res = await fetch(src, { mode: "cors", credentials: "omit" });
        if (!res.ok || Number(res.headers.get("content-length") ?? 0) > 4 * 1024 * 1024) return;
        await c.put(src, res);
        const keys = await c.keys();
        for (let i = 0; i < keys.length - MAX_CACHED; i++) await c.delete(keys[i]);
      } catch { /* quota, offline: skip */ }
    });
  } catch { /* ignore */ }
}

export function HeroVideo({ src, poster, anim }: { src: string; poster?: string; anim?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const tg = useInTelegram();
  const imgMode = useImgPreviews() || (tg && !!anim);
  const [local, setLocal] = useState<string | null>(null);

  // A copy from the last visit plays instantly; otherwise the network one, kept for next time.
  useEffect(() => {
    if (imgMode) return;
    let alive = true;
    let url: string | null = null;
    void cachedBlobUrl(src).then((u) => {
      if (!alive) { if (u) URL.revokeObjectURL(u); return; }
      if (u) { url = u; setLocal(u); } else keepForNextVisit(src);
    });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [src, imgMode]);

  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    v.muted = true; v.defaultMuted = true;
    const tryPlay = () => v.play().catch((err) => { autoplayRefused(err); });
    if (v.readyState >= 2) tryPlay(); else v.addEventListener("loadeddata", tryPlay, { once: true });
    tryPlay();
    // Neither playing nor refused after a few seconds (some iOS WebViews): use the animated image.
    const t = window.setTimeout(() => { if (v.paused && v.readyState >= 1) autoplayRefused({ name: "NotAllowedError" }); }, 3500);
    return () => window.clearTimeout(t);
  }, [local]);

  if (imgMode && anim) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={anim} alt="" aria-hidden fetchPriority="low" decoding="async" className="absolute inset-0 h-full w-full object-cover" />;
  }
  return (
    <video ref={ref} src={local ?? src} poster={poster} data-hero-video="" autoPlay muted loop playsInline preload="auto" aria-hidden
      className="absolute inset-0 h-full w-full object-cover" />
  );
}
