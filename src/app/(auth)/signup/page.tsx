import { Suspense } from "react";
import { redirect } from "next/navigation";
import { safeNext } from "@/lib/auth/redirect";

/** No separate sign-up: the first Telegram sign-in creates the account. */
export default function SignupPage(props: { searchParams: Promise<{ next?: string }> }) {
  return (
    <Suspense fallback={null}>
      <Go searchParams={props.searchParams} />
    </Suspense>
  );
}

async function Go({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const next = safeNext((await searchParams).next, "/account");
  redirect(`/login?next=${encodeURIComponent(next)}`);
  return null;
}
