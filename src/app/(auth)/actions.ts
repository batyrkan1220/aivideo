"use server";
import { redirect } from "next/navigation";
import { supabaseServer } from "@/lib/supabase/server";

// Sign-in is Telegram only (no email or password); this file keeps sign-out.
export async function logoutAction() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/");
}
