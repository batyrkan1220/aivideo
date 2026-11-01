"use client";
import { useState } from "react";

/** Copies a link (Mini App deep link or site link) for ads and posts. */
export function CopyLink({ url, label }: { url: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button type="button" title={url}
      onClick={async () => { try { await navigator.clipboard.writeText(url); setDone(true); setTimeout(() => setDone(false), 1500); } catch { window.prompt("Скопируйте ссылку", url); } }}
      className="rounded-full border border-line px-3 py-1.5 text-xs font-semibold hover:border-ink">
      {done ? "✓ Скопировано" : label}
    </button>
  );
}
