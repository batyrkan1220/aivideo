import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { sendVideoFile, sendPhotoFile, botConfigured } from "@/lib/telegram/bot";
import { track } from "@/lib/analytics";

const MAX_BYTES = 50 * 1024 * 1024; // Bot API upload limit

/**
 * Owner-only: the bot sends the finished video into the user's Telegram chat, where it can be saved
 * to the gallery. Works in every Telegram client (the Mini App WebView often cannot download files).
 */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!botConfigured()) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data: o } = await sb.from("orders").select("id,public_order_number,generation_status,template_snapshot_json").eq("id", id).maybeSingle();
  if (!o || o.generation_status !== "completed") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const db = supabaseAdmin();
  const { data: p } = await db.from("profiles").select("telegram_id").eq("id", user.id).maybeSingle();
  if (!p?.telegram_id) return NextResponse.json({ ok: false, error: "no_telegram" }, { status: 400 });
  const { data: v } = await db.from("generated_videos").select("private_storage_path,expires_at").eq("order_id", id).maybeSingle();
  if (!v || new Date(v.expires_at).getTime() < Date.now()) return NextResponse.json({ ok: false, error: "expired" }, { status: 410 });
  const { data: blob } = await db.storage.from("generated-videos").download(v.private_storage_path);
  if (!blob) return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  if (blob.size > MAX_BYTES) return NextResponse.json({ ok: false, error: "too_large" }, { status: 413 });

  const title = (o.template_snapshot_json as { title_kk?: string } | null)?.title_kk ?? "TrendMe";
  const ext = (/\.([a-z0-9]{3,4})$/i.exec(v.private_storage_path)?.[1] ?? "mp4").toLowerCase();
  const isPhoto = ["jpg", "jpeg", "png", "webp"].includes(ext);
  const ok = isPhoto
    ? await sendPhotoFile(Number(p.telegram_id), new Blob([blob], { type: blob.type || "image/jpeg" }), `${o.public_order_number}.${ext}`, `📸 ${title} · TrendMe`)
    : await sendVideoFile(Number(p.telegram_id), new Blob([blob], { type: "video/mp4" }), `${o.public_order_number}.mp4`, `🎬 ${title} · TrendMe`,
      await videoMeta(blob).catch(() => undefined));
  if (!ok) return NextResponse.json({ ok: false, error: "failed" }, { status: 502 });
  await track("video_downloaded", { userId: user.id, orderId: id });
  return NextResponse.json({ ok: true });
}

/** The video's real size and length (and a small cover), so Telegram shows it in its own proportions. */
async function videoMeta(blob: Blob) {
  const { mkdtemp, readFile, rm, writeFile } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { ffmpegLog } = await import("@/lib/templates/lite-preview");
  const dir = await mkdtemp(join(tmpdir(), "tg-"));
  try {
    const src = join(dir, "v.mp4"), thumb = join(dir, "t.jpg");
    await writeFile(src, new Uint8Array(await blob.arrayBuffer()));
    const info = await ffmpegLog(["-hide_banner", "-y", "-loglevel", "info", "-i", src, "-ss", "0.5", "-frames:v", "1",
      "-vf", "scale='if(gt(iw,ih),320,-2)':'if(gt(iw,ih),-2,320)'", "-q:v", "4", thumb], 60_000);
    const m = /Video:.*?(\d{2,5})x(\d{2,5})/.exec(info);
    const d = /Duration: (\d+):(\d+):(\d+(?:\.\d+)?)/.exec(info);
    // A rotated phone video: width and height swap.
    const rot = /rotation of -?(90|270)|rotate\s*:\s*(90|270)/.test(info);
    if (!m) return undefined;
    const [w, h] = rot ? [Number(m[2]), Number(m[1])] : [Number(m[1]), Number(m[2])];
    const thumbBytes = await readFile(thumb).catch(() => null);
    return { width: w, height: h, duration: d ? Number(d[1]) * 3600 + Number(d[2]) * 60 + Number(d[3]) : 0,
      thumb: thumbBytes ? new Blob([new Uint8Array(thumbBytes)], { type: "image/jpeg" }) : null };
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
