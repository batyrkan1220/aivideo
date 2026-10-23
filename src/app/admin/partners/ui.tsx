import { ru } from "@/lib/i18n/ru";
import { formatKzt } from "@/lib/pricing";

export function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-card border border-line bg-white p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-2xl font-bold">{value}</dd>
    </div>
  );
}

export function PeriodForm({ from, to }: { from: string; to: string }) {
  const S = ru.admin.stats;
  return (
    <form className="flex flex-wrap items-end gap-3 text-sm">
      <label><span className="block text-xs text-muted">{S.from}</span><input type="date" name="from" defaultValue={from} className="rounded-xl border border-line px-3 py-2 text-base sm:text-sm" /></label>
      <label><span className="block text-xs text-muted">{S.to}</span><input type="date" name="to" defaultValue={to} className="rounded-xl border border-line px-3 py-2 text-base sm:text-sm" /></label>
      <button className="rounded-full bg-ink px-4 py-2 font-semibold text-white">{S.apply}</button>
    </form>
  );
}

export function DailyTable({ rows }: { rows: { day: string; visits: number; users: number; paidOrders: number; revenueKzt: number; earnedKzt: number }[] }) {
  const T = ru.admin.partners;
  const fmt = new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "short", weekday: "short", timeZone: "UTC" });
  const active = rows.filter((r) => r.visits || r.users || r.paidOrders);
  if (!active.length) return <p className="rounded-card border border-dashed border-line bg-white p-6 text-center text-sm text-muted">{T.noData}</p>;
  return (
    <div className="overflow-x-auto rounded-card border border-line bg-white">
      <table className="w-full min-w-[36rem] text-left text-sm">
        <thead className="border-b border-line text-xs text-muted">
          <tr>{[T.date, T.visits, T.users, T.paidOrders, T.revenue, T.earned].map((h) => <th key={h} className="px-4 py-2 font-medium">{h}</th>)}</tr>
        </thead>
        <tbody className="divide-y divide-line">
          {active.map((r) => (
            <tr key={r.day}>
              <td className="px-4 py-2">{fmt.format(new Date(`${r.day}T00:00:00Z`))}</td>
              <td className="px-4 py-2">{r.visits}</td>
              <td className="px-4 py-2">{r.users}</td>
              <td className="px-4 py-2">{r.paidOrders}</td>
              <td className="px-4 py-2">{formatKzt(r.revenueKzt)}</td>
              <td className="px-4 py-2">{formatKzt(r.earnedKzt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
