import { Suspense } from "react";
import { redirect } from "next/navigation";
import { ru } from "@/lib/i18n/ru";
import { getSessionUser } from "@/lib/auth/session";
import { can } from "@/lib/auth/permissions";
import { supabaseAdmin } from "@/lib/supabase/server";
import { ActionForm } from "../orders/action-form";
import { changeRole } from "../orders/actions";

const U = ru.admin.users;

export default function UsersPage() {
  return (
    <div>
      <h1 className="mb-6 font-display text-2xl font-bold">{ru.admin.nav.users}</h1>
      <Suspense fallback={<p className="text-muted">{ru.common.loading}</p>}>
        <List />
      </Suspense>
    </div>
  );
}

async function List() {
  const u = await getSessionUser();
  if (!u) redirect("/login?next=/admin/users");
  if (!can(u.role, "users.manage")) return <p className="text-muted">{ru.admin.forbidden}</p>;
  const { data } = await supabaseAdmin().from("profiles")
    .select("id,email,display_name,role,created_at").order("created_at", { ascending: false }).limit(500);
  const fmt = new Intl.DateTimeFormat("ru-RU", { dateStyle: "medium", timeZone: "Asia/Almaty" });
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-line text-muted">
          <tr>{[U.colEmail, U.colName, U.colCreated, U.colRole].map((h) => <th key={h} className="px-4 py-3 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {(data ?? []).map((p) => (
            <tr key={p.id}>
              <td className="px-4 py-3">{p.email}</td>
              <td className="px-4 py-3">{p.display_name ?? "—"}</td>
              <td className="px-4 py-3 text-muted">{fmt.format(new Date(p.created_at))}</td>
              <td className="px-4 py-3">
                {p.id === u.id ? ru.account.roles[p.role as keyof typeof ru.account.roles] : (
                  <ActionForm action={changeRole} fields={{ userId: p.id }} label={U.changeRole}>
                    <select name="role" defaultValue={p.role} className="rounded-xl border border-line px-2 py-1.5 text-base sm:text-sm">
                      {Object.entries(ru.account.roles).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </ActionForm>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
