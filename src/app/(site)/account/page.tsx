import { Suspense } from "react";
import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import { ChevronRight, Clapperboard, FileText, ImageIcon, LifeBuoy, Plus, ShieldCheck, Sparkles, Undo2, Wrench, Send } from "lucide-react";
import { requireUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/(auth)/actions";
import { kk } from "@/lib/i18n/kk";
import { isGuestEmail, isTelegramEmail } from "@/lib/telegram/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { LogoutButton } from "@/components/account-forms";
import { PHOTOS_SOON } from "@/lib/features";
import { TelegramBotLogin } from "@/components/telegram-bot-login";
import { avatarUrl, refreshTelegramAvatar } from "@/lib/telegram/avatar";
import { mediaUrl } from "@/lib/templates/queries";
import { AddToHome } from "@/components/add-to-home";

export const metadata = { title: kk.account.title };

const P = kk.profile;
const WORKING = ["queued", "processing", "postprocessing"];

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-8 pt-4 sm:pt-10 md:max-w-5xl md:px-6 md:pb-12 lg:px-8">
      <Suspense fallback={<ProfileSkeleton />}>
        <Profile />
      </Suspense>
    </main>
  );
}

function ProfileSkeleton() {
  return (
    <div className="grid gap-4 md:grid-cols-[340px_minmax(0,1fr)] md:gap-8 lg:grid-cols-[380px_minmax(0,1fr)]" aria-hidden>
      <div className="skeleton h-80 rounded-card" />
      <div className="space-y-4">
        <div className="skeleton h-44 rounded-card" />
        <div className="skeleton h-56 rounded-card" />
      </div>
    </div>
  );
}

function Row({ href, icon: Icon, label, hint }: { href: string; icon: LucideIcon; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="group flex min-h-14 items-center gap-3.5 px-4 py-3 transition-colors hover:bg-mist/60 active:bg-mist sm:px-5">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-mist text-ink" aria-hidden>
          <Icon size={18} strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-medium leading-tight">{label}</span>
          {hint && <span className="mt-0.5 block truncate text-xs text-muted">{hint}</span>}
        </span>
        <ChevronRight size={18} className="shrink-0 text-muted transition-transform group-hover:translate-x-0.5" aria-hidden />
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="t-eyebrow mb-2.5 px-1 text-muted">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">{children}</ul>
    </section>
  );
}

type OrderRow = {
  id: string; payment_status: string; generation_status: string;
  template_snapshot_json: { title_kk?: string; provider_key?: string } | null;
  templates: { cover_thumb_path: string | null; cover_asset_path: string | null } | { cover_thumb_path: string | null; cover_asset_path: string | null }[] | null;
};

function statusOf(o: OrderRow): { label: string; dot: string } {
  if (o.generation_status === "completed") return { label: P.statusReady, dot: "bg-[#22c55e]" };
  if (WORKING.includes(o.generation_status)) return { label: P.statusWork, dot: "bg-amber-400 animate-pulse" };
  if (o.generation_status === "failed") return { label: P.statusFail, dot: "bg-rose-500" };
  return { label: P.statusPay, dot: "bg-white/70" };
}

async function Profile() {
  const user = await requireUser("/account");
  const db = supabaseAdmin();
  const [{ data: prof }, { data: orders }] = await Promise.all([
    db.from("profiles").select("telegram_id,telegram_username,created_at,avatar_path,avatar_checked_at").eq("id", user.id).maybeSingle(),
    db.from("orders")
      .select("id,payment_status,generation_status,template_snapshot_json,templates(cover_thumb_path,cover_asset_path)")
      .eq("user_id", user.id).is("parent_order_id", null).neq("generation_status", "cancelled")
      .order("created_at", { ascending: false }).limit(200),
  ]);
  const list = (orders ?? []) as unknown as OrderRow[];
  const ready = list.filter((o) => o.generation_status === "completed").length;
  const working = list.filter((o) => WORKING.includes(o.generation_status)).length;
  const recent = list.filter((o) => o.generation_status !== "awaiting_payment" || o.payment_status === "paid").slice(0, 4);

  const tg = isTelegramEmail(user.email);
  const guest = isGuestEmail(user.email);
  const username = prof?.telegram_username ? `@${prof.telegram_username}` : null;
  const name = user.displayName?.trim() || username || (tg || guest ? P.guest : (user.email ?? "").split("@")[0] || P.guest);
  const sub = guest ? kk.account.guestNote : tg ? (username && username !== name ? username : kk.account.viaTelegram) : user.email ?? "";
  // Accounts made before photos were saved: fetch it now in the background (shows on the next visit).
  if (prof?.telegram_id && !prof.avatar_checked_at) void refreshTelegramAvatar(user.id, Number(prof.telegram_id));
  const avatar = avatarUrl(prof?.avatar_path);
  const since = prof?.created_at
    ? new Intl.DateTimeFormat("ru-RU", { month: "short", year: "numeric", timeZone: "Asia/Almaty" }).format(new Date(prof.created_at)).replace(" г.", "").replace(".", "")
    : "—";

  return (
    <div className="grid gap-x-8 md:grid-cols-[340px_minmax(0,1fr)] md:items-start lg:grid-cols-[380px_minmax(0,1fr)]">
      {/* Left (desktop: stays in view): who you are and the main actions. */}
      <aside className="md:sticky md:top-20">
          {/* Who: avatar, name, numbers, the two main actions. */}
          <section className="relative overflow-hidden rounded-card border border-line/80 bg-surface px-5 pb-5 pt-7 text-center elev-sm sm:px-7">
            <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-mist to-transparent" aria-hidden />
            <div className="relative mx-auto w-fit">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" width={88} height={88} className="h-[88px] w-[88px] rounded-full bg-mist object-cover ring-4 ring-surface shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)]" />
              ) : (
                <span className="flex h-[88px] w-[88px] items-center justify-center rounded-full bg-ink font-display text-3xl text-paper ring-4 ring-surface shadow-[0_12px_30px_-12px_rgb(0_0_0/0.35)]" aria-hidden>
                  {name.replace(/^@/, "").charAt(0).toUpperCase() || "T"}
                </span>
              )}
              {tg && (
                <span className="absolute -bottom-0.5 -right-0.5 flex h-7 w-7 items-center justify-center rounded-full bg-[#2aabee] text-white ring-[3px] ring-surface" aria-label={kk.account.viaTelegram}>
                  <Send size={13} strokeWidth={2.4} className="-ml-px" aria-hidden />
                </span>
              )}
            </div>
            <h1 className="relative mt-4 truncate font-display text-[1.6rem] leading-tight">{name}</h1>
            {sub && <p className="relative mt-1 truncate text-sm text-muted">{sub}</p>}

            <dl className="relative mt-5 grid grid-cols-3 divide-x divide-line rounded-2xl bg-mist/70 py-3">
              {[
                { k: P.ready, v: String(ready) },
                { k: P.inWork, v: String(working) },
                { k: P.withUs, v: since, small: true },
              ].map((s) => (
                <div key={s.k} className="flex min-w-0 flex-col-reverse items-center justify-end px-2">
                  <dt className="mt-1.5 text-[11px] font-medium uppercase tracking-wide text-muted">{s.k}</dt>
                  <dd className={`max-w-full truncate font-display leading-none ${"small" in s ? "pt-1 text-[15px]" : "text-xl"}`}>{s.v}</dd>
                </div>
              ))}
            </dl>

            <div className="relative mt-4 grid grid-cols-2 gap-2">
              <Link href="/" className="btn-glow flex h-12 items-center justify-center gap-1.5 rounded-full text-sm font-semibold">
                <Plus size={17} strokeWidth={2.4} aria-hidden />{P.createVideo}
              </Link>
              <Link href="/orders" className="flex h-12 items-center justify-center rounded-full border border-line bg-surface text-sm font-semibold transition-colors hover:border-ink">
                {kk.gallery.title}
              </Link>
            </div>
          </section>

          <AddToHome />

          {/* Guest (photos uploaded from an ad, not confirmed yet): keep them by signing in with Telegram. */}
          {guest && (
            <section className="mt-4 rounded-card border border-line/80 bg-surface p-4 sm:p-6">
              <p className="font-semibold">{kk.account.guestTitle}</p>
              <p className="mb-3 mt-0.5 text-sm text-muted">{kk.account.guestText}</p>
              <TelegramBotLogin next="/account" compact />
            </section>
          )}

          {/* Inside the Telegram Mini App the account is the Telegram account: no logout there. */}
          <section className="tg-hide mt-5 hidden justify-center md:flex">
            <LogoutButton action={logoutAction} />
          </section>
      </aside>

      {/* Right: your works and the menu. */}
      <div className="min-w-0 md:[&>section:first-child]:mt-0">

          {/* Latest works: straight back to a video. */}
          <section className="mt-6">
            <div className="mb-2.5 flex items-center justify-between px-1">
              <h2 className="t-eyebrow text-muted">{P.recent}</h2>
              {recent.length > 0 && <Link href="/orders" className="text-sm font-medium text-ink underline-offset-4 hover:underline">{P.all}</Link>}
            </div>
            {recent.length ? (
              <ul className="grid grid-cols-4 gap-2">
                {recent.map((o) => {
                  const t = Array.isArray(o.templates) ? o.templates[0] : o.templates;
                  const thumb = mediaUrl(t?.cover_thumb_path ?? t?.cover_asset_path ?? null);
                  const st = statusOf(o);
                  return (
                    <li key={o.id}>
                      <Link href={`/orders/${o.id}`} className="group relative block aspect-[3/4] overflow-hidden rounded-xl bg-mist ring-1 ring-black/5">
                        {thumb && (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={thumb} alt="" loading="lazy" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.04]" />
                        )}
                        <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-black/65 to-transparent" aria-hidden />
                        <span className="absolute inset-x-1.5 bottom-1.5 flex items-center gap-1 text-[10px] font-medium text-white">
                          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${st.dot}`} aria-hidden />
                          <span className="truncate">{st.label}</span>
                        </span>
                        <span className="sr-only">{o.template_snapshot_json?.title_kk ?? ""}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="rounded-card border border-dashed border-line bg-surface/60 px-5 py-6 text-center">
                <p className="font-semibold">{P.emptyTitle}</p>
                <p className="mx-auto mt-1 max-w-xs text-sm text-muted">{P.emptyText}</p>
                <Link href="/" className="mt-4 inline-flex h-10 items-center rounded-full bg-ink px-5 text-sm font-semibold text-paper">{P.pick}</Link>
              </div>
            )}
          </section>
        <div>

            <Group title={P.creative}>
              <Row href="/" icon={Clapperboard} label={P.videoTemplates} hint={P.videoTemplatesHint} />
              {!PHOTOS_SOON && <Row href="/photos" icon={ImageIcon} label={P.photoTemplates} hint={P.photoTemplatesHint} />}
              <Row href="/create" icon={Sparkles} label={P.ownVideo} hint={P.ownVideoHint} />
            </Group>

            <Group title={P.help}>
              <Row href="/support" icon={LifeBuoy} label={kk.nav.support} hint={kk.legal.supportText} />
              <Row href="/terms" icon={FileText} label={kk.footer.terms} />
              <Row href="/privacy" icon={ShieldCheck} label={kk.footer.privacy} />
              <Row href="/refund" icon={Undo2} label={kk.footer.refund} />
              {isStaff(user.role) && <Row href="/admin" icon={Wrench} label={kk.nav.admin} hint={kk.account.roles[user.role]} />}
            </Group>
        </div>
        <section className="tg-hide mt-8 flex justify-center md:hidden">
          <LogoutButton action={logoutAction} />
        </section>
      </div>
    </div>
  );
}
