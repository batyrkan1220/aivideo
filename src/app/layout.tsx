import type { Metadata, Viewport } from "next";
import "@fontsource-variable/inter";
import "@fontsource-variable/unbounded";
import "./globals.css";
import { Suspense } from "react";
import { kk } from "@/lib/i18n/kk";
import { TelegramBridge } from "@/components/telegram-bridge";
import { SwRegister } from "@/components/sw-register";

// Self-hosted Inter (body) + Unbounded (display); cyrillic-ext covers Kazakh letters Ә Ғ Қ Ң Ө Ұ Ү Һ І

export const metadata: Metadata = {
  metadataBase: new URL(`https://${kk.brand.domain}`),
  title: { default: `${kk.brand.name} — ${kk.brand.tagline}`, template: `%s · ${kk.brand.name}` },
  description: kk.brand.description,
  applicationName: kk.brand.name,
  openGraph: {
    type: "website",
    siteName: kk.brand.name,
    url: "/",
    title: `${kk.brand.name} — ${kk.brand.tagline}`,
    description: kk.brand.description,
    locale: "ru_RU",
  },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#faf5f1" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="kk" className="h-full antialiased">
      <body className="flex min-h-full flex-col">
        {children}
        <Suspense fallback={null}>
          <TelegramBridge />
          <SwRegister />
        </Suspense>
      </body>
    </html>
  );
}
