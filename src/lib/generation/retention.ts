import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

const ACTIVE = ["queued", "processing", "postprocessing"];
const BATCH = 200;

/**
 * Daily retention:
 *  - photos past expires_at (never while their order is being generated) → file + row removed
 *  - generated videos past expires_at → file removed (row kept so the UI can say "expired")
 *  - limiter rows older than a day, processed webhook ids older than 90 days → removed
 *  - files in the private buckets that no row points to any more (older than a day) → removed
 */
export async function runRetention() {
  const db = supabaseAdmin();
  const now = new Date().toISOString();
  const out = { photos: 0, videos: 0, orphans: 0 };

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
    if (orderIds.length) {
      await db.from("orders").update({ photos_deleted_at: now }).in("id", orderIds).is("photos_deleted_at", null);
      await removeSheets(orderIds);
    }
    out.photos += due.length;
    if (due.length < BATCH) break;
  }

  // Customer source videos ("Өз видеом") past expires_at, never while their order is generating.
  const { data: srcVideos } = await db.from("order_videos")
    .select("id,storage_path,orders(generation_status)").lt("expires_at", now).limit(BATCH);
  const srcDue = (srcVideos ?? []).filter((v) => {
    const o = (Array.isArray(v.orders) ? v.orders[0] : v.orders) as { generation_status?: string } | null;
    return !o || !ACTIVE.includes(o.generation_status ?? "");
  });
  if (srcDue.length) {
    await db.storage.from("user-videos").remove(srcDue.flatMap((v) => [v.storage_path, `${v.storage_path}.kling.mp4`]));
    await db.from("order_videos").delete().in("id", srcDue.map((v) => v.id));
  }

  const { data: videos } = await db.from("generated_videos")
    .select("order_id,private_storage_path").lt("expires_at", now).neq("private_storage_path", "").limit(1000);
  if (videos?.length) {
    await db.storage.from("generated-videos").remove(videos.flatMap((v) => [v.private_storage_path, `${v.private_storage_path}.poster.webp`]));
    await db.from("generated_videos").update({ private_storage_path: "" }).in("order_id", videos.map((v) => v.order_id));
    out.videos = videos.length;
  }

  // Автомонтаж: finished videos after their 30 days; drafts never started (their clips go with the orphans).
  const { data: montages } = await db.from("montages").select("id,output_path").lt("expires_at", now).not("output_path", "is", null).limit(500);
  if (montages?.length) {
    await db.storage.from("generated-videos").remove(montages.map((m) => m.output_path as string));
    await db.from("montages").update({ output_path: null }).in("id", montages.map((m) => m.id));
  }
  await db.from("montages").delete().eq("status", "draft").lt("created_at", new Date(Date.now() - 2 * 86400_000).toISOString());

  out.orphans = await sweepOrphans();

  await db.from("rate_limits").delete().lt("window_start", new Date(Date.now() - 86400_000).toISOString());
  await db.from("webhook_events").delete()
    .lt("created_at", new Date(Date.now() - 90 * 86400_000).toISOString()).not("processed_at", "is", null);
  // Support chats: messages older than 180 days; the bot's message-id map after 30 days.
  const half = new Date(Date.now() - 180 * 86400_000).toISOString();
  await db.from("support_entries").delete().lt("created_at", half);
  await db.from("support_threads").delete().lt("last_message_at", half);
  await db.from("support_messages").delete().lt("created_at", new Date(Date.now() - 30 * 86400_000).toISOString());
  return out;
}

/** Private files with no database row (e.g. after a data reset or a failed upload), older than a day. */
async function sweepOrphans(): Promise<number> {
  const db = supabaseAdmin();
  const cutoff = Date.now() - 86400_000;
  const buckets: { bucket: string; table: "order_assets" | "order_videos" | "generated_videos"; col: string }[] = [
    { bucket: "user-uploads", table: "order_assets", col: "private_storage_path" },
    { bucket: "user-videos", table: "order_videos", col: "storage_path" },
    { bucket: "generated-videos", table: "generated_videos", col: "private_storage_path" },
  ];
  let removed = 0;
  for (const b of buckets) {
    const files: string[] = [];
    const walk = async (prefix: string, depth: number) => {
      const { data } = await db.storage.from(b.bucket).list(prefix, { limit: 1000 });
      for (const e of data ?? []) {
        const path = prefix ? `${prefix}/${e.name}` : e.name;
        if (!e.id) { if (depth < 3) await walk(path, depth + 1); continue; }
        const at = Date.parse((e.created_at as string | undefined) ?? "");
        if (Number.isFinite(at) && at < cutoff) files.push(path);
      }
    };
    try { await walk("", 0); } catch { continue; }
    if (b.bucket === "user-uploads") {
      // Character Sheets (sheets/<order>/…) live while their order still has its photos.
      const sheets = files.filter((f) => f.startsWith("sheets/"));
      const ids = [...new Set(sheets.map((f) => f.split("/")[1]))];
      const live = new Set<string>();
      for (let i = 0; i < ids.length; i += 100) {
        const { data } = await db.from("orders").select("id").in("id", ids.slice(i, i + 100).filter((x) => /^[0-9a-f-]{36}$/i.test(x))).is("photos_deleted_at", null);
        for (const r of data ?? []) live.add(r.id as string);
      }
      const stale = sheets.filter((f) => !live.has(f.split("/")[1]));
      for (let i = 0; i < stale.length; i += 100) {
        const { error } = await db.storage.from(b.bucket).remove(stale.slice(i, i + 100));
        if (!error) removed += Math.min(100, stale.length - i);
      }
      files.splice(0, files.length, ...files.filter((f) => !f.startsWith("sheets/")));
    }
    // Автомонтаж videos have their own rows (montages) and their own expiry above.
    if (b.bucket === "generated-videos") files.splice(0, files.length, ...files.filter((f) => !/\/montage-[0-9a-f-]{36}\.mp4$/i.test(f)));
    for (let i = 0; i < files.length; i += 100) {
      const chunk = files.slice(i, i + 100);
      // A video's still frame (".poster.webp") belongs to the video row.
      const base = (f: string) => f.replace(/\.poster\.webp$/, "");
      const { data: rows } = await db.from(b.table).select(b.col).in(b.col, [...new Set(chunk.map(base))]);
      const known = new Set(((rows ?? []) as unknown as Record<string, string>[]).map((r) => r[b.col]));
      const stale = chunk.filter((f) => !known.has(base(f)));
      if (stale.length) {
        const { error } = await db.storage.from(b.bucket).remove(stale);
        if (!error) removed += stale.length;
      }
    }
  }
  return removed;
}

/** An order's Character Sheets go with its photos. */
async function removeSheets(orderIds: string[]) {
  const db = supabaseAdmin();
  for (const id of orderIds) {
    const { data } = await db.storage.from("user-uploads").list(`sheets/${id}`, { limit: 100 });
    const paths = (data ?? []).filter((e) => e.id).map((e) => `sheets/${id}/${e.name}`);
    if (paths.length) await db.storage.from("user-uploads").remove(paths).catch(() => {});
  }
}
