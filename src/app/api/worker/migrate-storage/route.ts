import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabase/server";

/*
  One-off project move: copies Storage files from the current Supabase project to a new one.
  Called from the old database (pg_net) with the shared worker secret. Uploads go to the new
  project with its public anon key plus a temporary token that a short-lived Storage policy
  checks, so no new secret is needed here. Runs in the background; logs counts only.
*/
const TARGET = /^https:\/\/[a-z0-9]{20}\.supabase\.co$/;
const BUCKETS = new Set(["template-media", "generated-videos", "user-uploads", "user-videos", "offer-media"]);

type Body = { target?: string; anonKey?: string; token?: string; bucket?: string; names?: unknown };

export async function POST(request: NextRequest) {
  const secret = env().WORKER_SECRET;
  const given = request.headers.get("x-worker-secret") ?? "";
  if (!secret || given.length !== secret.length || !timingSafeEqual(Buffer.from(given), Buffer.from(secret))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const b = (await request.json().catch(() => ({}))) as Body;
  const names = Array.isArray(b.names) ? b.names.filter((n): n is string => typeof n === "string" && n.length > 0 && n.length < 500) : [];
  if (!b.target || !TARGET.test(b.target) || !b.anonKey || !b.token || !b.bucket || !BUCKETS.has(b.bucket) || names.length === 0) {
    return NextResponse.json({ ok: false, error: "bad_request" }, { status: 400 });
  }
  void copyAll(b.target, b.anonKey, b.token, b.bucket, names);
  return NextResponse.json({ ok: true, queued: names.length }, { status: 202 });
}

async function copyAll(target: string, anonKey: string, token: string, bucket: string, names: string[]) {
  const src = supabaseAdmin().storage.from(bucket);
  let ok = 0, failed = 0;
  for (const name of names) {
    try {
      const { data, error } = await src.download(name);
      if (error || !data) throw new Error("download");
      const path = name.split("/").map(encodeURIComponent).join("/");
      const res = await fetch(`${target}/storage/v1/object/${bucket}/${path}`, {
        method: "POST",
        headers: {
          apikey: anonKey,
          authorization: `Bearer ${anonKey}`,
          "content-type": data.type || "application/octet-stream",
          "x-upsert": "false",
          "x-mig": token,
        },
        body: Buffer.from(await data.arrayBuffer()),
      });
      if (res.ok || res.status === 409) ok++;
      else { failed++; if (failed <= 3) console.error(`[migrate-storage] ${bucket} upload status ${res.status}: ${(await res.text()).slice(0, 160)}`); }
    } catch {
      failed++;
    }
  }
  console.log(`[migrate-storage] ${bucket}: ok=${ok} failed=${failed} of ${names.length}`);
}
