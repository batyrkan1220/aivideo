import { NextResponse } from "next/server";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { tg } from "@/lib/telegram/bot";

/** Staff only: streams a file a customer sent to the support chat (it stays on Telegram's servers). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const u = await getSessionUser();
  if (!u || !can(u.role, "orders.view")) return new NextResponse(null, { status: 403 });
  const { id } = await params;
  if (!/^\d{1,18}$/.test(id)) return new NextResponse(null, { status: 404 });
  const { data: e } = await supabaseAdmin().from("support_entries").select("file_id,media_type").eq("id", Number(id)).maybeSingle();
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!e?.file_id || !token) return new NextResponse(null, { status: 404 });
  const f = await tg<{ file_path?: string; file_size?: number }>("getFile", { file_id: e.file_id });
  // Bot API serves files up to 20 MB.
  if (!f?.file_path) return new NextResponse("Файл больше 20 МБ или недоступен — откройте его в Telegram.", { status: 404 });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${f.file_path}`, { cache: "no-store", signal: AbortSignal.timeout(60_000) });
  if (!res.ok || !res.body) return new NextResponse(null, { status: 502 });
  const ext = f.file_path.split(".").pop()?.toLowerCase() ?? "";
  // Only known media types are shown inline; anything else downloads (never rendered on our origin).
  const type = ({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm", oga: "audio/ogg", ogg: "audio/ogg", mp3: "audio/mpeg", m4a: "audio/mp4" } as Record<string, string>)[ext];
  return new NextResponse(res.body, { headers: {
    "content-type": type ?? "application/octet-stream",
    ...(type ? {} : { "content-disposition": `attachment; filename="file-${id}${ext && /^[a-z0-9]{1,5}$/.test(ext) ? `.${ext}` : ""}"` }),
    "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
  } });
}
