import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

// Refreshes the Supabase session cookie and gates private sections.
// Authorization (roles, ownership) is re-checked on the server for every request.
const PROTECTED = ["/account", "/orders", "/admin", "/checkout"];

export async function proxy(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookieOptions: sessionCookieOptions,
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (list) => {
          list.forEach(({ name, value }) => request.cookies.set(name, value));
          response = NextResponse.next({ request });
          list.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getClaims() refreshes the session when needed and verifies the JWT (locally with asymmetric keys).
  const { data: claims } = await supabase.auth.getClaims();
  const user = claims?.claims?.sub ? { id: claims.claims.sub } : null;
  const path = request.nextUrl.pathname;

  if (!user && PROTECTED.some((p) => path === p || path.startsWith(p + "/"))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = `?next=${encodeURIComponent(path)}`;
    return NextResponse.redirect(url);
  }
  // Partner program: keep the first ?ref=<code> for 60 days (applied to the account when ordering).
  // Set after getUser(): a session refresh replaces `response`.
  const ref = request.nextUrl.searchParams.get("ref")?.toLowerCase();
  if (ref && /^[a-z0-9]{4,24}$/.test(ref) && !request.cookies.get("tm_ref")) {
    response.cookies.set("tm_ref", ref, { maxAge: 60 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
    // Count the visit (first time only, best effort, never blocks the page for long).
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (key) {
      await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/partner_visit`, {
        method: "POST", headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_code: ref, p_source: "site" }), signal: AbortSignal.timeout(1500),
      }).catch(() => {});
    }
  }
  // Funnel: anonymous visitor id (1 year) and the ad source of the latest ad visit (30 days).
  const secure = process.env.NODE_ENV === "production";
  if (!request.cookies.get("tm_vid")) {
    response.cookies.set("tm_vid", crypto.randomUUID().replace(/-/g, "").slice(0, 20), { maxAge: 365 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure });
  }
  const sp = request.nextUrl.searchParams;
  const clean = (v: string | null) => (v ?? "").toLowerCase().replace(/[^a-z0-9_.-]/g, "").slice(0, 40);
  const src = clean(sp.get("utm_source")) || (sp.get("ttclid") ? "tiktok" : sp.get("fbclid") ? "meta" : "") || (ref ? `ref-${clean(ref)}` : "");
  if (src) {
    response.cookies.set("tm_src", `${src}|${clean(sp.get("utm_campaign") ?? sp.get("utm_content"))}`, { maxAge: 30 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure });
  }
  // First video −20% for people who came from an ad (24 h, signed so it can't be extended).
  if ((sp.get("ttclid") || sp.get("fbclid") || sp.get("utm_source")) && !request.cookies.get("tm_offer")) {
    const ts = String(Date.now());
    response.cookies.set("tm_offer", `${ts}.${await sign(ts)}`, { maxAge: 86400, path: "/", sameSite: "lax", secure });
  }

  // Ad landing (/go/…): only there may a visitor order without signing in (a guest account). Signed, 7 days.
  if (request.nextUrl.pathname.startsWith("/go/")) {
    const ts = String(Date.now());
    response.cookies.set("tm_land", `${ts}.${await sign(`land${ts}`)}`, { maxAge: 7 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure });
  }

  // Ad click ids (TikTok ttclid, Meta fbclid): kept so the purchase can be attributed server-side.
  const ttclid = request.nextUrl.searchParams.get("ttclid");
  if (ttclid && /^[A-Za-z0-9._-]{8,300}$/.test(ttclid)) {
    response.cookies.set("tm_ttclid", ttclid, { maxAge: 7 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  const fbclid = request.nextUrl.searchParams.get("fbclid");
  if (fbclid && /^[A-Za-z0-9._-]{8,300}$/.test(fbclid) && !request.cookies.get("_fbc")) {
    response.cookies.set("_fbc", `fb.1.${Date.now()}.${fbclid}`, { maxAge: 90 * 86400, path: "/", sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  // Cookies set just now must be visible to this very request too (first ad visit: offer, source).
  const fresh = ["tm_vid", "tm_src", "tm_offer", "tm_land", "tm_ttclid", "_fbc"].filter((n) => response.cookies.get(n) && request.cookies.get(n)?.value !== response.cookies.get(n)?.value);
  if (fresh.length) {
    for (const n of fresh) request.cookies.set(n, response.cookies.get(n)!.value);
    const out = NextResponse.next({ request });
    for (const c of response.cookies.getAll()) out.cookies.set(c);
    return out;
  }
  return response;
}

export const config = {
  // Skip static assets, images and webhook endpoints (those verify signatures instead).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/payments/webhook|api/generation/webhook|api/worker|api/partner-api|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};

/** HMAC (Web Crypto, edge-safe) with the worker secret: keeps the ad offer cookie honest. */
async function sign(v: string): Promise<string> {
  const secret = process.env.WORKER_SECRET ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(v));
  return Array.from(new Uint8Array(sig).slice(0, 12)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
