"use server";
import { listTemplates } from "@/lib/templates/queries";
import type { CardData } from "@/components/template-card";

/** Next page of published videos for the home page's endless feed (desktop). */
export async function loadMoreVideos(page: number, category?: string, media: "video" | "photo" = "video"): Promise<{ items: CardData[]; hasMore: boolean }> {
  const p = Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1;
  const cat = typeof category === "string" && /^[a-z0-9-]{1,60}$/.test(category) ? category : undefined;
  const { items, total } = await listTemplates({ page: p, sort: "trending", category: cat, media: media === "photo" ? "photo" : "video" });
  const cards = items.map(({ id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, previewLiteUrl, isTrending }) =>
    ({ id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, previewLiteUrl, isTrending }));
  return { items: cards, hasMore: p * 12 < total };
}
