import { NextResponse } from "next/server";
import { resolveShowcase } from "@/lib/templates/showcase";

/** The home hero's three cards as JSON (public data; for the client-side fallback). */
export async function GET() {
  const items = (await resolveShowcase()).map(({ id, title, coverUrl, coverThumbUrl, previewUrl, previewLiteUrl, previewAnimUrl }) => (
    { id, title, coverUrl: coverThumbUrl ?? coverUrl, previewUrl: previewLiteUrl ?? previewUrl, animUrl: previewAnimUrl }));
  return NextResponse.json({ items }, { headers: { "cache-control": "public, max-age=60, stale-while-revalidate=600" } });
}
