import "server-only";
import { cache } from "react";
import { redirect } from "next/navigation";
import { memo, clearMemo } from "@/lib/cache/memo";
import { connection } from "next/server";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { can, type Permission, type Role } from "./permissions";

export type SessionUser = { id: string; email: string | null; role: Role; displayName: string | null };

/**
 * Current user with role read from the DB (never from client input or JWT claims).
 * Identity: the session JWT verified with getClaims() (locally against the project's signing keys
 * when they are asymmetric, otherwise via the Auth server). Deduplicated per request; the profile
 * row (role, name) is cached for 60 s and dropped whenever it is changed.
 */
export const getSessionUser = cache(async (): Promise<SessionUser | null> => {
  await connection();
  const sb = await supabaseServer();
  const { data, error } = await sb.auth.getClaims();
  const sub = !error ? (data?.claims?.sub as string | undefined) : undefined;
  if (!sub) return null;
  const profile = await memo(`profile:${sub}`, 60_000, async () => {
    const { data: p } = await supabaseAdmin().from("profiles").select("role, display_name").eq("id", sub).maybeSingle();
    return p;
  });
  return {
    id: sub,
    email: (data?.claims?.email as string | undefined) ?? null,
    role: (profile?.role as Role) ?? "user",
    displayName: profile?.display_name ?? null,
  };
});

/** Call after changing a user's profile (role, display name). */
export function forgetProfile(userId: string) {
  clearMemo(`profile:${userId}`);
}

export async function requireUser(next?: string): Promise<SessionUser> {
  const u = await getSessionUser();
  if (!u) redirect(`/login${next ? `?next=${encodeURIComponent(next)}` : ""}`);
  return u;
}

export class ForbiddenError extends Error {
  constructor() { super("forbidden"); }
}

export async function requirePermission(perm: Permission): Promise<SessionUser> {
  const u = await requireUser("/admin");
  if (!can(u.role, perm)) throw new ForbiddenError();
  return u;
}

/** Append-only audit trail for privileged actions. */
export async function audit(
  actorId: string | null,
  action: string,
  resourceType: string,
  resourceId: string | null,
  metadata: Record<string, unknown> = {},
) {
  await supabaseAdmin().from("audit_logs").insert({
    actor_id: actorId, action, resource_type: resourceType, resource_id: resourceId, metadata_json: metadata,
  });
}
