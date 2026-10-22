import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { getTemplateForAdmin } from "@/lib/templates/queries";
import { TemplateDetailView } from "@/components/template-detail";

export default function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
      <Preview params={params} />
    </Suspense>
  );
}

async function Preview({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const t = await getTemplateForAdmin(id);
  if (!t) notFound();
  return (
    <>
      <Link href={`/admin/templates/${id}`} className="-my-2 inline-block py-2 text-sm font-medium text-muted hover:text-ink">← {ru.admin.editor.editTitle}</Link>
      <TemplateDetailView t={t} />
    </>
  );
}
