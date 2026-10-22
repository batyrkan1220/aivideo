import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { redeemHandoff } from "@/lib/telegram/session";

/**
 * One-time link from the Telegram Mini App to the regular browser (payment runs on the website).
 * Single use, 10 minutes, then the user simply lands on /login.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const fail = NextResponse.redirect(new URL("/login", req.url));
  if (!z.string().uuid().safeParse(id).success) return fail;
  if (!(await allow("handoff", await clientIp()))) return fail;
  try {
    const next = await redeemHandoff(id);
    if (!next) return fail;
    return NextResponse.redirect(new URL(next, req.url));
  } catch {
    return fail;
  }
}
