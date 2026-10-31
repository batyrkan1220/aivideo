import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { CategoryManager } from "./manager";

const C = ru.admin.categories;

export default function AdminCategoriesPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">{C.title}</h1>
      <p className="mb-6 mt-2 max-w-2xl text-sm text-muted">{C.hint}</p>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/categories");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const db = supabaseAdmin();
  const [{ data: cats }, { data: tpls }] = await Promise.all([
    db.from("categories").select("id,title_kk,slug,is_active").order("sort_order").order("created_at"),
    db.from("templates").select("category_id").eq("kind", "catalog").is("deleted_at", null).not("category_id", "is", null),
  ]);
  const count = new Map<string, number>();
  for (const t of tpls ?? []) count.set(t.category_id as string, (count.get(t.category_id as string) ?? 0) + 1);
  const rows = (cats ?? []).map((c) => ({ id: c.id, title: c.title_kk, slug: c.slug, isActive: c.is_active, templates: count.get(c.id) ?? 0 }));
  return <CategoryManager rows={rows} />;
}
