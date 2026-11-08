import Link from "next/link";
import { ArrowDown, ScanFace, Sparkles, Zap } from "lucide-react";
import { kk } from "@/lib/i18n/kk";
import { HeroVideo } from "./hero-video";

export type HeroItem = { id: string; title: string; coverUrl: string | null; previewUrl: string | null; animUrl?: string | null };

const h = kk.home;
const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

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
      <Atmosphere />
      {/* Phones: one centred column (text, then the cards).
          Tablets and desktops (768 px and up): two columns that fit the first screen, text and actions
          on the left, the cards on the right, with the full effects. The Mini App keeps the phone layout. */}
      <div className="mx-auto grid max-w-6xl items-center gap-4 px-4 pb-2 pt-5 sm:px-6 md:min-h-[min(calc(100svh-4rem),46rem)] md:grid-cols-[1.05fr_0.95fr] md:gap-6 md:py-10 lg:gap-10 lg:px-8">
        <div className="@container relative z-20 flex flex-col items-center text-center md:items-start md:text-left">
          <span style={delay(0)} className="hero-rise inline-flex items-center gap-2 rounded-full border border-line bg-surface/80 px-3 py-1.5 text-xs font-medium text-muted backdrop-blur-xl sm:text-[13px]">
            <span className="hero-blink h-1.5 w-1.5 rounded-full bg-[#22c55e] shadow-[0_0_0_3px_rgb(34_197_94/0.18)]" aria-hidden />
            {h.hxBadge}
          </span>

          <h1 className="mt-3.5 w-full max-w-4xl text-[min(2.6rem,9.1cqi)] leading-[1.1] text-ink md:mt-6 md:text-[min(4rem,9.1cqi)] md:leading-[1.06]">
            <span style={delay(80)} className="hero-rise block whitespace-nowrap">{h.hxLine1} {h.hxLine2a}</span>
            <span style={delay(160)} className="hero-rise block whitespace-nowrap">
              <span className="font-accent">{h.hxAccent}</span>{" "}{h.hxLine2b}
            </span>
          </h1>

          <p style={delay(260)} className="hero-rise mt-3 max-w-[22rem] text-[15px] leading-[1.55] text-muted sm:max-w-xl sm:text-base md:mt-6 md:text-lg">{h.hxLead}</p>

          <div style={delay(340)} className="hero-rise mt-5 flex w-full max-w-sm justify-center sm:w-auto md:mt-8 md:justify-start">
            <a href="#templates" className="cta-ai inline-flex h-13 w-full items-center justify-center gap-2.5 rounded-2xl px-7 text-[15px] font-semibold sm:w-auto sm:text-base">
              <span className="ai-glow" aria-hidden />
              <Sparkles size={18} strokeWidth={2.2} className="ai-spark text-[#c8b8ff]" aria-hidden />
              <span className="ai-text">{h.hxPick}</span>
              <ArrowDown size={17} strokeWidth={2.4} className="ai-down text-white/90" aria-hidden />
            </a>
          </div>

          <p style={delay(400)} className="hero-rise mt-3 flex items-center justify-center gap-2 text-[12px] font-medium text-muted md:hidden">
            {h.hxData.map((d, i) => (
              <span key={d.k} className="inline-flex items-center gap-2">{i > 0 && <span className="h-1 w-1 rounded-full bg-line-strong" aria-hidden />}{d.v}</span>
            ))}
          </p>

          <dl style={delay(420)} className="hero-rise mt-8 hidden w-full max-w-xl grid-cols-3 gap-2 md:grid lg:mt-10 lg:gap-3">
            {h.hxData.map((d) => (
              <div key={d.k} className="rounded-2xl border border-line/70 bg-surface px-3 py-3 text-left elev-sm lg:px-4">
                <dt className="text-[11px] font-medium uppercase tracking-[0.12em] text-muted">{d.k}</dt>
                <dd className="mt-1 font-display text-base text-ink">{d.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div style={delay(220)} className="hero-fade mt-2 w-full md:mt-0">
          {stack}
        </div>
      </div>
    </section>
  );
}

/** Soft daylight behind the hero: two slow grey glows and a faint grid, fading into the page. */
function Atmosphere() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <div className="drift-a absolute -left-[15%] -top-[30%] h-[70%] w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(255_255_255/0.95),transparent)] blur-2xl" />
      <div className="drift-b absolute -right-[10%] top-[10%] h-[70%] w-[50%] rounded-full bg-[radial-gradient(closest-side,rgb(0_0_0/0.05),transparent)] blur-3xl" />
      <div className="absolute inset-0 opacity-[0.5] [background-image:linear-gradient(rgb(0_0_0/0.05)_1px,transparent_1px),linear-gradient(90deg,rgb(0_0_0/0.05)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-paper" />
    </div>
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

            {/* AI scanner: a cyan line sweeping up and down with a soft trail. */}
            <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <span className={`absolute inset-x-0 top-0 hidden h-full border-b-2 border-white bg-gradient-to-b will-change-transform from-transparent via-transparent to-white/20 md:block md:animate-[tm-scan_3.2s_cubic-bezier(0.45,0,0.55,1)_infinite_alternate]`} />
            </span>
            {/* Face frame. */}
            <span className="pointer-events-none absolute left-1/2 top-[16%] aspect-square w-[46%] -translate-x-1/2" aria-hidden>
              {["left-0 top-0 border-l-2 border-t-2 rounded-tl-lg", "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-lg", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-lg"].map((c) => (
                <span key={c} className={`absolute h-[22%] w-[22%] border-white/90 ${c} md:animate-[tm-blink_1.6s_ease-in-out_infinite]`} />
              ))}
            </span>
            {/* Status: generating, with a progress bar. */}
            <span className={`absolute left-2 top-2 inline-flex max-w-[calc(100%-1rem)] items-center gap-1 whitespace-nowrap rounded-full px-2 py-1 text-[9px] font-semibold sm:left-3 sm:top-3 sm:gap-1.5 sm:px-2.5 sm:text-[11px] text-white ${glass}`}>
              <span className="h-1.5 w-1.5 rounded-full bg-white" aria-hidden />{h.hxScanning}
            </span>
            <span className={`absolute inset-x-2.5 bottom-2.5 rounded-2xl p-2.5 sm:inset-x-3 sm:bottom-3 sm:p-3 ${glass}`}>
              <span className="flex items-center justify-between gap-2 text-[10px] font-semibold text-white sm:text-xs">
                <span className="truncate font-display">{front.title}</span>
                <span className="hidden shrink-0 text-white/70 sm:inline">{h.hxSwap}</span>
              </span>
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10">
                <span className="hero-bar block h-full w-full origin-left rounded-full bg-white" />
              </span>
            </span>
          </Link>

          {/* Floating data chips: "Лицо найдено" on every screen (smaller on phones), "Готово" on wide ones. */}
          <span className={`absolute -left-[46%] top-[20%] inline-flex items-center gap-1.5 whitespace-nowrap rounded-xl px-2 py-1.5 text-[10px] font-semibold text-ink sm:-left-[42%] sm:top-[18%] sm:gap-2 sm:rounded-2xl sm:px-3 sm:py-2 sm:text-xs [transform:translateZ(60px)] ${chip}`}>
            <ScanFace className="h-3.5 w-3.5 text-ink sm:h-4 sm:w-4" aria-hidden />{h.hxFace}
          </span>
          <span className={`absolute -right-[38%] bottom-[22%] hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-ink lg:inline-flex [transform:translateZ(60px)] ${chip}`}>
            <Zap size={15} className="text-ink" aria-hidden />{h.hxReady}
          </span>
        </div>
      </div>
    </div>
  );
}
