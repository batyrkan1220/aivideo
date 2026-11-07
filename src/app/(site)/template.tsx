/**
 * No page-open animation: an animated wrapper (transform/opacity) around every page made the fixed
 * bars (bottom menu, pay bar) jump and flicker on phones while a page opened.
 */
export default function Template({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
