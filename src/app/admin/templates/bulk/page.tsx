import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { seedancePricingSettings } from "@/lib/pricing-seedance/settings";
import { BulkPhotoUpload } from "./uploader";

export default function BulkPhotoPage() {
  return (
    <div>
      <Link href="/admin/templates" className="text-sm text-muted hover:text-ink">← {ru.admin.nav.templates}</Link>
      <h1 className="mb-2 mt-2 font-display text-2xl font-bold">{ru.admin.bulk.title}</h1>
      <p className="mb-6 max-w-2xl text-sm text-muted">{ru.admin.bulk.intro}</p>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Loader />
      </Suspense>
    </div>
  );
}

async function Loader() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/templates/bulk");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const [{ data: cats }, pricing] = await Promise.all([
    supabaseAdmin().from("categories").select("id,title_kk").order("sort_order"),
    seedancePricingSettings(),
  ]);
  return (
    <BulkPhotoUpload
      categories={(cats ?? []).map((c) => ({ id: c.id, title: c.title_kk }))}
      canPublish={can(u.role, "templates.publish")}
      costKzt={Math.round(pricing.photoCostUsd * pricing.tengePerUsd)}
    />
  );
}
