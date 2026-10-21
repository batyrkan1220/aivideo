import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export type AnalyticsEvent =
  | "template_viewed" | "preview_played" | "upload_started" | "upload_completed" | "quality_selected"
  | "checkout_initiated" | "payment_succeeded" | "payment_failed"
  | "generation_started" | "generation_succeeded" | "generation_failed" | "video_downloaded";

/** Fire-and-forget event log. Stores ids only — no names, emails or photos. Never throws. */
export async function track(
  event: AnalyticsEvent,
  ctx: { userId?: string; templateId?: string; orderId?: string; props?: Record<string, string | number | boolean> } = {},
) {
  try {
    await supabaseAdmin().from("analytics_events").insert({
      event_name: event,
      user_id: ctx.userId ?? null,
      template_id: ctx.templateId ?? null,
      order_id: ctx.orderId ?? null,
      properties: ctx.props ?? {},
    });
  } catch (err) {
    console.error("[analytics]", event, err);
  }
}
