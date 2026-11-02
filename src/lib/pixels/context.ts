import "server-only";
import { cookies, headers } from "next/headers";

/** What the ad platforms need to match a purchase to the click (stored on the order, never logged). */
export type AdContext = { src?: string; cmp?: string; ttclid?: string; ttp?: string; fbp?: string; fbc?: string; ga?: string; ip?: string; ua?: string; url?: string };

export async function captureAdContext(): Promise<AdContext> {
  try {
    const c = await cookies(), h = await headers();
    const v = (n: string) => c.get(n)?.value?.slice(0, 400) || undefined;
    const ga = v("_ga")?.split(".").slice(-2).join("."); // GA client id = last two parts of _ga
    const [src, cmp] = (v("tm_src") ?? "").split("|");
    return {
      ...(src ? { src } : {}), ...(cmp ? { cmp } : {}),
      ttclid: v("tm_ttclid"), ttp: v("_ttp"), fbp: v("_fbp"), fbc: v("_fbc"), ga: ga || undefined,
      ip: (h.get("x-forwarded-for")?.split(",")[0] ?? "").trim().slice(0, 64) || undefined,
      ua: h.get("user-agent")?.slice(0, 400) || undefined,
      url: h.get("referer")?.slice(0, 500) || undefined,
    };
  } catch {
    return {};
  }
}
