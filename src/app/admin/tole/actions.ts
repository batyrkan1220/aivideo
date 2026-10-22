"use server";
import { randomUUID } from "node:crypto";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { ToleClient, ToleError } from "@/lib/payments/tole/client";

export type ToleCheck = {
  ran?: boolean;
  provider?: string;
  keyMode?: "test" | "live" | "missing";
  connectionId?: boolean;
  webhookSecret?: "ok" | "missing" | "unusual_prefix";
  api?: "ok" | "unauthorized" | "forbidden" | "unreachable" | "error" | "skipped";
  error?: "forbidden";
};

/**
 * Admin diagnostic: reports which Tole settings are present (never their values) and proves the
 * key + connection with a harmless read (GET /commands/<random id> → 404 means authenticated).
 */
export async function checkTole(): Promise<ToleCheck> {
  const u = await getSessionUser();
  if (!u || !can(u.role, "users.manage")) return { error: "forbidden" };
  const e = env();
  const key = e.TOLE_API_KEY;
  const keyMode = !key ? "missing" : key.startsWith("tole_sk_test_") ? "test" : "live";
  const secret = e.TOLE_WEBHOOK_SECRET;
  const webhookSecret = !secret ? "missing" : secret.startsWith("whsec_") ? "ok" : "unusual_prefix";
  const base = { ran: true, provider: e.PAYMENT_PROVIDER, keyMode, connectionId: !!e.TOLE_CONNECTION_ID, webhookSecret } as const;
  if (!key) return { ...base, api: "skipped" };

  const mode = e.PAYMENT_PROVIDER === "tole" ? "live" : "sandbox";
  const client = new ToleClient({ baseUrl: e.TOLE_API_BASE_URL, apiKey: key, connectionId: e.TOLE_CONNECTION_ID, mode });
  try {
    await client.read(`${mode === "sandbox" ? "/sandbox" : ""}/commands/${randomUUID()}`);
    return { ...base, api: "ok" };
  } catch (err) {
    if (!(err instanceof ToleError)) return { ...base, api: "error" };
    if (err.kind === "not_found") return { ...base, api: "ok" };          // authenticated, command just doesn't exist
    if (err.kind === "auth") return { ...base, api: "unauthorized" };
    if (err.kind === "forbidden") return { ...base, api: "forbidden" };
    if (err.kind === "timeout" || err.kind === "network") return { ...base, api: "unreachable" };
    return { ...base, api: "error" };
  }
}
