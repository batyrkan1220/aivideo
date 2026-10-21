import { kk } from "@/lib/i18n/kk";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.footer.refund };

export default function Page() {
  return <LegalPage title={kk.footer.refund} />;
}
