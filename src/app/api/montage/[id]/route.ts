import { NextResponse } from "next/server";
import { z } from "zod";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";

/** Owner-only status of an Автомонтаж (polled by its page); also restarts one the server left behind. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) return NextResponse.json({ ok: false }, { status: 404 });
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ ok: false }, { status: 401 });
  const { data: m } = await supabaseAdmin().from("montages")
    .select("id,status,error_code,output_duration_sec,created_at,started_at,attempts,expires_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!m) return NextResponse.json({ ok: false }, { status: 404 });
  if (m.status === "queued" || m.status === "processing") {
    const { resumeMontage } = await import("@/lib/montage/run");
    await resumeMontage(m.id, m.status, m.started_at, m.created_at, m.attempts ?? 0);
  }
  return NextResponse.json({ ok: true, status: m.status, error: m.error_code, durationSec: m.output_duration_sec, expiresAt: m.expires_at },
    { headers: { "cache-control": "no-store" } });
}
