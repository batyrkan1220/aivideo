/** Bottom-tab pages: Back (Telegram button or edge swipe) does nothing there. */
export const TAB_ROOTS = ["/", "/photos", "/create", "/orders", "/account", "/login", "/signup"];

/** Where Back goes when there is no in-app history (e.g. opened from a direct link). Null on tab roots. */
export function backTarget(path: string): string | null {
  if (TAB_ROOTS.includes(path)) return null;
  if (path.startsWith("/admin")) return null;
  if (path.startsWith("/orders/")) return "/orders";
  if (path.startsWith("/account/")) return "/account";
  if (path.startsWith("/photos/")) return "/photos";
  return "/";
}
