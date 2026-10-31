import type { NextConfig } from "next";

const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co";

// Content-Security-Policy: scripts only from our origin (Next needs inline bootstrap),
// media/images/API only from our origin and the project's Supabase.
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://telegram.org",
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabase}`,
  `media-src 'self' blob: ${supabase}`,
  `connect-src 'self' ${supabase}`,
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
