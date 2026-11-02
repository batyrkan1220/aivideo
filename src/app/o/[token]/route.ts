import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { supabaseAdmin } from "@/lib/supabase/server";
import { isGuestEmail, signInByEmail } from "@/lib/telegram/session";

/**
 * Opens an order from its private link (Kaspi invoice comment). A guest order signs this browser
 * into that guest account; an order of a Telegram account opens after the usual Telegram sign-in.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const site = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(token) || !(await allow("handoff", await clientIp()))) return NextResponse.redirect(`${site}/`);
  const db = supabaseAdmin();
  const { data: o } = await db.from("orders").select("id,user_id").eq("access_token", token).maybeSingle();
  if (!o) return NextResponse.redirect(`${site}/`);
  try {
    const { data: u } = await db.auth.admin.getUserById(o.user_id);
    if (u.user?.email && isGuestEmail(u.user.email)) await signInByEmail(u.user.email);
  } catch { /* falls through to the normal sign-in */ }
  return NextResponse.redirect(`${site}/orders/${o.id}`);
}
