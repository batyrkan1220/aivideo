import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { finishLogin, takeLinkLogin } from "@/lib/telegram/bot-login";

/**
 * One-time link the bot sends after "Start": signs in whichever browser opens it and continues
 * to the page the sign-in was started from (e.g. the order waiting for payment). Works once.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const site = env().NEXT_PUBLIC_APP_URL.replace(/\/$/, "");
  const fail = NextResponse.redirect(`${site}/login`);
  if (!z.string().uuid().safeParse(id).success) return fail;
  if (!(await allow("handoff", await clientIp()))) return fail;
  try {
    const row = await takeLinkLogin(id);
    if (!row) return fail;
    const next = await finishLogin(row);
    return NextResponse.redirect(`${site}${next}`);
  } catch {
    return fail;
  }
}
