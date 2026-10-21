import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runWorker } from "@/lib/generation/worker";

// Called by Supabase pg_cron (only while jobs are pending). Protected by a shared secret.
export async function POST(request: NextRequest) {
  const secret = env().WORKER_SECRET;
  const given = request.headers.get("x-worker-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await runWorker({ limit: 5, budgetMs: 20_000 });
  return NextResponse.json({ ok: true, ...result });
}
