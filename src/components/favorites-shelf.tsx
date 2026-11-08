"use client";
import { Heart } from "lucide-react";
import { ShelfRow } from "./shelf-row";
import { useFavorites } from "@/lib/favorites";
import { kk } from "@/lib/i18n/kk";

/** «Избранное»: templates saved with the heart on this device, first on the home page. */
export function FavoritesShelf() {
  const favs = useFavorites();
  if (!favs.length) return null;
  return (
    <section className="mt-4" aria-labelledby="shelf-favs">
      <div className="flex items-end gap-2 px-2.5 pb-3">
        <h2 id="shelf-favs" className="flex items-center gap-2 text-xl text-ink sm:text-2xl">
          <Heart size={20} className="fill-[#ff3b5c] text-[#ff3b5c]" aria-hidden />{kk.home2.favorites}
          <span className="align-middle font-sans text-sm text-muted">{favs.length}</span>
        </h2>
      </div>
      <ShelfRow items={favs} label={kk.home2.favorites} />
    </section>
  );
}
