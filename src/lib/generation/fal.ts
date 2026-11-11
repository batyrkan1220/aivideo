import "server-only";
import { env } from "@/lib/env";
import { ProviderError, type ProviderJobStatus } from "./types";

/*
  fal.ai queue API (other video models, chosen per template for testing):
    POST https://queue.fal.run/<model>   Authorization: Key <FAL_KEY>   → { request_id, status_url, response_url }
    GET  status_url                      → { status: IN_QUEUE | IN_PROGRESS | COMPLETED }
    GET  response_url                    → the model's output ({ video: { url } }) or an error
  Never logs the key, inputs or URLs.
*/

const QUEUE = "https://queue.fal.run";

export type FalRequest = { requestId: string; statusUrl: string; responseUrl: string };

async function falFetch(url: string, init: RequestInit = {}, timeoutMs = 30_000) {
  const key = env().FAL_KEY;
  if (!key) throw new ProviderError("provider_not_configured", false, "FAL_KEY is not set");
  try {
    return await fetch(url, {
      ...init,
      headers: { Authorization: `Key ${key}`, "Content-Type": "application/json", ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(timeoutMs),
      cache: "no-store",
    });
  } catch {
    throw new ProviderError("provider_unreachable", true);
  }
}

function errorFor(status: number, detail: string): ProviderError {
  if (status === 401 || status === 403) return new ProviderError("provider_auth", false, detail);
  if (/balance|credit|payment|billing|insufficient|locked/i.test(detail)) return new ProviderError("provider_no_balance", false, detail);
  if (status === 429) return new ProviderError("provider_http_429", true, detail);
  if (status >= 500) return new ProviderError(`provider_http_${status}`, true, detail);
  if (/nsfw|safety|content|policy|moderat|sensitive|face/i.test(detail)) return new ProviderError("provider_content_rejected", false, detail);
  return new ProviderError("provider_bad_params", false, detail);
}

const detailOf = (body: unknown) => {
  const b = body as { detail?: unknown; error?: unknown; message?: unknown } | null;
  const d = b?.detail ?? b?.error ?? b?.message ?? "";
  return (typeof d === "string" ? d : JSON.stringify(d)).slice(0, 300);
};

export async function falSubmit(model: string, input: Record<string, unknown>): Promise<FalRequest> {
  const res = await falFetch(`${QUEUE}/${model}`, { method: "POST", body: JSON.stringify(input) });
  const body = (await res.json().catch(() => ({}))) as { request_id?: string; status_url?: string; response_url?: string };
  if (!res.ok) throw errorFor(res.status, `${res.status} ${detailOf(body)}`);
  if (!body.request_id) throw new ProviderError("provider_bad_response", false, "fal: no request_id");
  const base = `${QUEUE}/${model.split("/").slice(0, 2).join("/")}/requests/${body.request_id}`;
  console.log("[fal] task", body.request_id, model);
  return { requestId: body.request_id, statusUrl: body.status_url ?? `${base}/status`, responseUrl: body.response_url ?? base };
}

const onFal = (u: string) => { try { return new URL(u).hostname.endsWith("fal.run"); } catch { return false; } };

export async function falStatus(r: FalRequest): Promise<ProviderJobStatus> {
  if (!onFal(r.statusUrl) || !onFal(r.responseUrl)) return { state: "failed", errorCode: "provider_bad_response", retryable: false };
  const res = await falFetch(r.statusUrl);
  const st = (await res.json().catch(() => ({}))) as { status?: string; queue_position?: number };
  if (!res.ok) {
    if (res.status >= 500 || res.status === 429) return { state: "processing" };
    const e = errorFor(res.status, detailOf(st));
    return { state: "failed", errorCode: e.code, retryable: false };
  }
  if (st.status === "IN_QUEUE") return { state: "queued" };
  if (st.status !== "COMPLETED") return { state: "processing" };
  const out = await falFetch(r.responseUrl);
  const body = (await out.json().catch(() => ({}))) as { video?: { url?: string } };
  if (!out.ok) {
    const e = errorFor(out.status, detailOf(body));
    console.error("[fal] task failed", r.requestId, e.code, e.message.slice(0, 200));
    return { state: "failed", errorCode: e.code, retryable: false };
  }
  const url = body.video?.url;
  if (!url) return { state: "failed", errorCode: "provider_no_output", retryable: false };
  console.log("[fal] task", r.requestId, "done");
  return { state: "succeeded", outputUrl: url };
}

export async function falCancel(r: FalRequest) {
  if (!onFal(r.statusUrl)) return;
  await falFetch(r.statusUrl.replace(/\/status$/, "/cancel"), { method: "PUT" }).catch(() => {});
}
