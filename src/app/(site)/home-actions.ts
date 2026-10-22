"use server";
import { listTemplates } from "@/lib/templates/queries";
import type { CardData } from "@/components/template-card";

/** Next page of published videos for the home page's endless feed (desktop). */
export async function loadMoreVideos(page: number): Promise<{ items: CardData[]; hasMore: boolean }> {
  const p = Number.isInteger(page) && page >= 1 && page <= 500 ? page : 1;
  const { items, total } = await listTemplates({ page: p });
  const cards = items.map(({ id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, isTrending }) =>
    ({ id, title, description, faceCount, qualityLabels, startingPriceKzt, coverUrl, previewUrl, isTrending }));
  return { items: cards, hasMore: p * 12 < total };
}
