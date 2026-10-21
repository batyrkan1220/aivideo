import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { kk } from "@/lib/i18n/kk";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getTemplateForAdmin } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">{kk.common.loading}</p>}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{kk.admin.forbidden}</p>;
  const t = await getTemplateForAdmin(id);
  if (!t) notFound();
  return (
    <>
      <Link href={`/admin/templates/${id}`} className="text-sm font-medium text-muted hover:text-ink">← {kk.admin.editor.editTitle}</Link>
      <TemplateDetailView t={t} />
    </>
  );
}
