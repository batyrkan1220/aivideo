import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { comboEligibleTemplates } from "@/lib/combos/catalog";
import { comboConfigSchema } from "@/lib/combos/worker";
import { ComboEditor } from "./editor";

const T = ru.admin.combos;

export default function AdminCombosPage() {
  return (
    <div>
      <h1 className="font-display text-2xl font-bold">{T.title}</h1>
      <p className="mb-6 mt-2 max-w-2xl text-sm text-muted">{T.hint}</p>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <Body />
      </Suspense>
    </div>
  );
}

async function Body() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/combos");
  if (!can(u.role, "templates.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const [{ data }, items] = await Promise.all([
    supabaseAdmin().from("templates").select("id,title_kk,description_kk,provider_config_json,pricing_config_json")
      .eq("kind", "combo").is("deleted_at", null).order("created_at", { ascending: false }),
    comboEligibleTemplates(),
  ]);
  const combos = (data ?? []).flatMap((t) => {
    const cfg = comboConfigSchema.safeParse(t.provider_config_json);
    if (!cfg.success) return [];
    return [{
      id: t.id, title: t.title_kk, description: t.description_kk ?? "",
      discountPercent: cfg.data.discountPercent, templateIds: cfg.data.templateIds,
      priceKzt: Number((t.pricing_config_json as { basePriceKzt?: number }).basePriceKzt ?? 0),
    }];
  });
  return <ComboEditor combos={combos} items={items} />;
}
