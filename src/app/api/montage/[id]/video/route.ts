import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

/** Owner-only: a short signed link to the finished montage (?download=1 saves it as a file, ?json=1 returns the link). */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false }, { status: 404 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const db = supabaseAdmin();
  const { data: m } = await db.from("montages").select("output_path,status,expires_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!m?.output_path || m.status !== "completed" || (m.expires_at && new Date(m.expires_at).getTime() < Date.now())) return NextResponse.json({ ok: false }, { status: 404 });
  const download = req.nextUrl.searchParams.get("download") === "1";
  const { data } = await db.storage.from("generated-videos").createSignedUrl(m.output_path, 3600, download ? { download: "TrendMe-montage.mp4" } : undefined);
  if (!data) return NextResponse.json({ ok: false }, { status: 500 });
  if (req.nextUrl.searchParams.get("json") === "1") return NextResponse.json({ url: data.signedUrl, fileName: "TrendMe-montage.mp4" });
  return NextResponse.redirect(data.signedUrl, 302);
}
