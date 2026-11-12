import "server-only";
import { supabaseAdmin } from "@/lib/supabase/server";

export type AnalyticsEvent =
  | "template_viewed" | "preview_played" | "upload_started" | "upload_completed" | "quality_selected"
  | "checkout_initiated" | "payment_succeeded" | "payment_failed"
  | "generation_started" | "generation_succeeded" | "generation_failed" | "video_downloaded"
  // Accounts and messages (journal history)
  | "guest_created" | "telegram_login" | "telegram_linked" | "reminder_sent" | "offer_sent" | "discount_used" | "photos_kept"
  | "montage_started";

/**
 * Who / where from, for the funnel: an anonymous visitor id and the ad source (utm_source /
 * utm_campaign / ref), both from first-party cookies set in the proxy. Empty outside a request.
 */
export async function visitorContext(): Promise<{ vid?: string; src?: string; cmp?: string }> {
  try {
    const { cookies } = await import("next/headers");
    const c = await cookies();
    const vid = c.get("tm_vid")?.value;
    const [src, cmp] = (c.get("tm_src")?.value ?? "").split("|");
    return { ...(vid ? { vid } : {}), ...(src ? { src } : {}), ...(cmp ? { cmp } : {}) };
  } catch {
    return {};
  }
}

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
      properties: { ...(await visitorContext()), ...(ctx.props ?? {}) },
    });
  } catch (err) {
    console.error("[analytics]", event, err);
  }
}
