import { kk } from "@/lib/i18n/kk";
import { refundDoc } from "@/lib/legal/docs";
import { LegalPage } from "../legal-page";

export const metadata = { title: kk.footer.refund };

export default function Page() {
  return <LegalPage path="/refund" doc={refundDoc} />;
}
