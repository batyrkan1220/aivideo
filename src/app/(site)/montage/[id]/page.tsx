import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { z } from "zod";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { MontageStatus } from "@/components/montage-status";

export const metadata = { title: "Ваш монтаж" };

export default function MontageResultPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-3xl px-4 pb-28 pt-3 md:pt-10">
      <Link href="/montage" className="mb-4 inline-flex items-center gap-1.5 text-sm font-semibold text-muted hover:text-ink"><ArrowLeft size={16} aria-hidden />Автомонтаж</Link>
      <Suspense fallback={<div className="skeleton h-96 rounded-card" />}>
        <Body params={params} />
      </Suspense>
    </main>
  );
}

async function Body({ params }: { params: Promise<{ id: string }> }) {
  await connection();
  const { id } = await params;
  if (!z.string().uuid().safeParse(id).success) notFound();
  const user = await getSessionUser();
  if (!user) redirect(`/login?next=/montage/${id}`);
  const { data: m } = await supabaseAdmin().from("montages").select("id,status,error_code,output_duration_sec").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!m || m.status === "draft") notFound();
  return <MontageStatus id={m.id} initial={{ status: m.status, error: m.error_code, durationSec: m.output_duration_sec }} />;
}
