import { kk } from "@/lib/i18n/kk";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.footer.terms };

export default function Page() {
  return <LegalPage title={kk.footer.terms} />;
}
