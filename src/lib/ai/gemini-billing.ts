import "server-only";
import { z } from "zod";
import { memo } from "@/lib/cache/memo";
import { supabaseAdmin } from "@/lib/supabase/server";

/*
  Gemini spending. Google gives no balance to an API key, so the admin enters the balance after a
  top-up ("было $X на дату"); every call's tokens are saved here and priced with the admin's prices,
  and the page shows the balance left = entered − spent since then. A 402 from Google means it ran out.
*/

export const GEMINI_BILLING_KEY = "gemini_billing";
export const geminiBillingSchema = z.object({
  /** USD per 1M input tokens (images count as input) and per 1M output tokens. */
  inputUsdPer1M: z.number().min(0).max(100).catch(0.3).default(0.3),
  outputUsdPer1M: z.number().min(0).max(200).catch(2.5).default(2.5),
  /** Balance the admin entered, and when. */
  balanceUsd: z.number().min(0).max(100_000).nullable().catch(null).default(null),
  balanceAt: z.string().max(40).nullable().catch(null).default(null),
});
export type GeminiBilling = z.infer<typeof geminiBillingSchema>;

export const geminiBilling = () => memo("settings:gemini", 60_000, async (): Promise<GeminiBilling> => {
  const { data } = await supabaseAdmin().from("site_settings").select("value").eq("key", GEMINI_BILLING_KEY).maybeSingle();
  return geminiBillingSchema.parse(data?.value ?? {});
});

/** Saves one Gemini call. Never throws (spending is only a report). */
export async function logGeminiCall(c: { model: string; purpose: string; ok: boolean; status?: number; input?: number; output?: number }) {
  try {
    const b = await geminiBilling();
    const cost = ((c.input ?? 0) * b.inputUsdPer1M + (c.output ?? 0) * b.outputUsdPer1M) / 1_000_000;
    await supabaseAdmin().from("ai_usage").insert({
      service: "gemini", model: c.model.slice(0, 60), purpose: c.purpose.slice(0, 40), ok: c.ok, http_status: c.status ?? null,
      input_tokens: c.input ?? 0, output_tokens: c.output ?? 0, cost_usd: Math.round(cost * 1_000_000) / 1_000_000,
    });
  } catch { /* report only */ }
}
