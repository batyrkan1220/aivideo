import { redirect, notFound } from "next/navigation";
import { z } from "zod";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { env } from "@/lib/env";
import { emptyTemplate, rowToInput } from "@/lib/templates/admin-schema";
import { TemplateEditor } from "./editor";
import { akoolPricingSettings } from "@/lib/pricing-akool/settings";

/** Server part of the editor: permission check + data loading. `id` null = new template. */
export async function EditorLoader({ id }: { id: string | null }) {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;

  const db = supabaseAdmin();
  const { data: cats } = await db.from("categories").select("id,title_kk").order("sort_order");
  const categories = (cats ?? []).map((c) => ({ id: c.id, title: c.title_kk }));
  const mediaBase = `${env().NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public/template-media`;
  const akoolPricing = await akoolPricingSettings();

  if (!id) {
    return (
      <>
        <h1 className="mb-6 font-display text-2xl font-bold">{ru.admin.editor.createTitle}</h1>
        <TemplateEditor id={null} initial={emptyTemplate()} status="draft" categories={categories} mediaBase={mediaBase} akoolPricing={akoolPricing} />
      </>
    );
  }

  if (!z.string().uuid().safeParse(id).success) notFound();
  const { data: row } = await db.from("templates").select("*").eq("id", id).maybeSingle();
  if (!row) notFound();

  return (
    <>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold">{ru.admin.editor.editTitle}</h1>
        <span className="rounded-full bg-line px-3 py-1 text-xs font-semibold">
          {ru.admin.status[row.status as keyof typeof ru.admin.status]}
        </span>
      </div>
      <TemplateEditor key={row.updated_at} id={id} initial={rowToInput(row)} status={row.status} categories={categories} mediaBase={mediaBase} akoolPricing={akoolPricing} />
    </>
  );
}
