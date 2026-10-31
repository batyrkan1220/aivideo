"use client";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { kk } from "@/lib/i18n/kk";

const H = kk.createHub;

/** Video / AI-photo segmented switch: renders instantly (no server wait), the active side is black. */
export function CreateTabs() {
  const type = useSearchParams().get("type") === "photo" ? "photo" : "video";
  return <TabsView type={type} />;
}

export function TabsView({ type }: { type: "video" | "photo" }) {
  return (
    <div className="grid grid-cols-2 gap-1 rounded-full border border-line bg-surface p-1" role="tablist" aria-label={H.title}>
      {(["video", "photo"] as const).map((k) => (
        <Link key={k} href={k === "photo" ? "/create?type=photo" : "/create"} role="tab" aria-selected={type === k} replace scroll={false} prefetch
          className={`flex h-11 items-center justify-center gap-2 rounded-full text-sm font-bold transition-colors ${type === k ? "bg-night text-white" : "text-muted active:text-ink"}`}>
          {k === "video"
            ? <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="13" height="14" rx="3" /><path d="m16 10 5-3v10l-5-3z" /></svg>
            : <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden><rect x="3" y="5" width="18" height="15" rx="4" /><circle cx="12" cy="12.5" r="3.5" /><path d="M8 5l1.5-2h5L16 5" /></svg>}
          {H.tabs[k]}
        </Link>
      ))}
    </div>
  );
}
