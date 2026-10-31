"use client";

import { useEffect, useState, type ReactNode } from "react";

/**
 * Mounts its children only on wide screens. CSS `hidden` alone still lets phones (and the
 * Telegram Mini App) download the hidden videos; this keeps them out of the DOM entirely.
 */
export function DesktopOnly({ children, minWidth = 768 }: { children: ReactNode; minWidth?: number }) {
  const [wide, setWide] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(`(min-width: ${minWidth}px)`);
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [minWidth]);
  return wide ? <>{children}</> : null;
}
