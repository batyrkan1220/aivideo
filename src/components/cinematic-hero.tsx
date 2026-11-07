import Link from "next/link";
import { ScanFace, Sparkles, Zap } from "lucide-react";
import { kk } from "@/lib/i18n/kk";
import { HeroVideo } from "./hero-video";

type Item = { id: string; title: string; coverUrl: string | null; previewUrl: string | null; animUrl?: string | null };

const h = kk.home;
const delay = (ms: number) => ({ animationDelay: `${ms}ms` });

/**
 * Cinematic home hero: the offer and the two actions on the left; on the right three real trend
 * templates in 3D depth, the front one playing with a neon rim and an AI scanner sweeping it.
 * Phones and the Mini App get the same pieces stacked (text, then the cards).
 */
export function CinematicHero({ items, newVideoHref }: { items: Item[]; newVideoHref: string }) {
  return (
    <section className="relative isolate overflow-hidden">
      <Atmosphere />
      <div className="mx-auto grid max-w-6xl items-center gap-6 px-4 pb-2 pt-4 sm:px-6 md:grid-cols-[1.05fr_0.95fr] md:gap-10 md:pb-16 md:pt-16">
        <div className="relative z-10 min-w-0">
          <span style={delay(0)} className="hero-rise inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs font-semibold text-[#9ca3af] backdrop-blur-xl sm:text-[13px]">
            <span className="relative flex h-2 w-2" aria-hidden>
              <span className="hero-blink absolute inset-0 rounded-full bg-[#00f0ff] shadow-[0_0_10px_#00f0ff]" />
            </span>
            {h.hxBadge}
          </span>

          <h1 className="mt-4 text-[2.1rem] font-bold leading-[1.02] tracking-[-0.035em] text-white sm:text-6xl md:mt-6 lg:text-[4.6rem]">
            <span style={delay(80)} className="hero-rise block">{h.hxLine1}</span>
            <span style={delay(160)} className="hero-rise block">
              {h.hxLine2a}{" "}
              <span className="font-accent relative inline-block pr-1 text-[#d4ff00] [text-shadow:0_0_32px_rgb(212_255_0/0.35)]">{h.hxAccent}</span>{" "}
              {h.hxLine2b}
            </span>
          </h1>

          <p style={delay(260)} className="hero-rise mt-3 max-w-xl text-[15px] leading-[1.55] sm:text-base sm:leading-[1.6] text-[#9ca3af] md:mt-6 md:text-lg">{h.hxLead}</p>

          <div style={delay(340)} className="hero-rise mt-5 flex flex-wrap items-center gap-3 md:mt-8">
            <Link href={newVideoHref} className="cta-neon inline-flex h-12 items-center gap-2 rounded-full bg-[#d4ff00] px-6 text-[15px] font-bold text-[#101014] shadow-[0_12px_32px_-12px_rgb(212_255_0/0.6)] sm:h-14 sm:px-7 sm:text-base">
              <Sparkles size={18} strokeWidth={2.4} aria-hidden />{kk.nav.createOwn}
            </Link>
            <a href="#templates" className="inline-flex h-12 items-center gap-2 rounded-full border border-white/12 bg-white/[0.03] px-6 text-[15px] font-semibold text-white backdrop-blur-xl transition-[background-color,border-color,transform] duration-300 hover:border-white/25 hover:bg-white/[0.08] active:scale-[0.98] sm:h-14 sm:px-7 sm:text-base">
              {h.hxPick}
            </a>
          </div>

          <dl style={delay(420)} className="hero-rise mt-6 hidden max-w-md grid-cols-3 gap-2 sm:grid md:mt-10 md:gap-3">
            {h.hxData.map((d) => (
              <div key={d.k} className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 backdrop-blur-xl md:px-4 md:py-3">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[#00f0ff]/80">{d.k}</dt>
                <dd className="mt-0.5 text-sm font-semibold text-white md:text-base">{d.v}</dd>
              </div>
            ))}
          </dl>
        </div>

        <div style={delay(200)} className="hero-rise min-w-0">
          <DepthStack items={items} />
        </div>
      </div>
    </section>
  );
}

/** Slow ambient mesh: dark emerald/lime and midnight violet light drifting behind everything. */
function Atmosphere() {
  return (
    <div className="pointer-events-none absolute inset-0 -z-10" aria-hidden>
      <div className="drift-a absolute -left-[15%] -top-[25%] h-[70%] w-[60%] rounded-full bg-[radial-gradient(closest-side,rgb(90_150_40/0.42),transparent)] blur-3xl" />
      <div className="drift-b absolute -right-[10%] top-[5%] h-[80%] w-[55%] rounded-full bg-[radial-gradient(closest-side,rgb(96_64_190/0.42),transparent)] blur-3xl" />
      <div className="drift-a absolute bottom-[-30%] left-[30%] h-[60%] w-[45%] rounded-full bg-[radial-gradient(closest-side,rgb(0_170_180/0.18),transparent)] blur-3xl [animation-delay:-9s]" />
      {/* Fine grid, fading out toward the edges. */}
      <div className="absolute inset-0 opacity-[0.07] [background-image:linear-gradient(rgb(255_255_255/0.6)_1px,transparent_1px),linear-gradient(90deg,rgb(255_255_255/0.6)_1px,transparent_1px)] [background-size:56px_56px] [mask-image:radial-gradient(ellipse_at_center,black,transparent_70%)]" />
      <div className="absolute inset-x-0 bottom-0 h-32 bg-gradient-to-b from-transparent to-[#101014]" />
    </div>
  );
}

const glass = "border border-white/10 bg-[rgb(10_10_14/0.55)] backdrop-blur-xl";

/** Three cards in 3D depth; the centre one plays, with a neon rim, face frame and scanner line. */
function DepthStack({ items }: { items: Item[] }) {
  if (!items.length) return <div className="h-[15rem] sm:h-[26rem] md:h-[34rem]" />;
  const [front, left, right] = items;
  const side = (t: Item | undefined, pos: "l" | "r") => t && (
    <Link href={`/templates/${t.id}`} tabIndex={-1} aria-hidden
      className={`absolute aspect-[9/16] h-[10.5rem] overflow-hidden rounded-[1.3rem] border border-white/10 bg-[#0b0b0e] opacity-60 shadow-[0_40px_80px_-30px_rgb(0_0_0/0.95)] transition-opacity duration-500 hover:opacity-90 sm:h-[18rem] md:h-[24rem] md:rounded-[1.6rem] ${
        pos === "l" ? "[transform:translateX(-62%)_translateZ(-140px)_rotateY(22deg)_rotateZ(-3deg)]" : "[transform:translateX(62%)_translateZ(-140px)_rotateY(-22deg)_rotateZ(3deg)]"}`}>
      {t.coverUrl && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={t.coverUrl} alt="" loading="eager" className="absolute inset-0 h-full w-full object-cover" />
      )}
      <span className="absolute inset-0 bg-gradient-to-t from-[#101014]/80 via-transparent to-[#101014]/20" />
    </Link>
  );
  return (
    <div className="relative mx-auto flex h-[15rem] w-full max-w-lg items-center justify-center [perspective:1400px] sm:h-[26rem] md:h-[34rem]" aria-label={kk.home.trendingTitle}>
      <div className="relative flex h-full w-full items-center justify-center [transform-style:preserve-3d]">
        {side(left, "l")}
        {side(right, "r")}
        <div className="hero-float relative z-10 [transform-style:preserve-3d]">
          <Link href={`/templates/${front.id}`}
            className="relative block aspect-[9/16] h-[13rem] overflow-hidden rounded-[1.5rem] border-[1.5px] border-[#d4ff00]/80 bg-[#0b0b0e] shadow-[0_0_0_1px_rgb(212_255_0/0.25),0_0_48px_-6px_rgb(212_255_0/0.45),0_50px_100px_-30px_rgb(0_0_0/0.95)] [transform:rotateY(-7deg)_rotateX(3deg)] sm:h-[22rem] md:h-[29rem] md:rounded-[1.9rem]">
            {front.coverUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={front.coverUrl} alt="" fetchPriority="high" loading="eager" className="absolute inset-0 h-full w-full object-cover" />
            )}
            {front.previewUrl && <HeroVideo src={front.previewUrl} poster={front.coverUrl ?? undefined} anim={front.animUrl ?? undefined} />}

            {/* AI scanner: a cyan line sweeping up and down with a soft trail. */}
            <span className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden>
              <span className="hero-scan absolute inset-x-0 top-0 h-full border-b-2 border-[#00f0ff] bg-gradient-to-b from-transparent via-transparent to-[#00f0ff]/25 shadow-[0_6px_18px_-2px_#00f0ff]" />
            </span>
            {/* Face frame. */}
            <span className="pointer-events-none absolute left-1/2 top-[16%] aspect-square w-[46%] -translate-x-1/2" aria-hidden>
              {["left-0 top-0 border-l-2 border-t-2 rounded-tl-lg", "right-0 top-0 border-r-2 border-t-2 rounded-tr-lg", "left-0 bottom-0 border-l-2 border-b-2 rounded-bl-lg", "right-0 bottom-0 border-r-2 border-b-2 rounded-br-lg"].map((c) => (
                <span key={c} className={`hero-blink absolute h-[22%] w-[22%] border-[#d4ff00] ${c}`} />
              ))}
            </span>
            {/* Status: generating, with a progress bar. */}
            <span className={`absolute left-2.5 top-2.5 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] font-semibold text-white sm:left-3 sm:top-3 sm:text-[11px] ${glass}`}>
              <span className="hero-blink h-1.5 w-1.5 rounded-full bg-[#00f0ff] shadow-[0_0_8px_#00f0ff]" aria-hidden />{h.hxScanning}
            </span>
            <span className={`absolute inset-x-2.5 bottom-2.5 rounded-2xl p-2.5 sm:inset-x-3 sm:bottom-3 sm:p-3 ${glass}`}>
              <span className="flex items-center justify-between gap-2 text-[10px] font-semibold text-white sm:text-xs">
                <span className="truncate">{front.title}</span>
                <span className="hidden shrink-0 text-[#00f0ff] sm:inline">{h.hxSwap}</span>
              </span>
              <span className="mt-2 block h-1 overflow-hidden rounded-full bg-white/10">
                <span className="hero-bar block h-full rounded-full bg-gradient-to-r from-[#00f0ff] to-[#d4ff00]" />
              </span>
            </span>
          </Link>

          {/* Floating data chips (wide screens). */}
          <span className={`absolute -left-[42%] top-[18%] hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-white md:inline-flex [transform:translateZ(60px)] ${glass}`}>
            <ScanFace size={16} className="text-[#00f0ff]" aria-hidden />{h.hxFace}
          </span>
          <span className={`absolute -right-[38%] bottom-[22%] hidden items-center gap-2 rounded-2xl px-3 py-2 text-xs font-semibold text-white md:inline-flex [transform:translateZ(60px)] ${glass}`}>
            <Zap size={15} className="text-[#d4ff00]" aria-hidden />{h.hxReady}
          </span>
        </div>
      </div>
    </div>
  );
}
