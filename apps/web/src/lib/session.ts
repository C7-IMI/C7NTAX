/**
 * Session helpers shared by the API client and the auth context (PLAN-001).
 */

export const SESSION_COOKIE = "c7_sid";
export const CSRF_COOKIE = "c7_csrf";
export const CSRF_HEADER = "x-csrf-token";

export function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * Whether this client can hold a session cookie.
 *
 * The browser and the deployed single-origin build can; the desktop shell loads the UI
 * over its own `app://` protocol and cannot be relied on to persist cookies, so it keeps
 * using the bearer token. Detected rather than configured: the sign-in page asks the
 * session endpoint once, and if it answers, the cookie is real.
 */
export async function sessionCookieAvailable(): Promise<boolean> {
  try {
    const res = await fetch("/api/auth/session", { credentials: "same-origin" });
    return res.ok;
  } catch {
    return false;
  }
}
