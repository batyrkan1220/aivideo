"use client";
import { Heart, Share2 } from "lucide-react";
import type { CardData } from "@/components/template-card";
import { toggleFavorite, useIsFavorite } from "@/lib/favorites";
import { shareTemplate, toast } from "@/lib/share";
import { haptic } from "@/lib/telegram/client";
import { kk } from "@/lib/i18n/kk";

const H = kk.home2;

/** Heart on a template card: save to «Избранное» on this device. Sits inside the card's link. */
export function FavoriteButton({ t, className = "" }: { t: CardData; className?: string }) {
  const on = useIsFavorite(t.id);
  return (
    <button type="button" aria-pressed={on} aria-label={on ? H.unsaved : H.favorites}
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); const now = toggleFavorite(t); haptic(now ? "success" : "select"); toast(now ? H.saved : H.unsaved); }}
      className={`flex h-8 w-8 items-center justify-center rounded-full bg-black/35 text-white backdrop-blur-sm transition-transform active:scale-90 sm:h-9 sm:w-9 ${className}`}>
      <Heart size={16} strokeWidth={2.2} className={on ? "fill-[#ff3b5c] text-[#ff3b5c]" : ""} aria-hidden />
    </button>
  );
}

/** Quick bar on the template page: favourite + share. */
export function TemplateQuickActions({ t }: { t: CardData }) {
  const on = useIsFavorite(t.id);
  const btn = "inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-4 text-sm font-medium transition-colors hover:border-ink active:scale-[0.97]";
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" aria-pressed={on} onClick={() => { const now = toggleFavorite(t); haptic(now ? "success" : "select"); toast(now ? H.saved : H.unsaved); }} className={btn}>
        <Heart size={16} strokeWidth={2.2} className={on ? "fill-[#ff3b5c] text-[#ff3b5c]" : ""} aria-hidden />{H.favorites}
      </button>
      <button type="button" onClick={() => { haptic("tap"); void shareTemplate(t.id, t.title, H.linkCopied); }} className={btn}>
        <Share2 size={16} aria-hidden />{H.share}
      </button>
    </div>
  );
}
