import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runEngage } from "@/lib/engage";

// Called every 10 minutes by Supabase pg_cron: payment reminders and next-day offers.
export async function POST(request: NextRequest) {
  const secret = env().WORKER_SECRET;
  const given = request.headers.get("x-worker-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  return NextResponse.json({ ok: true, ...(await runEngage()) });
}
