import { Suspense } from "react";
import Link from "next/link";
import { requireUser } from "@/lib/auth/session";
import { isStaff } from "@/lib/auth/permissions";
import { logoutAction } from "@/app/(auth)/actions";
import { kk } from "@/lib/i18n/kk";
import { isGuestEmail, isTelegramEmail } from "@/lib/telegram/session";
import { supabaseAdmin } from "@/lib/supabase/server";
import { DisplayNameForm, DeleteAllPhotosForm, DeleteAccountForm, LogoutButton, TelegramDeleteNote } from "@/components/account-forms";
import { PHOTOS_SOON } from "@/lib/features";
import { TelegramBotLogin } from "@/components/telegram-bot-login";

export const metadata = { title: kk.account.title };

const P = kk.profile;

export default function AccountPage() {
  return (
    <main className="mx-auto w-full max-w-xl px-4 pb-6 pt-4 sm:pt-10">
      <Suspense fallback={<div className="skeleton h-60 rounded-card" />}>
        <Profile />
      </Suspense>
    </main>
  );
}

const Chevron = () => (
  <svg viewBox="0 0 24 24" className="h-4 w-4 text-muted" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d="m9 6 6 6-6 6" /></svg>
);

function Row({ href, icon, label, hint }: { href: string; icon: string; label: string; hint?: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-4 px-4 py-4 transition-colors hover:bg-mist/60 active:bg-mist sm:px-6">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-mist text-base" aria-hidden>{icon}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">{label}</span>
          {hint && <span className="block truncate text-xs text-muted">{hint}</span>}
        </span>
        <Chevron />
      </Link>
    </li>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="t-eyebrow mb-3 px-1 text-muted">{title}</h2>
      <ul className="divide-y divide-line overflow-hidden rounded-card border border-line/80 bg-surface">{children}</ul>
    </section>
  );
}

async function Profile() {
  const user = await requireUser("/account");
  const db = supabaseAdmin();
  const [{ data: prof }, { data: done }] = await Promise.all([
    db.from("profiles").select("telegram_username,created_at").eq("id", user.id).maybeSingle(),
    db.from("orders").select("template_snapshot_json->>provider_key").eq("user_id", user.id).eq("generation_status", "completed"),
  ]);
  const photos = (done ?? []).filter((o) => (o as { provider_key?: string }).provider_key === "kling_photo").length;
  const videos = (done ?? []).length - photos;
  const tg = isTelegramEmail(user.email);
  const guest = isGuestEmail(user.email);
  const name = user.displayName?.trim() || (prof?.telegram_username ? `@${prof.telegram_username}` : tg || guest ? P.guest : (user.email ?? "").split("@")[0] || P.guest);
  const since = prof?.created_at ? new Intl.DateTimeFormat("ru-RU", { month: "long", year: "numeric", timeZone: "Asia/Almaty" }).format(new Date(prof.created_at)) : null;

  return (
    <>
      {/* Header card */}
      <section className="relative overflow-hidden rounded-card bg-night p-6 text-white elev-lg">
        <span className="pointer-events-none absolute -right-12 -top-16 h-48 w-48 rounded-full bg-[#d7f443]/20 blur-3xl" aria-hidden />
        <div className="relative flex items-center gap-4">
          <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-[#d7f443] text-2xl font-extrabold text-black" aria-hidden>
            {name.replace(/^@/, "").charAt(0).toUpperCase() || "T"}
          </span>
          <div className="min-w-0">
            <p className="truncate text-xl font-extrabold tracking-tight">{name}</p>
            <p className="mt-0.5 truncate text-sm text-white/65">{tg ? kk.account.viaTelegram : guest ? kk.account.guestNote : user.email ?? ""}</p>
            {since && <p className="mt-0.5 text-xs text-white/45">{P.since(since)}</p>}
          </div>
        </div>
        <dl className="relative mt-5 grid grid-cols-3 gap-2 text-center">
          {[
            { k: P.videos, v: videos },
            { k: P.photos, v: photos },
            { k: P.total, v: videos + photos },
          ].map((s) => (
            <div key={s.k} className="rounded-2xl bg-white/10 px-2 py-3">
              <dd className="text-2xl font-extrabold leading-none">{s.v}</dd>
              <dt className="mt-1 text-[11px] font-medium text-white/60">{s.k}</dt>
            </div>
          ))}
        </dl>
        <div className="relative mt-4 grid grid-cols-2 gap-2">
          <Link href="/create" className="btn-glow flex h-11 items-center justify-center rounded-full text-sm font-bold">+ {kk.nav.tabCreate}</Link>
          <Link href="/orders" className="flex h-11 items-center justify-center rounded-full bg-white/10 text-sm font-bold text-white">{kk.gallery.title}</Link>
        </div>
      </section>

      {/* Guest (photos uploaded from an ad, not confirmed yet): keep them by signing in with Telegram. */}
      {guest && (
        <section className="mt-4 rounded-card border border-line/80 bg-surface p-4 sm:p-6">
          <p className="font-bold">{kk.account.guestTitle}</p>
          <p className="mb-3 mt-0.5 text-sm text-muted">{kk.account.guestText}</p>
          <TelegramBotLogin next="/account" compact />
        </section>
      )}

      <Group title={P.creative}>
        <Row href="/" icon="🎬" label={P.videoTemplates} hint={P.videoTemplatesHint} />
        {!PHOTOS_SOON && <Row href="/photos" icon="📸" label={P.photoTemplates} hint={P.photoTemplatesHint} />}
        <Row href="/create" icon="✨" label={P.ownVideo} hint={P.ownVideoHint} />
      </Group>

      <Group title={P.help}>
        <Row href="/support" icon="💬" label={kk.nav.support} hint={kk.legal.supportText} />
        <Row href="/terms" icon="📄" label={kk.footer.terms} />
        <Row href="/privacy" icon="🔒" label={kk.footer.privacy} />
        <Row href="/refund" icon="↩️" label={kk.footer.refund} />
        {isStaff(user.role) && <Row href="/admin" icon="🛠" label={kk.nav.admin} hint={kk.account.roles[user.role]} />}
      </Group>

      <section className="mt-6">
        <h2 className="t-eyebrow mb-3 px-1 text-muted">{P.settings}</h2>
        <div className="space-y-4 rounded-card border border-line/80 bg-surface p-4 sm:p-6">
          <div>
            <p className="mb-2 text-[15px] font-semibold">{kk.account.editName}</p>
            <DisplayNameForm current={user.displayName ?? ""} />
          </div>
          <div className="border-t border-line pt-4">
            <p className="text-[15px] font-semibold">{kk.account.privacyTitle}</p>
            <p className="mb-3 mt-1 text-sm text-muted">{kk.account.privacyText}</p>
            <DeleteAllPhotosForm />
          </div>
        </div>
      </section>

      {/* Inside the Telegram Mini App the account is the Telegram account: no logout / delete there. */}
      <section className="tg-hide mt-6 space-y-3">
        <div className="flex justify-center"><LogoutButton action={logoutAction} /></div>
        <details className="rounded-card border border-line/80 bg-surface p-4 sm:p-6">
          <summary className="cursor-pointer text-sm font-semibold text-danger">{kk.account.deleteAccount}</summary>
          <div className="mt-3">
            <TelegramDeleteNote />
            <DeleteAccountForm />
          </div>
        </details>
      </section>
    </>
  );
}
