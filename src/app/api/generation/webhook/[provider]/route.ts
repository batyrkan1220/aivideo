import { NextResponse } from "next/server";
import { generationProvider } from "@/lib/generation";

/**
 * Provider completion callbacks. No registered provider uses webhooks yet (the dev adapter
 * is polled), so every request is rejected. A real adapter must verify the provider's
 * signature here, dedupe via webhook_events, then nudge the job (set next_attempt_at=now)
 * — status is always re-read from the provider API, never trusted from the callback body.
 */
export async function POST(_req: Request, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  if (!generationProvider(provider)) return NextResponse.json({ ok: false }, { status: 404 });
  return NextResponse.json({ ok: false, error: "webhooks_not_supported" }, { status: 400 });
}
