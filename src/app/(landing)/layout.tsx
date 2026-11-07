import { PendingTelegramLogin } from "@/components/pending-telegram-login";

/** Ad landing pages: no header, footer or tab bar — only the template and the order form. */
export default function LandingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="theme-app theme-dark flex min-h-full flex-1 flex-col bg-paper text-ink">
      {children}
      <PendingTelegramLogin />
    </div>
  );
}
