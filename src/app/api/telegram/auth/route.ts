import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { verifyInitData } from "@/lib/telegram/init-data";
import { signInTelegramUser } from "@/lib/telegram/session";
import { attributeTelegramUser } from "@/lib/partners";

/**
 * Mini App sign-in: the client posts Telegram's signed `initData`; we verify it with the bot
 * token and sign the matching account in (normal Supabase session cookies). Nothing from the
 * client is trusted except what the signature covers.
 */
export async function POST(req: NextRequest) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!(await allow("telegram_auth", await clientIp()))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { initData?: unknown } | null;
  const initData = typeof body?.initData === "string" && body.initData.length < 4096 ? body.initData : "";
  const v = verifyInitData(initData, token);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.reason }, { status: 401 });

  // Already signed in as this Telegram user → nothing to do.
  const current = await getSessionUser();
  if (current) {
    const { data: p } = await supabaseAdmin().from("profiles").select("telegram_id").eq("id", current.id).maybeSingle();
    if (Number(p?.telegram_id) === v.user.id) {
      const sp = new URLSearchParams(initData).get("start_param");
      await attributeTelegramUser(current.id, v.user.id, sp);
      return NextResponse.json({ ok: true, signedIn: false });
    }
  }

  // Partner program: Mini App opened via t.me/<bot>?startapp=p_<code> (covered by the signature).
  const startParam = new URLSearchParams(initData).get("start_param");
  try {
    const userId = await signInTelegramUser(v.user);
    await attributeTelegramUser(userId, v.user.id, startParam);
    return NextResponse.json({ ok: true, signedIn: true });
  } catch (err) {
    console.error(JSON.stringify({ src: "telegram", event: "sign_in_failed", reason: err instanceof Error ? err.message : "error" }));
    return NextResponse.json({ ok: false, error: "sign_in_failed" }, { status: 500 });
  }
}
