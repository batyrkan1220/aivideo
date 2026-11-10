import Link from "next/link";
import { ArrowDown, ScanFace } from "lucide-react";
import { kk } from "@/lib/i18n/kk";
import { HeroVideo } from "./hero-video";

export type HeroItem = { id: string; title: string; coverUrl: string | null; previewUrl: string | null; animUrl?: string | null };

const h = kk.home;

/**
 * Home hero, black and white: badge, headline with a bold keyword, lead, two actions, then three
 * real trend templates in 3D depth, the front one playing with an AI scanner sweeping it.
 * Phones and the Mini App get the same pieces, a little smaller.
 */
/** The hero's text and actions need no data, so they are in the page's instant shell; only the cards
 *  (`stack`) wait for the showcase. Going back to the home page then shows the hero at once, at its
 *  final size, instead of a placeholder that later grows. */
export function CinematicHero({ stack }: { stack: React.ReactNode }) {
  return (
    <section className="relative isolate overflow-hidden">
      {/* Phones: one centred column (text, then the cards).
          Tablets and desktops (768 px and up): two columns that fit the first screen, text and actions
          on the left, the cards on the right, with the full effects. The Mini App keeps the phone layout. */}
      <div className="mx-auto grid max-w-6xl items-center gap-4 px-4 pb-2 pt-5 sm:px-6 md:min-h-[min(calc(100svh-4rem),46rem)] md:grid-cols-[1.05fr_0.95fr] md:gap-6 md:py-10 lg:gap-10 lg:px-8">
        <div className="@container hero-rise relative z-20 flex flex-col items-center text-center md:items-start md:text-left">
          <p className="text-sm text-muted">{h.hxBadge}</p>

          <h1 className="mt-3 w-full max-w-4xl text-[min(2.6rem,9.1cqi)] leading-[1.1] text-ink md:mt-6 md:text-[min(4rem,9.1cqi)] md:leading-[1.06]">
            <span className="block whitespace-nowrap">{h.hxLine1} {h.hxLine2a}</span>
            <span className="block whitespace-nowrap">
              <span className="font-accent">{h.hxAccent}</span>{" "}{h.hxLine2b}
            </span>
          </h1>

          <p className="mt-3 max-w-[22rem] text-[15px] leading-[1.55] text-muted sm:max-w-xl sm:text-base md:mt-6 md:text-lg">{h.hxLead}</p>

          <div className="mt-5 flex w-full max-w-sm justify-center sm:w-auto md:mt-8 md:justify-start">
            <a href="#templates" className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-6 text-[15px] font-medium text-paper transition-[background-color,transform] duration-200 hover:bg-ink/85 active:scale-[0.98] sm:w-auto">
              {h.hxPick}<ArrowDown size={18} strokeWidth={1.75} aria-hidden />
            </a>
          </div>

          <p className="mt-3 flex items-center justify-center gap-2 text-xs text-muted tabular-nums md:hidden">
            {h.hxData.map((d, i) => (
              <span key={d.k} className="inline-flex items-center gap-2">{i > 0 && <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden />}{d.v}</span>
            ))}
          </p>

          <dl className="mt-8 hidden w-full max-w-xl grid-cols-3 gap-2 md:grid lg:mt-10 lg:gap-3">
            {h.hxData.map((d) => (
              <div key={d.k} className="rounded-xl border border-line/70 bg-surface px-4 py-3 text-left">
                <dt className="text-xs text-muted">{d.k}</dt>
                <dd className="mt-1 font-display text-base text-ink tabular-nums">{d.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div className="hero-fade mt-2 w-full md:mt-0">
          {stack}
        </div>
      </div>
    </section>
  );
}


// Solid tint, no backdrop blur: a blur over a playing video is recomputed every frame (tablets slowed down).
const glass = "border border-white/15 bg-black/60";
// Motion over the video (scanner, blinking frame) and the 3D tilt: tablets and desktops (md, 768 px+),
// like the desktop; phones keep the card flat and still so the video plays smoothly.
const chip = "border border-line bg-surface shadow-[0_16px_32px_-16px_rgb(0_0_0/0.35)]";

/** Three cards in 3D depth; the centre one plays, with a black rim, face frame and scanner line. */
/** Same box as the cards, while they load. */
export function DepthStackShell() {
  return <div className="mx-auto h-[17rem] w-full max-w-lg sm:h-[26rem] md:h-[25rem] lg:h-[31rem]" aria-hidden />;
}

export function DepthStack({ items }: { items: HeroItem[] }) {
  if (!items.length) return <DepthStackShell />;
  const [front, left, right] = items;
  const side = (t: HeroItem | undefined, pos: "l" | "r") => t && (
    <Link href={`/templates/${t.id}`} tabIndex={-1} aria-hidden
      className={`absolute aspect-[9/16] h-[12rem] overflow-hidden rounded-[1.3rem] border border-line bg-mist opacity-70 shadow-[0_30px_60px_-30px_rgb(0_0_0/0.45)] transition-opacity duration-500 hover:opacity-100 sm:h-[18rem] md:h-[17rem] lg:h-[24rem] md:rounded-[1.6rem] ${
        pos === "l" ? "[transform:translateX(-62%)_translateZ(-140px)_rotateY(22deg)_rotateZ(-3deg)]" : "[transform:translateX(62%)_translateZ(-140px)_rotateY(-22deg)_rotateZ(3deg)]"}`}>
      {t.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.coverUrl} alt="" loading="eager" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-paper/70 via-transparent to-paper/10" />
    </Link>
  );
  return (
    <div className="relative mx-auto flex h-[17rem] w-full max-w-lg items-center justify-center [perspective:1400px] sm:h-[26rem] md:h-[25rem] lg:h-[31rem]" aria-label={kk.home.trendingTitle}>
      <div className="relative flex h-full w-full items-center justify-center [transform-style:preserve-3d]">
        {side(left, "l")}
        {side(right, "r")}
        <div className="relative z-10 [transform-style:preserve-3d]">
          <Link href={`/templates/${front.id}`}
            className="relative block aspect-[9/16] h-[15rem] overflow-hidden rounded-[1.5rem] border-[3px] border-ink bg-ink shadow-[0_50px_90px_-30px_rgb(0_0_0/0.55)] md:[transform:rotateY(-7deg)_rotateX(3deg)] sm:h-[22rem] md:h-[21rem] lg:h-[27rem] md:rounded-[1.9rem]">
            {front.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={front.coverUrl} alt="" fetchPriority="high" loading="eager" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {front.previewUrl && <HeroVideo src={front.previewUrl} poster={front.coverUrl ?? undefined} anim={front.animUrl ?? undefined} />}
            {/* Signature: camera corners around the face, still. */}
            <span className="pointer-events-none absolute left-1/2 top-[16%] aspect-square w-[46%] -translate-x-1/2" aria-hidden>
              {["left-0 top-0 border-l-2 border-t-2 rounded-tl-lg", "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-lg", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-lg"].map((c) => (
                <span key={c} className={`absolute h-[22%] w-[22%] border-white/90 ${c}`} />
              ))}
            </span>
            <span className={`absolute inset-x-2.5 bottom-2.5 truncate rounded-xl px-3 py-2 font-display text-[11px] text-white sm:inset-x-3 sm:bottom-3 sm:text-xs ${glass}`}>{front.title}</span>
          </Link>

          {/* One still note next to the face frame: the product found the face. */}
          <span className={`absolute -left-[46%] top-[20%] inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-1.5 text-[10px] font-semibold text-ink sm:-left-[42%] sm:top-[18%] sm:gap-2 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-xs [transform:translateZ(60px)] ${chip}`}>
            <ScanFace className="h-3.5 w-3.5 text-ink sm:h-4 sm:w-4" aria-hidden />{h.hxFace}
          </span>
        </div>
      </div>
    </div>
  );
}
