import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { runRetention } from "@/lib/generation/retention";
import { audit } from "@/lib/auth/session";

// Called daily by Supabase pg_cron. Protected by the shared worker secret.
export async function POST(request: NextRequest) {
  const secret = env().WORKER_SECRET;
  const given = request.headers.get("x-worker-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await runRetention();
  await audit(null, "retention.run", "storage", null, result);
  return NextResponse.json({ ok: true, ...result });
}
