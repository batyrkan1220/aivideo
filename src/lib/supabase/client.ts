"use client";
import { createBrowserClient } from "@supabase/ssr";
import { sessionCookieOptions } from "./cookie-options";

// Browser client — uses only the public anon key; all access is governed by RLS.
export function supabaseBrowser() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { cookieOptions: sessionCookieOptions },
  );
}
