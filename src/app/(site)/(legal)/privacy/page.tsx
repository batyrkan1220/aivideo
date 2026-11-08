import { kk } from "@/lib/i18n/kk";
import { privacyDoc } from "@/lib/legal/docs";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.footer.privacy };

export default function Page() {
  return <LegalPage path="/privacy" doc={privacyDoc} />;
}
