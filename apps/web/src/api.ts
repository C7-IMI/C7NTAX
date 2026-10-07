import axios from "axios";
import toast from "react-hot-toast";

/**
 * Authenticated Axios instance.
 * Automatically attaches JWT and handles 401 refresh/redirect.
 */
const api = axios.create({
  baseURL: "/api",
  headers: { "Content-Type": "application/json" },
});

// Attach token on every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("c7_token");
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

// Handle 403 globally — the API enforces a permission per module, so a denied *action*
// should explain itself. Background reads are left silent: pages already decide how to
// degrade, and a toast per denied panel would be noise.
let lastDeniedAt = 0;
api.interceptors.response.use(
  (res) => res,
  (err) => {
    const status = err.response?.status;
    const method = String(err.config?.method || "get").toLowerCase();
    if (status === 403 && method !== "get") {
      const body = err.response?.data?.error;
      const code = typeof body === "object" ? body?.code : undefined;
      if (code !== "PASSWORD_CHANGE_REQUIRED" && Date.now() - lastDeniedAt > 3000) {
        lastDeniedAt = Date.now();
        toast.error(typeof body === "string" ? body : body?.message || "Your role does not allow that");
      }
    }
    if (status === 401) {
      const onLoginPage = window.location.pathname === "/login";
      const bypass = localStorage.getItem("c7_bypass") === "1";
      if (!onLoginPage && !bypass) {
        localStorage.removeItem("c7_token");
        localStorage.removeItem("c7_user");
        // Use replace to avoid back-button loops
        window.location.replace("/login");
      }
    }
    return Promise.reject(err);
  }
);

export default api;
