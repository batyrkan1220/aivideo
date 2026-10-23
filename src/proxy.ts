import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { sessionCookieOptions } from "@/lib/supabase/cookie-options";

// Refreshes the Supabase session cookie and gates private sections.
// Authorization (roles, ownership) is re-checked on the server for every request.
const PROTECTED = ["/account", "/orders", "/admin", "/checkout"];

export async function proxy(request: NextRequest) {
  // Supabase falls back to Site URL ("/?code=...") when the redirect isn't allow-listed.
  if (request.nextUrl.pathname === "/" && request.nextUrl.searchParams.has("code")) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/callback";
    return NextResponse.redirect(url);
  }

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

  const { data: { user } } = await supabase.auth.getUser();
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
  // CPA network: Offer18 tracking link → https://trendme.kz/?o18={tid} (first click kept 30 days).
  const o18 = request.nextUrl.searchParams.get("o18");
  if (o18 && /^[A-Za-z0-9_-]{4,64}$/.test(o18) && !request.cookies.get("tm_cpa")) {
    response.cookies.set("tm_cpa", o18, { maxAge: 30 * 86400, path: "/", httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production" });
  }
  return response;
}

export const config = {
  // Skip static assets, images and webhook endpoints (those verify signatures instead).
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/payments/webhook|api/generation/webhook|api/worker|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mp4)$).*)",
  ],
};
