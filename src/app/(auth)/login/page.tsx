import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { safeNext } from "@/lib/auth/redirect";
import { loginAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: kk.auth.loginTitle };

export default function LoginPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const sp = await searchParams;
  const next = safeNext(sp.next, "/account");
  return (
    <>
      <h1 className="mb-6 font-display text-2xl font-bold">{kk.auth.loginTitle}</h1>
      {sp.error === "link" && <p className="mb-4 text-sm text-danger">{kk.auth.linkExpired}</p>}
      <AuthForm
        action={loginAction}
        next={next}
        submitLabel={kk.auth.login}
        fields={[
          { name: "email", label: kk.auth.email, type: "email", autoComplete: "email" },
          { name: "password", label: kk.auth.password, type: "password", autoComplete: "current-password" },
        ]}
      />
      <div className="mt-6 space-y-2 text-center text-sm text-muted">
        <Link href="/forgot-password" className="block underline-offset-4 hover:underline">{kk.auth.forgot}</Link>
        <p>
          {kk.auth.noAccount}{" "}
          <Link href={`/signup?next=${encodeURIComponent(next)}`} className="font-semibold text-brand hover:underline">
            {kk.auth.signup}
          </Link>
        </p>
      </div>
    </>
  );
}
