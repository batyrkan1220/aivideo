import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";

// Content-Security-Policy: scripts only from our origin (Next needs inline bootstrap),
// media/images/API only from our origin and the project's Supabase.
// Ad pixels and analytics (TikTok, Meta, Google Analytics 4, Yandex Metrica) — loaded only when
// their IDs are set in Admin → Пиксели.
const ads = {
  script: "https://analytics.tiktok.com https://connect.facebook.net https://www.googletagmanager.com https://mc.yandex.ru https://mc.yandex.com https://yastatic.net",
  img: "https://*.tiktok.com https://www.facebook.com https://*.google-analytics.com https://*.googletagmanager.com https://mc.yandex.ru https://mc.yandex.com",
  connect: "https://*.tiktok.com https://www.facebook.com https://connect.facebook.net https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com https://mc.yandex.ru https://mc.yandex.com wss://mc.yandex.ru wss://mc.yandex.com",
  frame: "https://mc.yandex.ru https://mc.yandex.com",
};
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' https://telegram.org ${ads.script}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase} ${ads.img}`,
  `media-src 'self' blob: ${supabase}`,
  `connect-src 'self' ${supabase} ${ads.connect}`,
  `frame-src 'self' https://oauth.telegram.org ${ads.frame}`,
  "font-src 'self' data:",
  // Telegram Web/Desktop embeds Mini Apps in a frame; nobody else may.
  "frame-ancestors 'self' https://web.telegram.org https://*.telegram.org",
  "form-action 'self'",
  "base-uri 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: csp },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // ffmpeg binary for light card previews: resolved from node_modules at runtime, not bundled.
  serverExternalPackages: ["ffmpeg-static"],
  // The separate catalog page was merged into the home feed.
  async redirects() {
    return [{ source: "/templates", destination: "/", permanent: false }];
  },
  async headers() {
    return [
      { source: "/:path*", headers: securityHeaders },
      // The service worker script must always be re-checked so updates reach phones quickly.
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Service-Worker-Allowed", value: "/" }] },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
