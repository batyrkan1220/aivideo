import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "./globals.css";
import { kk } from "@/lib/i18n/kk";

// Self-hosted Inter (body) + Unbounded (display); cyrillic-ext covers Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І

export const metadata: Metadata = {
  title: { default: kk.brand.name, template: `%s · ${kk.brand.name}` },
  description: kk.brand.tagline,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#fafafc" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
