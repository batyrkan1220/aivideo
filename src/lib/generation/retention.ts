import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

const ACTIVE = ["queued", "processing", "postprocessing"];
const BATCH = 200;

/**
 * Daily retention:
 *  - photos past expires_at (never while their order is being generated) → file + row removed
 *  - generated videos past expires_at → file removed (row kept so the UI can say "expired")
 *  - limiter rows older than a day, processed webhook ids older than 90 days → removed
 */
export async function runRetention() {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const out = { photos: 0, videos: 0 };

  for (let round = 0; round < 20; round++) {
    const { data: assets } = await db.from("order_assets")
      .select("id,order_id,private_storage_path,orders(generation_status)")
      .lt("expires_at", now).limit(BATCH);
    const due = (assets ?? []).filter((a) => {
      const o = (Array.isArray(a.orders) ? a.orders[0] : a.orders) as { generation_status?: string } | null;
      return !o || !ACTIVE.includes(o.generation_status ?? "");
    });
    if (!due.length) break;
    await db.storage.from("user-uploads").remove(due.map((a) => a.private_storage_path));
    await db.from("order_assets").delete().in("id", due.map((a) => a.id));
    const orderIds = [...new Set(due.map((a) => a.order_id).filter(Boolean))] as string[];
    if (orderIds.length) await db.from("orders").update({ photos_deleted_at: now }).in("id", orderIds).is("photos_deleted_at", null);
    out.photos += due.length;
    if (due.length < BATCH) break;
  }

  const { data: videos } = await db.from("generated_videos")
    .select("order_id,private_storage_path").lt("expires_at", now).neq("private_storage_path", "").limit(1000);
  if (videos?.length) {
    await db.storage.from("generated-videos").remove(videos.map((v) => v.private_storage_path));
    await db.from("generated_videos").update({ private_storage_path: "" }).in("order_id", videos.map((v) => v.order_id));
    out.videos = videos.length;
  }

  await db.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400_000).toISOString());
  await db.from("webhook_events").delete()
    .lt("created_at", new Date(Date.now() - 90 * 86400_000).toISOString()).not("processed_at", "is", null);
  return out;
}
