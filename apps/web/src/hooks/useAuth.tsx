import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import api from "../api";

interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?: string;
  companyId?: string;
  mfaEnabled?: boolean;
  /** Set after an administrator resets the password; cleared once changed. */
  mustChangePassword?: boolean;
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
  login: (email: string, password: string) => Promise<{ mfaRequired?: boolean; mfaToken?: string; landingPage?: LandingPage; mustChangePassword?: boolean }>;
  loginMfa: (mfaToken: string, code: string) => Promise<LandingPage | undefined>;
  /** Finish a sign-in that produced a token elsewhere, and load the profile. */
  completeSignIn: (token: string) => Promise<User>;
  /** Swap in the token issued by a password change and clear the pending flag. */
  markPasswordChanged: (token: string) => void;
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
    let cancelled = false;
    // TEMP_BYPASS_AUTH reverted: clear any stale bypass flag left in storage
    // so the global 401 handler can redirect to /login and a real session
    // is required.
    if (localStorage.getItem("c7_bypass") === "1") {
      localStorage.removeItem("c7_bypass");
    }
    if (token) {
      api.get("/users/me")
        .then((res) => { if (!cancelled) setUser(res.data); })        .catch(() => {
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
    setUser({ ...res.data.user, mustChangePassword: !!res.data.mustChangePassword });
    if (res.data.landingPage) {
      setLandingPage(res.data.landingPage);
      localStorage.setItem("c7_landing", JSON.stringify(res.data.landingPage));
    }
    return { landingPage: res.data.landingPage || landingPage, mustChangePassword: !!res.data.mustChangePassword };
  }, [landingPage]);

  const loginMfa = useCallback(async (mfaToken: string, code: string) => {
    const res = await api.post("/auth/mfa/verify", { mfaToken, code });
    localStorage.setItem("c7_token", res.data.token);
    setToken(res.data.token);
    setUser({ ...res.data.user, mustChangePassword: !!res.data.mustChangePassword });
    if (res.data.landingPage) {
      setLandingPage(res.data.landingPage);
      localStorage.setItem("c7_landing", JSON.stringify(res.data.landingPage));
    }
    return res.data.landingPage as LandingPage | undefined;
  }, []);

  /** Adopt a token produced outside the password form (SSO redirect, passkey). */
  const completeSignIn = useCallback(async (nextToken: string) => {
    localStorage.setItem("c7_token", nextToken);
    const res = await api.get("/users/me");
    setToken(nextToken);
    setUser(res.data);
    setLoading(false);
    return res.data as User;
  }, []);

  const markPasswordChanged = useCallback((nextToken: string) => {
    localStorage.setItem("c7_token", nextToken);
    setToken(nextToken);
    setUser(u => (u ? { ...u, mustChangePassword: false } : u));
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
    <AuthContext.Provider value={{ user, token, loading, landingPage, login, loginMfa, completeSignIn, markPasswordChanged, logout, setLandingPage }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
