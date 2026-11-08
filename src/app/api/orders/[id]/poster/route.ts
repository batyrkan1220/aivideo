import { NextResponse } from "next/server";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { ffmpegLog } from "@/lib/templates/lite-preview";

/** Still frame of a finished video, shown before it plays (iOS / Telegram show black otherwise). */
const posterPath = (videoPath: string) => `${videoPath}.poster.webp`;

// One frame per video, made once: concurrent requests for the same order wait for the same job.
const making = new Map<string, Promise<boolean>>();

async function makePoster(videoPath: string): Promise<boolean> {
  const db = supabaseAdmin();
  const { data: src } = await db.storage.from("generated-videos").createSignedUrl(videoPath, 300);
  if (!src) return false;
  const dir = await mkdtemp(join(tmpdir(), "poster-"));
  try {
    const out = join(dir, "p.webp");
    // Frame at 0.5 s, 720 px wide max. ffmpeg reads only the start of the file over HTTP; if its
    // build cannot open the URL, the video is downloaded first.
    const frame = (input: string) => ffmpegLog(["-hide_banner", "-loglevel", "error", "-y", "-ss", "0.5", "-i", input, "-frames:v", "1",
      "-vf", "scale='min(720,iw)':-2", "-c:v", "libwebp", "-q:v", "78", out], 60_000);
    try { await frame(src.signedUrl); } catch {
      const res = await fetch(src.signedUrl, { signal: AbortSignal.timeout(60_000) });
      if (!res.ok) return false;
      const local = join(dir, "v");
      await writeFile(local, Buffer.from(await res.arrayBuffer()));
      await frame(local);
    }
    const { error } = await db.storage.from("generated-videos")
      .upload(posterPath(videoPath), await readFile(out), { contentType: "image/webp", cacheControl: "86400", upsert: true });
    return !error;
  } catch (err) {
    console.error("[poster] failed", err instanceof Error ? err.message.slice(0, 160) : "error");
    return false;
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  // RLS: only the owner sees the order.
  const { data: o } = await sb.from("orders").select("id,generation_status").eq("id", id).maybeSingle();
  if (!o || o.generation_status !== "completed") return new NextResponse(null, { status: 404 });

  const db = supabaseAdmin();
  const { data: v } = await db.from("generated_videos").select("private_storage_path,expires_at").eq("order_id", id).maybeSingle();
  if (!v?.private_storage_path || new Date(v.expires_at).getTime() < Date.now()) return new NextResponse(null, { status: 410 });

  const path = posterPath(v.private_storage_path);
  const bucket = db.storage.from("generated-videos");
  let { data: signed } = await bucket.createSignedUrl(path, 3600);
  if (!signed) {
    let job = making.get(id);
    if (!job) { job = makePoster(v.private_storage_path).finally(() => making.delete(id)); making.set(id, job); }
    if (!(await job)) return new NextResponse(null, { status: 404 });
    ({ data: signed } = await bucket.createSignedUrl(path, 3600));
  }
  if (!signed) return new NextResponse(null, { status: 404 });
  return NextResponse.redirect(signed.signedUrl, { headers: { "cache-control": "private, max-age=3000" } });
}
