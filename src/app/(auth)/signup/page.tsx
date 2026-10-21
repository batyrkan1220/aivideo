import { Suspense } from "react";
import Link from "next/link";
import { kk } from "@/lib/i18n/kk";
import { safeNext } from "@/lib/auth/redirect";
import { signupAction } from "../actions";
import { AuthForm } from "../auth-form";

export const metadata = { title: kk.auth.signupTitle };

export default function SignupPage(props: { searchParams: Promise<Record<string, string | undefined>> }) {
  return (
    <Suspense fallback={null}>
      <Content searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next);
  return (
    <>
      <h1 className="mb-6 text-xl font-semibold">{kk.auth.signupTitle}</h1>
      <AuthForm
        action={signupAction}
        next={next}
        submitLabel={kk.auth.signup}
        fields={[
          { name: "displayName", label: kk.auth.displayName, type: "text", autoComplete: "name" },
          { name: "email", label: kk.auth.email, type: "email", autoComplete: "email" },
          { name: "password", label: kk.auth.password, type: "password", autoComplete: "new-password", minLength: 8 },
        ]}
      />
      <p className="mt-6 text-center text-sm text-neutral-600">
        {kk.auth.haveAccount}{" "}
        <Link href={`/login?next=${encodeURIComponent(next)}`} className="font-semibold text-neutral-900 hover:underline">
          {kk.auth.login}
        </Link>
      </p>
    </>
  );
}
