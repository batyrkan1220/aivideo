import { redirect } from "next/navigation";

/** No email or password on the platform: sign-in is Telegram only. */
export default function Page() {
  redirect("/login");
}
