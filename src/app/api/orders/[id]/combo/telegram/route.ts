import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { sendPhotoFile, botConfigured } from "@/lib/telegram/bot";
import { track } from "@/lib/analytics";

/** Owner-only: the bot sends every finished photo of a combo into the user's Telegram chat. */
export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  if (!botConfigured()) return NextResponse.json({ ok: false, error: "unavailable" }, { status: 503 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const { data: o } = await sb.from("orders").select("id,template_snapshot_json").eq("id", id).maybeSingle();
  if (!o || (o.template_snapshot_json as { provider_key?: string }).provider_key !== "combo") return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });

  const db = supabaseAdmin();
  const { data: p } = await db.from("profiles").select("telegram_id").eq("id", user.id).maybeSingle();
  if (!p?.telegram_id) return NextResponse.json({ ok: false, error: "no_telegram" }, { status: 400 });
  const { data: kids } = await db.from("orders").select("id,public_order_number,template_snapshot_json")
    .eq("parent_order_id", id).eq("user_id", user.id).eq("generation_status", "completed").order("created_at");
  const { data: files } = (kids ?? []).length
    ? await db.from("generated_videos").select("order_id,private_storage_path,expires_at").in("order_id", (kids ?? []).map((k) => k.id))
    : { data: [] as { order_id: string; private_storage_path: string; expires_at: string }[] };

  let sent = 0;
  for (const k of kids ?? []) {
    const f = files?.find((x) => x.order_id === k.id);
    if (!f || new Date(f.expires_at).getTime() < Date.now()) continue;
    const { data: blob } = await db.storage.from("generated-videos").download(f.private_storage_path);
    if (!blob) continue;
    const ext = (/\.([a-z0-9]{3,4})$/i.exec(f.private_storage_path)?.[1] ?? "jpg").toLowerCase();
    const title = (k.template_snapshot_json as { title_kk?: string } | null)?.title_kk ?? "TrendMe";
    if (await sendPhotoFile(Number(p.telegram_id), new Blob([blob], { type: blob.type || "image/jpeg" }), `${k.public_order_number}.${ext}`, `📸 ${title} · TrendMe`)) sent++;
  }
  if (!sent) return NextResponse.json({ ok: false, error: "failed" }, { status: 502 });
  await track("video_downloaded", { userId: user.id, orderId: id, props: { combo: true, sent } });
  return NextResponse.json({ ok: true, sent });
}
