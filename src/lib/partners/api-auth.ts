import "server-only";
import { timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { env } from "@/lib/env";

/** Teliks server-to-server calls: `Authorization: Bearer <TELIKS_API_SECRET>`. */
export function partnerApiAuthorized(req: NextRequest) {
  const secret = env().TELIKS_API_SECRET;
  const got = (req.headers.get("authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!secret || !got) return false;
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}
