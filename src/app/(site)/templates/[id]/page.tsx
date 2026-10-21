import { Suspense } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getTemplate } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";

export default function TemplatePage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-6xl px-4 pt-8">
      <Link href="/templates" className="text-sm font-medium text-muted hover:text-ink">← {kk.template.back}</Link>
      <Suspense fallback={<div className="mt-6 aspect-[9/16] max-w-sm animate-pulse rounded-card bg-line" />}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const t = await getTemplate(id);
  if (!t) notFound();
  return <TemplateDetailView t={t} />;
}
