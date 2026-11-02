import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { verifyLoginWidget } from "@/lib/telegram/login-widget";
import { signInTelegramUser } from "@/lib/telegram/session";
import { attributeTelegramUser } from "@/lib/partners";

/**
 * Website sign-in with Telegram: the callback page posts the data Telegram signed with the bot
 * token; we verify it and sign the matching account in (the same account as in the Mini App).
 */
export async function POST(req: NextRequest) {
  const token = env().TELEGRAM_BOT_TOKEN;
  if (!token) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!(await allow("telegram_auth", await clientIp()))) return NextResponse.json({ ok: false, error: "rate_limited" }, { status: 429 });

  const body = (await req.json().catch(() => null)) as { data?: unknown } | null;
  const v = verifyLoginWidget(body?.data, token);
  if (!v.ok) return NextResponse.json({ ok: false, error: v.reason }, { status: 401 });
  try {
    const userId = await signInTelegramUser(v.user);
    await attributeTelegramUser(userId, v.user.id, null);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(JSON.stringify({ src: "telegram", event: "web_sign_in_failed", reason: err instanceof Error ? err.message : "error" }));
    return NextResponse.json({ ok: false, error: "sign_in_failed" }, { status: 500 });
  }
}
