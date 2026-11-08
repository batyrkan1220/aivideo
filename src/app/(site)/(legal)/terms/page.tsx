import { kk } from "@/lib/i18n/kk";
import { termsDoc } from "@/lib/legal/docs";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.footer.terms };

export default function Page() {
  return <LegalPage path="/terms" doc={termsDoc} />;
}
