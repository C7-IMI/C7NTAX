import axios from "axios";

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

// Handle 401 globally — only redirect when NOT already on the login page
api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      const onLoginPage = window.location.pathname === "/login";
      // Don't nuke the token on login page — it's expected that login may 401
      if (!onLoginPage) {
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
