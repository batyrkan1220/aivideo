import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { botConfigured, sendVideoFile } from "@/lib/telegram/bot";
import { videoMeta } from "@/lib/telegram/video-meta";

/** Owner-only: the bot sends the finished montage into the customer's Telegram chat. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!botConfigured()) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = supabaseAdmin();
  const [{ data: m }, { data: p }] = await Promise.all([
    db.from("montages").select("output_path,status").eq("id", id).eq("user_id", user.id).maybeSingle(),
    db.from("profiles").select("telegram_id").eq("id", user.id).maybeSingle(),
  ]);
  if (!m?.output_path || m.status !== "completed") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!p?.telegram_id) return NextResponse.json({ ok: false, error: "no_telegram" }, { status: 400 });
  const { data: blob } = await db.storage.from("generated-videos").download(m.output_path);
  if (!blob) return NextResponse.json({ ok: false, error: "failed" }, { status: 500 });
  const file = new Blob([blob], { type: "video/mp4" });
  const ok = await sendVideoFile(Number(p.telegram_id), file, "TrendMe-montage.mp4", "🎬 Ваш монтаж · TrendMe", await videoMeta(file).catch(() => undefined));
  return ok ? NextResponse.json({ ok: true }) : NextResponse.json({ ok: false, error: "failed" }, { status: 502 });
}
