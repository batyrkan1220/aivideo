"use client";
import { useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { pixelPageView } from "@/lib/pixels/client";
import type { PublicPixels } from "@/lib/pixels/settings";

/** Base codes of the connected tools (official snippets), injected once; never on admin pages. */
function inject(ids: PublicPixels) {
  const w = window as unknown as Record<string, unknown>;
  w.__tmPixels = { ym: ids.ym };
  const add = (code: string) => { const s = document.createElement("script"); s.text = code; document.head.appendChild(s); };
  if (ids.tiktok) add(`!function(w,d,t){w.TiktokAnalyticsObject=t;var ttq=w[t]=w[t]||[];ttq.methods=["page","track","identify","instances","debug","on","off","once","ready","alias","group","enableCookie","disableCookie","holdConsent","revokeConsent","grantConsent"],ttq.setAndDefer=function(t,e){t[e]=function(){t.push([e].concat(Array.prototype.slice.call(arguments,0)))}};for(var i=0;i<ttq.methods.length;i++)ttq.setAndDefer(ttq,ttq.methods[i]);ttq.instance=function(t){for(var e=ttq._i[t]||[],n=0;n<ttq.methods.length;n++)ttq.setAndDefer(e,ttq.methods[n]);return e},ttq.load=function(e,n){var r="https://analytics.tiktok.com/i18n/pixel/events.js",o=n&&n.partner;ttq._i=ttq._i||{},ttq._i[e]=[],ttq._i[e]._u=r,ttq._t=ttq._t||{},ttq._t[e]=+new Date,ttq._o=ttq._o||{},ttq._o[e]=n||{};n=document.createElement("script");n.type="text/javascript",n.async=!0,n.src=r+"?sdkid="+e+"&lib="+t;e=document.getElementsByTagName("script")[0];e.parentNode.insertBefore(n,e)};ttq.load(${JSON.stringify(ids.tiktok)});ttq.page();}(window,document,"ttq");`);
  if (ids.meta) add(`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;n.version="2.0";n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}(window,document,"script","https://connect.facebook.net/en_US/fbevents.js");fbq("init",${JSON.stringify(ids.meta)});fbq("track","PageView");`);
  if (ids.ga4) {
    const s = document.createElement("script"); s.async = true; s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(ids.ga4)}`; document.head.appendChild(s);
    add(`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}window.gtag=gtag;gtag("js",new Date());gtag("config",${JSON.stringify(ids.ga4)});`);
  }
  if (ids.ym) add(`(function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};m[i].l=1*new Date();for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r){return;}}k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})(window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");window.dataLayer=window.dataLayer||[];ym(${Number(ids.ym)},"init",{defer:true,clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true,ecommerce:"dataLayer"});ym(${Number(ids.ym)},"hit",location.href,{title:document.title,referer:document.referrer});`);
}

export function Pixels({ ids }: { ids: PublicPixels }) {
  const path = usePathname();
  const search = useSearchParams();
  const started = useRef(false);
  const last = useRef<string | null>(null);
  const any = !!(ids.tiktok || ids.meta || ids.ga4 || ids.ym);

  useEffect(() => {
    if (!any || path.startsWith("/admin")) return;
    const url = window.location.href;
    if (!started.current) { started.current = true; last.current = url; inject(ids); return; } // base codes count the first view
    if (last.current === url) return;
    last.current = url;
    pixelPageView(url);
  }, [path, search, any, ids]);
  return null;
}
