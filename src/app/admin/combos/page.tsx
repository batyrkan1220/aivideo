import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { mediaUrl } from "@/lib/templates/queries";
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
  const db = supabaseAdmin();
  const { data } = await db.from("templates").select("id,title_kk,description_kk,provider_config_json,pricing_config_json")
    .eq("kind", "combo").is("deleted_at", null).order("created_at", { ascending: false });
  const parsed = (data ?? []).flatMap((t) => {
    const cfg = comboConfigSchema.safeParse(t.provider_config_json);
    return cfg.success ? [{ t, cfg: cfg.data }] : [];
  });
  const ids = [...new Set(parsed.flatMap((x) => x.cfg.templateIds))];
  const { data: items } = ids.length
    ? await db.from("templates").select("id,cover_asset_path,pricing_config_json").in("id", ids)
    : { data: [] as { id: string; cover_asset_path: string | null; pricing_config_json: unknown }[] };
  const byId = new Map((items ?? []).map((i) => [i.id, i]));
  const combos = parsed.map(({ t, cfg }) => {
    const first = byId.get(cfg.templateIds[0]);
    return {
      id: t.id, title: t.title_kk, description: t.description_kk ?? "", discountPercent: cfg.discountPercent,
      pricePerPhoto: cfg.pricePerPhoto ?? Number((first?.pricing_config_json as { basePriceKzt?: number } | undefined)?.basePriceKzt ?? 990),
      priceKzt: Number((t.pricing_config_json as { basePriceKzt?: number }).basePriceKzt ?? 0),
      photos: cfg.templateIds.flatMap((id) => {
        const it = byId.get(id);
        return it ? [{ id, url: mediaUrl(it.cover_asset_path) }] : [];
      }),
    };
  });
  return <ComboEditor combos={combos} />;
}
