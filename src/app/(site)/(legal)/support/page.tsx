import { kk } from "@/lib/i18n/kk";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.nav.support };

export default function Page() {
  return (
    <LegalPage title={kk.nav.support}>
      <p>{kk.legal.supportText}</p>
    </LegalPage>
  );
}
