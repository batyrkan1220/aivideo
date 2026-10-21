import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "./globals.css";
import { kk } from "@/lib/i18n/kk";

// Self-hosted Inter Variable; its cyrillic-ext subset covers Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І

export const metadata: Metadata = {
  title: { default: kk.brand.name, template: `%s · ${kk.brand.name}` },
  description: kk.brand.tagline,
};

export const viewport: Viewport = { width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className="h-full antialiased">
      <body className="flex min-h-full flex-col bg-white font-sans text-neutral-900">{children}</body>
    </html>
  );
}
