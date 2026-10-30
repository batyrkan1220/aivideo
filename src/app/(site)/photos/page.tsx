import { Suspense } from "react";
import Link from "next/link";
import { connection } from "next/server";
import { kk } from "@/lib/i18n/kk";
import { listTemplates } from "@/lib/templates/queries";
import { GridSkeleton, pickCard } from "@/components/catalog-bits";
import { VideoFeed } from "@/components/video-feed";
import { Logo } from "@/components/logo";

export const metadata = { title: kk.photos.title };

/** AI photo templates (Kling image model): choose a style, upload a selfie, get a new photo. */
export default function PhotosPage() {
  return (
    <main className="mx-auto max-w-6xl px-4 pb-6 pt-3 md:pt-10">
      <div className="tg-only">
        <div className="mb-3 flex items-center justify-between gap-3">
          <Logo className="text-base" />
          <Link href="/create" className="btn-promo inline-flex h-9 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-bold">🔥 {kk.home.promo}</Link>
        </div>
      </div>
      <section className="relative overflow-hidden rounded-[24px] bg-surface p-5 ring-1 ring-black/5">
        <span className="section-title text-brand">{kk.photos.eyebrow}</span>
        <h1 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight">{kk.photos.title}</h1>
        <p className="mt-1.5 max-w-md text-sm text-muted">{kk.photos.lead}</p>
        <span className="pointer-events-none absolute -right-10 -top-10 h-40 w-40 rounded-full bg-brand/60 blur-3xl" aria-hidden />
      </section>
      <h2 className="section-title mb-3 mt-5 text-muted">{kk.photos.templatesTitle}</h2>
      <Suspense fallback={<GridSkeleton />}>
        <Feed />
      </Suspense>
    </main>
  );
}

async function Feed() {
  await connection();
  const first = await listTemplates({ page: 1, sort: "trending", media: "photo" });
  if (!first.items.length) {
    return (
      <div className="rounded-[20px] border border-dashed border-line bg-surface px-6 py-14 text-center">
        <p className="text-lg font-bold">{kk.photos.emptyTitle}</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-muted">{kk.photos.emptyText}</p>
        <Link href="/" className="btn-glow mt-5 inline-flex h-11 items-center rounded-full px-6 text-sm font-bold">{kk.photos.toVideos}</Link>
      </div>
    );
  }
  return <VideoFeed media="photo" initial={first.items.map(pickCard)} initialHasMore={first.items.length < first.total} priorityCount={4} />;
}
