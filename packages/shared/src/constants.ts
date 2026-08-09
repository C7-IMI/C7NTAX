// ─── Shared runtime constants — single source of truth ──────────────────
// Import this module wherever a port or service URL is needed.
// Changing a value here updates it across the entire monorepo.

/** Web dev-server port (Vite). Also used by the desktop wrapper and API CORS. */
export const WEB_PORT = 3010;

/** API server port (Express). */
export const API_PORT = 4000;

/** Full origin string for the web dev server. */
export const WEB_ORIGIN = `http://localhost:${WEB_PORT}`;

/** Full origin string for the API server. */
export const API_ORIGIN = `http://localhost:${API_PORT}`;
