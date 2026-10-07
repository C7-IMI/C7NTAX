import axios from "axios";

/**
 * The customer portal's own API client (PLAN-013 #3).
 *
 * Deliberately separate from `api.ts`: this is not a staff session. It carries the portal's
 * CSRF cookie rather than the staff one, and a 401 must return the customer to the portal's
 * own sign-in screen — not redirect the whole tab to `/login`, which is where a staff
 * interceptor would send them.
 */
const PORTAL_CSRF_COOKIE = "c7_portal_csrf";
const PORTAL_CSRF_HEADER = "x-portal-csrf";
const TOKEN_KEY = "c7_portal_token";

const portalApi = axios.create({ baseURL: "/api/portal", headers: { "Content-Type": "application/json" } });

/**
 * Kept in memory for the tab, and in session storage only as a fallback for shells that cannot
 * hold the cookie (the desktop wrapper). Cleared on sign-out either way.
 */
let memoryToken: string | null = null;

export function setPortalToken(token: string | null): void {
  memoryToken = token;
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch { /* storage can be unavailable; the cookie is the primary credential */ }
}

export function getPortalToken(): string | null {
  if (memoryToken) return memoryToken;
  try { return sessionStorage.getItem(TOKEN_KEY); } catch { return null; }
}

function readCookie(name: string): string | null {
  for (const part of document.cookie.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

portalApi.interceptors.request.use((config) => {
  const token = getPortalToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get" && method !== "head" && method !== "options") {
    const csrf = readCookie(PORTAL_CSRF_COOKIE);
    if (csrf) config.headers[PORTAL_CSRF_HEADER] = csrf;
  }
  return config;
});

/** The API's own message, whichever of the two error shapes it used. */
export function portalErrorMessage(err: unknown, fallback: string): string {
  const error = (err as { response?: { data?: { error?: unknown } } })?.response?.data?.error;
  if (typeof error === "string" && error) return error;
  const message = (error as { message?: unknown } | undefined)?.message;
  return typeof message === "string" && message ? message : fallback;
}

export default portalApi;
