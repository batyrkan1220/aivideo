import { NextResponse, type NextRequest } from "next/server";
import { handlePaymentWebhook } from "@/lib/payments/process";

// Provider callbacks. Authenticity is proven by the provider signature, not by cookies.
export async function POST(request: NextRequest, { params }: { params: Promise<{ provider: string }> }) {
  const { provider } = await params;
  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) return NextResponse.json({ ok: false }, { status: 413 });
  const out = await handlePaymentWebhook(provider, rawBody, request.headers);
  return NextResponse.json({ ok: out.http === 200, result: out.result }, { status: out.http });
}
