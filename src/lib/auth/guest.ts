"use server";
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { allow, clientIp } from "@/lib/security/rate-limit";
import { track } from "@/lib/analytics";
import { GUEST_EMAIL_DOMAIN, signInByEmail } from "@/lib/telegram/session";

/**
 * A visitor from an ad can upload a photo right away: the first upload quietly creates a guest
 * account (no email, no password) and signs this browser in. At payment the guest confirms with
 * Telegram and the guest becomes (or is merged into) their Telegram account.
 */
/** The visitor came through an ad landing (/go/…) in the last 7 days: the proxy's signed tm_land cookie. */
async function fromAdLanding(): Promise<boolean> {
  const [ts, sig] = ((await cookies()).get("tm_land")?.value ?? "").split(".");
  if (!ts || !sig || !/^\d{12,14}$/.test(ts) || !/^[0-9a-f]{24}$/.test(sig)) return false;
  if (Date.now() - Number(ts) > 7 * 86400_000) return false;
  const secret = process.env.WORKER_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const want = createHmac("sha256", secret).update(`land${ts}`).digest().subarray(0, 12);
  const got = Buffer.from(sig, "hex");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Guest accounts exist only for the ad landing. On the site itself making a video needs a Telegram sign-in.
 * login = the visitor must sign in with Telegram first.
 */
export async function ensureGuestSession(): Promise<{ ok: boolean; login?: boolean }> {
  if (await getSessionUser()) return { ok: true };
  if (!(await fromAdLanding())) return { ok: false, login: true };
  if (!(await allow("guest", await clientIp()))) return { ok: false };
  const email = `g${randomUUID().replace(/-/g, "")}@${GUEST_EMAIL_DOMAIN}`;
  const { data: created, error } = await supabaseAdmin().auth.admin.createUser({
    email, email_confirm: true, app_metadata: { guest: true }, user_metadata: { display_name: null },
  });
  if (error) { console.error("[guest] create failed"); return { ok: false }; }
  try { await signInByEmail(email); } catch { return { ok: false }; }
  await track("guest_created", { userId: created.user?.id });
  return { ok: true };
}
