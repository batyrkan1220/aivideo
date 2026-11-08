"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Re-fetches the server page every few seconds while the tab is visible (new customer messages). */
export function AutoRefresh({ seconds = 10 }: { seconds?: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") router.refresh(); }, seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
