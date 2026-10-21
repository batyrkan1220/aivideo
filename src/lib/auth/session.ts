import "server-only";
import { redirect } from "next/navigation";
import { supabaseServer, supabaseAdmin } from "@/lib/supabase/server";
import { can, type Permission, type Role } from "./permissions";

export type SessionUser = { id: string; email: string | null; role: Role; displayName: string | null };

/** Current user with role read from the DB (never from client input or JWT claims). */
export async function getSessionUser(): Promise<SessionUser | null> {
  const sb = await supabaseServer();
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data: profile } = await sb.from("profiles").select("role, display_name").eq("id", user.id).single();
  return {
    id: user.id,
    email: user.email ?? null,
    role: (profile?.role as Role) ?? "user",
    displayName: profile?.display_name ?? null,
  };
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
