import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import api from "../api";

// ── Temporary auth bypass — set to false to re-enable login ──
const TEMP_BYPASS_AUTH = false;

interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string;
  companyId?: string;
  mfaEnabled?: boolean;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface LandingPage { path: string; label: string; }

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  landingPage: LandingPage;
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string; landingPage?: LandingPage }>;
  loginMfa: (mfaToken: string, code: string) => Promise<LandingPage | undefined>;
  logout: () => void;
  setLandingPage: (lp: LandingPage) => void;
}

const AuthContext = createContext<AuthState>(null!);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setToken] = useState<string | null>(() => localStorage.getItem("c7_token"));
  const [loading, setLoading] = useState(true);
  const [landingPage, setLandingPage] = useState<LandingPage>({ path: "/", label: "Dashboard" });

  useEffect(() => {
    // ── Temporary bypass: auto-login with admin credentials ──
    // Revert: delete this block and set TEMP_BYPASS_AUTH = false
    if (TEMP_BYPASS_AUTH) {
      localStorage.setItem("c7_bypass", "1");
      // Auto-login to get a real JWT token so API calls work
      const existingToken = localStorage.getItem("c7_token");
      if (!existingToken) {
        api.post("/auth/login", { username: "admin", password: "admin" })
          .then((res) => {
            if (res.data.token) {
              localStorage.setItem("c7_token", res.data.token);
              setToken(res.data.token);
              if (res.data.user) setUser(res.data.user);
            } else {
              setUser({ id: "bypass", email: "bypass@local", firstName: "Guest", lastName: "User", role: "admin" });
            }
          })
          .catch(() => {
            setUser({ id: "bypass", email: "bypass@local", firstName: "Guest", lastName: "User", role: "admin" });
          })
          .finally(() => setLoading(false));
        return;
      }
      // Token already exists — don't overwrite the user
      if (!user) {
        setUser({ id: "bypass", email: "bypass@local", firstName: "Guest", lastName: "User", role: "admin" });
      }
      setLoading(false);
      return;
    }

    let cancelled = false;
    // Bypass auth for quick dashboard access
    if (localStorage.getItem("c7_bypass") === "1") {
      setUser({ id: "bypass", email: "bypass@local", firstName: "Guest", lastName: "User", role: "admin" });
      setLoading(false);
      return;
    }
    if (token) {
      api.get("/users/me")
        .then((res) => { if (!cancelled) setUser(res.data); })
        .catch(() => {
          if (!cancelled) { localStorage.removeItem("c7_token"); localStorage.removeItem("c7_user"); setToken(null); }
        })
        .finally(() => { if (!cancelled) setLoading(false); });
    } else {
      setLoading(false);
    }
    return () => { cancelled = true; };
  }, [token]);

  const login = useCallback(async (loginId: string, password: string) => {
    // Detect email vs username: if contains '@', send as email, else as username
    const body = loginId.includes("@") ? { email: loginId, password } : { username: loginId, password };
    const res = await api.post("/auth/login", body);
    if (res.data.mfaRequired) {
      return { mfaRequired: true as const, mfaToken: res.data.mfaToken as string };
    }
    localStorage.setItem("c7_token", res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    if (res.data.landingPage) {
      setLandingPage(res.data.landingPage);
      localStorage.setItem("c7_landing", JSON.stringify(res.data.landingPage));
    }
    return { landingPage: res.data.landingPage || landingPage };
  }, [landingPage]);

  const loginMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await api.post("/auth/verify-mfa", { token: mfaToken, code });
    localStorage.setItem("c7_token", res.data.token);
    setToken(res.data.token);
    setUser(res.data.user);
    if (res.data.landingPage) {
      setLandingPage(res.data.landingPage);
      localStorage.setItem("c7_landing", JSON.stringify(res.data.landingPage));
    }
    return res.data.landingPage as LandingPage | undefined;
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem("c7_token");
    localStorage.removeItem("c7_user");
    localStorage.removeItem("c7_landing");
    localStorage.removeItem("c7_bypass");
    setToken(null);
    setUser(null);
    // Force navigation to login — avoids race conditions with React batched state
    window.location.replace("/login");
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, loading, landingPage, login, loginMfa, logout, setLandingPage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
