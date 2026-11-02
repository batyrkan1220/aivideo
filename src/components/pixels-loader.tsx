import { connection } from "next/server";
import { publicPixels } from "@/lib/pixels/settings";
import { Pixels } from "./pixels";

/** Reads which pixels are connected (Admin → Пиксели) and loads them on the site. */
export async function PixelsLoader() {
  await connection();
  const ids = await publicPixels().catch(() => null);
  if (!ids || !(ids.tiktok || ids.meta || ids.ga4 || ids.ym)) return null;
  return <Pixels ids={ids} />;
}
