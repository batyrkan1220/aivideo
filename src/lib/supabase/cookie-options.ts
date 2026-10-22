/**
 * Session cookie options. In production cookies are `SameSite=None; Secure` so the session also
 * works when Telegram Web/Desktop embeds the Mini App in a frame (Lax cookies are not sent there).
 * Server Actions still verify the Origin header, so this does not open CSRF on mutations.
 */
export const sessionCookieOptions =
  process.env.NODE_ENV === "production"
    ? ({ sameSite: "none", secure: true, path: "/" } as const)
    : ({ sameSite: "lax", secure: false, path: "/" } as const);
