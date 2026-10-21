import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { requestResetAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: kk.auth.resetTitle };

export default function ForgotPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{kk.auth.resetTitle}</h1>
      <AuthForm
        action={requestResetAction}
        submitLabel={kk.auth.sendReset}
        fields={[{ name: "email", label: kk.auth.email, type: "email", autoComplete: "email" }]}
      />
      <Link href="/login" className="mt-6 block text-center text-sm text-neutral-600 hover:underline">
        {kk.common.back}
      </Link>
    </>
  );
}
