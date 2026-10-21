import { Suspense } from "react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { MobileNav } from "@/components/mobile-nav";

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
      <Suspense fallback={null}>
        <MobileNav />
      </Suspense>
      {/* keeps the footer clear of the fixed bottom bar on phones */}
      <div className="h-16 sm:hidden" aria-hidden />
    </>
  );
}
