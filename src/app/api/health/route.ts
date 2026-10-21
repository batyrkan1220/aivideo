import { NextResponse, connection } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

// Health check: reports configuration presence and DB reachability. Never returns secret values.
export async function GET() {
  await connection();
  const e = env();
  const checks: Record<string, boolean> = {
    supabaseUrl: !!e.NEXT_PUBLIC_SUPABASE_URL,
    anonKey: !!e.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    serviceKey: !!e.SUPABASE_SERVICE_ROLE_KEY,
    database: false,
  };
  if (checks.serviceKey) {
    try {
      const { error } = await supabaseAdmin().from("categories").select("id", { head: true, count: "exact" });
      checks.database = !error;
      if (error) console.error("[health] db", error.code);
    } catch (err) {
      console.error("[health]", err);
    }
  }
  const ok = Object.values(checks).every(Boolean);
  return NextResponse.json({ ok, env: e.APP_ENV, checks }, { status: ok ? 200 : 503 });
}
