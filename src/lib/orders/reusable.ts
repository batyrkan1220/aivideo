import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export type ReusablePhoto = { assetId: string; url: string };

/**
 * The customer's own earlier photos that are still kept (newest first, one per order, at most 4),
 * with short-lived preview links — offered in the order form as "use this photo again".
 */
export async function reusablePhotos(userId: string): Promise<ReusablePhoto[]> {
  const db = supabaseAdmin();
  const { data } = await db.from("order_assets")
    .select("id,order_id,private_storage_path,face_slot_key,created_at")
    .eq("user_id", userId).not("order_id", "is", null).not("verified_at", "is", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false }).limit(30);
  const seen = new Set<string>(), picked: { id: string; path: string }[] = [];
  for (const a of data ?? []) {
    if (seen.has(a.order_id!)) continue;
    seen.add(a.order_id!);
    picked.push({ id: a.id, path: a.private_storage_path });
    if (picked.length >= 4) break;
  }
  if (!picked.length) return [];
  const { data: signed } = await db.storage.from("user-uploads").createSignedUrls(picked.map((p) => p.path), 3600);
  return picked.flatMap((p, i) => (signed?.[i]?.signedUrl ? [{ assetId: p.id, url: signed[i].signedUrl }] : []));
}
