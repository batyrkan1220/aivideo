import { kk } from "@/lib/i18n/kk";
import { updatePasswordAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: kk.auth.resetTitle };

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{kk.auth.resetTitle}</h1>
      <AuthForm
        action={updatePasswordAction}
        submitLabel={kk.auth.setPassword}
        fields={[{ name: "password", label: kk.auth.newPassword, type: "password", autoComplete: "new-password", minLength: 8 }]}
      />
    </>
  );
}
