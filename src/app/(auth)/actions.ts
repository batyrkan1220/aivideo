"use server";
import { redirect } from "next/navigation";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { kk } from "@/lib/i18n/kk";
import { safeNext } from "@/lib/auth/redirect";

export type AuthState = { error?: string; message?: string };

const emailSchema = z.string().trim().toLowerCase().email();
const passwordSchema = z.string().min(8).max(128);

/** Map provider errors to safe Kazakh messages — raw errors only go to server logs. */
function authError(err: { message?: string; code?: string } | null): string {
  const code = err?.code ?? "";
  if (code === "invalid_credentials") return kk.auth.invalidCredentials;
  if (code === "user_already_exists" || code === "email_exists") return kk.auth.emailTaken;
  if (code === "weak_password") return kk.auth.weakPassword;
  if (code === "email_not_confirmed") return kk.auth.emailNotConfirmed;
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit") return kk.errors.rateLimited;
  console.error("[auth]", code, err?.message);
  return kk.errors.generic;
}

export async function loginAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(fd.get("email"));
  const password = z.string().min(1).safeParse(fd.get("password"));
  if (!email.success) return { error: kk.auth.invalidEmail };
  if (!password.success) return { error: kk.auth.invalidCredentials };

  const sb = await supabaseServer();
  const { error } = await sb.auth.signInWithPassword({ email: email.data, password: password.data });
  if (error) return { error: authError(error) };
  redirect(safeNext(fd.get("next")));
}

export async function signupAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(fd.get("email"));
  const password = passwordSchema.safeParse(fd.get("password"));
  const name = z.string().trim().max(80).safeParse(fd.get("displayName") ?? "");
  if (!email.success) return { error: kk.auth.invalidEmail };
  if (!password.success) return { error: kk.auth.weakPassword };

  const sb = await supabaseServer();
  const { data, error } = await sb.auth.signUp({
    email: email.data,
    password: password.data,
    options: {
      emailRedirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback?next=${encodeURIComponent(safeNext(fd.get("next")))}`,
      data: { display_name: name.success ? name.data : "" },
    },
  });
  if (error) return { error: authError(error) };
  if (!data.session) return { message: kk.auth.checkEmail }; // email confirmation enabled
  redirect(safeNext(fd.get("next")));
}

export async function requestResetAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const email = emailSchema.safeParse(fd.get("email"));
  if (!email.success) return { error: kk.auth.invalidEmail };
  const sb = await supabaseServer();
  const { error } = await sb.auth.resetPasswordForEmail(email.data, {
    redirectTo: `${env().NEXT_PUBLIC_APP_URL}/auth/callback?next=/reset-password`,
  });
  if (error && error.code?.startsWith("over_")) return { error: kk.errors.rateLimited };
  if (error) console.error("[auth.reset]", error.code, error.message);
  // Same response whether or not the email exists (no account enumeration)
  return { message: kk.auth.resetSent };
}

export async function updatePasswordAction(_: AuthState, fd: FormData): Promise<AuthState> {
  const password = passwordSchema.safeParse(fd.get("password"));
  if (!password.success) return { error: kk.auth.weakPassword };
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return { error: kk.auth.linkExpired };
  const { error } = await sb.auth.updateUser({ password: password.data });
  if (error) return { error: authError(error) };
  redirect("/account?pw=updated");
}

export async function logoutAction() {
  const sb = await supabaseServer();
  await sb.auth.signOut();
  redirect("/");
}
