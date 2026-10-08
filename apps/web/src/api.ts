import axios from "axios";
import toast from "react-hot-toast";
import { CSRF_COOKIE, CSRF_HEADER, readCookie } from "./lib/session";

/**
 * Authenticated Axios instance.
 *
 * Two credentials can be in play (PLAN-001):
 *   · the session cookie, which the browser attaches on its own — nothing to send, but a
 *     write that rides on a cookie must echo the CSRF token back in a header;
 *   · the bearer token, kept in memory for the tab and written to storage only when the
 *     cookie path is unavailable (the desktop shell, the Outlook add-in, scripts).
 */
const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

/** In-memory token: an XSS payload cannot read it the way it can read localStorage. */
let memoryToken: string | null = null;

export function setAuthToken(token: string | null): void {
  memoryToken = token;
}

export function getAuthToken(): string | null {
  return memoryToken ?? localStorage.getItem("c7_token");
}

// Attach the credentials on every request.
api.interceptors.request.use((config) => {
  const token = getAuthToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  const method = String(config.method || "get").toLowerCase();
  if (method !== "get" && method !== "head" && method !== "options") {
    const csrf = readCookie(CSRF_COOKIE);
    if (csrf) config.headers[CSRF_HEADER] = csrf;
  }
  return config;
});

// Handle 403 globally — the API enforces a permission per module, so a denied *action*
// should explain itself. Background reads are left silent: pages already decide how to
// degrade, and a toast per denied panel would be noise.
let lastDeniedAt = 0;
api.interceptors.response.use(
  (res) => {
    /*
     * A write that succeeded is a change worth showing in the header's Recent menu, and this is the
     * one place every write in the application passes through — so the menu does not have to be wired
     * into 200 call sites, and a screen added tomorrow gets the behaviour by existing. The audit row
     * is written when the response finishes on the server, which is why the re-read is deferred.
     */
    const method = String(res.config?.method || "get").toLowerCase();
    if (method !== "get" && method !== "head" && method !== "options") {
      void import("./hooks/useRecentActivity").then((module) =>
        module.refreshRecentActivity(),
      );
    }
    return res;
  },
  (err) => {
    const status = err.response?.status;
    const method = String(err.config?.method || "get").toLowerCase();
    const body = err.response?.data?.error;
    const code = typeof body === "object" ? body?.code : undefined;

    if (status === 403 && method !== "get") {
      if (code === "CSRF_FAILED") {
        toast.error(
          "That action could not be verified — reload the page and try again",
        );
      } else if (
        code !== "PASSWORD_CHANGE_REQUIRED" &&
        Date.now() - lastDeniedAt > 3000
      ) {
        lastDeniedAt = Date.now();
        toast.error(
          typeof body === "string"
            ? body
            : body?.message || "Your role does not allow that",
        );
      }
    }

    // 440 is this API's "your session went idle" answer; 401 means it ended some other way
    // (signed out elsewhere, password changed, account deactivated). Both mean: sign in again.
    if (status === 401 || status === 440) {
      const onLoginPage = window.location.pathname === "/login";
      const bypass = localStorage.getItem("c7_bypass") === "1";
      setAuthToken(null);
      if (!onLoginPage && !bypass) {
        localStorage.removeItem("c7_token");
        localStorage.removeItem("c7_user");
        const reason = code === "SESSION_TIMEOUT" ? "timeout" : "expired";
        // Use replace to avoid back-button loops
        window.location.replace(`/login?reason=${reason}`);
      }
    }
    return Promise.reject(err);
  },
);

export default api;
