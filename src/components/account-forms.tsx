"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { kk } from "@/lib/i18n/kk";
import { confirmAsync, setNoAutoLogin, useIsTelegram } from "@/lib/telegram/client";
import { updateDisplayName, deleteAllPhotos, deleteAccount, type FormState } from "@/lib/account/actions";

const inputCls = "w-full rounded-xl border border-line bg-surface px-3 py-2 outline-none focus:border-brand";

/** Submit button that asks for confirmation before a destructive action. */
export function ConfirmSubmit({ message, children, className = "" }: { message: string; children: React.ReactNode; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      onClick={(e) => {
        // Ask first (Telegram-native dialog inside the Mini App), then submit the same form.
        e.preventDefault();
        const btn = e.currentTarget;
        void confirmAsync(message).then((ok) => { if (ok) btn.form?.requestSubmit(btn); });
      }}
      className={className}
    >
      {pending ? kk.common.loading : children}
    </button>
  );
}

function Msg({ s }: { s: FormState }) {
  if (s.ok) return <p className="text-sm text-success" role="status">{s.ok}</p>;
  if (s.error) return <p className="text-sm text-danger" role="alert">{s.error}</p>;
  return null;
}

export function DisplayNameForm({ current }: { current: string }) {
  const [state, action, pending] = useActionState(updateDisplayName, {});
  return (
    <form action={action} className="flex flex-wrap items-end gap-3">
      <label className="min-w-0 flex-1">
        <span className="mb-1 block text-xs font-medium text-muted">{kk.account.editName}</span>
        <input name="displayName" defaultValue={current} maxLength={80} required className={inputCls} />
      </label>
      <button disabled={pending} className="h-10 rounded-full border border-ink px-5 text-sm font-semibold hover:bg-ink hover:text-paper disabled:opacity-50">
        {kk.common.save}
      </button>
      <div className="w-full"><Msg s={state} /></div>
    </form>
  );
}

export function DeleteAllPhotosForm() {
  const [state, action] = useActionState(deleteAllPhotos, {});
  return (
    <form action={action} className="space-y-2">
      <ConfirmSubmit message={kk.account.deleteAllPhotosConfirm} className="rounded-full border border-line px-4 py-2 text-sm font-medium hover:border-danger hover:text-danger disabled:opacity-50">
        {kk.account.deleteAllPhotos}
      </ConfirmSubmit>
      <Msg s={state} />
    </form>
  );
}

export function DeleteAccountForm() {
  const [state, action] = useActionState(deleteAccount, {});
  const inTelegram = useIsTelegram();
  const [word, setWord] = useState("");
  const ready = word.trim().toUpperCase() === kk.account.deleteAccountWord;
  return (
    <form action={action} className="space-y-3" onSubmit={() => { if (inTelegram) setNoAutoLogin(true); }}>
      <p className="text-sm text-muted">{kk.account.deleteAccountText}</p>
      <label className="block max-w-xs">
        <span className="mb-1 block text-xs font-medium text-muted">{kk.account.deleteAccountTypeHint}</span>
        <input name="confirm" value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" className={inputCls} />
      </label>
      <ConfirmSubmit message={kk.account.deleteAccountText} className={`rounded-full px-5 py-2.5 text-sm font-semibold text-white ${ready ? "bg-danger hover:opacity-90" : "pointer-events-none bg-danger/40"}`}>
        {kk.account.deleteAccountButton}
      </ConfirmSubmit>
      <Msg s={state} />
    </form>
  );
}

/** Logout. Inside Telegram it also stops the automatic Telegram sign-in for this session. */
export function LogoutButton({ action }: { action: () => Promise<void> }) {
  const inTelegram = useIsTelegram();
  return (
    <form action={action} onSubmit={() => { if (inTelegram) setNoAutoLogin(true); }}>
      <button className="rounded-full border border-line bg-surface px-4 py-2 text-sm font-medium hover:border-ink">
        {kk.nav.logout}
      </button>
    </form>
  );
}

/** Telegram users: deleting the account, then reopening the bot, starts a fresh empty account. */
export function TelegramDeleteNote() {
  return useIsTelegram() ? <p className="mb-3 text-sm text-muted">{kk.account.telegramDeleteNote}</p> : null;
}
