import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { track } from "@/lib/analytics";

/** Owner-only download: redirects to a 5-minute signed URL of the private video. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return new NextResponse(null, { status: 404 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return new NextResponse(null, { status: 401 });
  const { data: o } = await sb.from("orders").select("id,public_order_number,generation_status").eq("id", id).maybeSingle();
  if (!o || o.generation_status !== "completed") return new NextResponse(null, { status: 404 });

  const db = supabaseAdmin();
  const { data: v } = await db.from("generated_videos").select("private_storage_path,expires_at").eq("order_id", id).maybeSingle();
  if (!v || new Date(v.expires_at).getTime() < Date.now()) return new NextResponse(null, { status: 410 });
  const download = new URL(req.url).searchParams.has("download");
  const { data: signed } = await db.storage.from("generated-videos").createSignedUrl(v.private_storage_path, 300,
    download ? { download: `${o.public_order_number}.mp4` } : undefined);
  if (!signed) return new NextResponse(null, { status: 500 });
  if (download) await track("video_downloaded", { userId: user.id, orderId: id });
  // The Telegram Mini App downloads through Telegram's own downloadFile(), which needs the direct URL.
  if (new URL(req.url).searchParams.has("json")) return NextResponse.json({ url: signed.signedUrl, fileName: `${o.public_order_number}.mp4` }, { headers: { "cache-control": "no-store" } });
  return NextResponse.redirect(signed.signedUrl, { headers: { "cache-control": "no-store" } });
}
