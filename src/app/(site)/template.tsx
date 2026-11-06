/** Each page fades up softly when it opens (CSS only; respects reduced motion). */
export default function Template({ children }: { children: React.ReactNode }) {
  return <div className="animate-fade-up">{children}</div>;
}
