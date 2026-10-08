import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type ReactNode,
} from "react";
import api, { setAuthToken } from "../api";
import { sessionCookieAvailable } from "../lib/session";
import { ROLE_PERMISSIONS, type SystemRole } from "@C7NTAX/shared";
import { clearRecentActivityCache } from "./useRecentActivity";

interface User {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  role?:
    | string
    | {
        id?: string;
        name?: string;
        systemRole?: string;
        permissions?: string[];
      };
  /** Individual permission overrides on top of the role. */
  permissions?: string[];
  companyId?: string;
  mfaEnabled?: boolean;
  /** Set after an administrator resets the password; cleared once changed. */
  mustChangePassword?: boolean;
  active?: boolean;
  createdAt?: string;
  updatedAt?: string;
}

interface LandingPage {
  path: string;
  label: string;
}

/** What the idle-timeout warning needs, straight from the API (PLAN-001 §3.2). */
export interface SessionInfo {
  /** Cookie sessions can expire from inactivity; token clients cannot. */
  cookieMode: boolean;
  timeoutMinutes: number;
}

interface AuthState {
  user: User | null;
  token: string | null;
  loading: boolean;
  landingPage: LandingPage;
  session: SessionInfo;
  /** Effective permissions (role + overrides), for hiding controls the API will refuse. */
  permissions: string[];
  login: (
    email: string,
    password: string,
  ) => Promise<{
    mfaRequired?: boolean;
    mfaToken?: string;
    landingPage?: LandingPage;
    mustChangePassword?: boolean;
  }>;
  loginMfa: (
    mfaToken: string,
    code: string,
  ) => Promise<LandingPage | undefined>;
  /** Finish a sign-in that produced a token elsewhere, and load the profile. */
  completeSignIn: (token: string) => Promise<User>;
  /** Swap in the token issued by a password change and clear the pending flag. */
  markPasswordChanged: (token: string) => void;
  logout: () => void;
  /** "Stay logged in" on the timeout modal: resets the server's idle clock. */
  extendSession: () => Promise<boolean>;
  setLandingPage: (lp: LandingPage) => void;
}

const AuthContext = createContext<AuthState>(null!);

const DEFAULT_SESSION: SessionInfo = { cookieMode: false, timeoutMinutes: 30 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem("c7_token"),
  );
  const [loading, setLoading] = useState(true);
  const [landingPage, setLandingPage] = useState<LandingPage>({
    path: "/",
    label: "Dashboard",
  });
  const [session, setSession] = useState<SessionInfo>(DEFAULT_SESSION);
  const cookieModeRef = useRef(false);

  /** Keep the tab's token in memory; only persist it when the cookie cannot be used. */
  const adoptToken = useCallback(
    (nextToken: string | null, persist: boolean) => {
      setAuthToken(nextToken);
      setTokenState(nextToken);
      if (nextToken && persist) localStorage.setItem("c7_token", nextToken);
      if (!persist) localStorage.removeItem("c7_token");
    },
    [],
  );

  const clearCredentials = useCallback(() => {
    adoptToken(null, false);
    localStorage.removeItem("c7_user");
    localStorage.removeItem("c7_landing");
    localStorage.removeItem("c7_bypass");
    setUser(null);
    // A stale permission list must not outlive the session it described: the next person to sign in on
    // this browser would otherwise draw their interface from the previous one's answer.
    setServerPermissions(null);
    setSession(DEFAULT_SESSION);
  }, [adoptToken]);

  // Bootstrap: prefer the session cookie, fall back to a stored token (desktop shell,
  // Outlook add-in), and only then show the sign-in page.
  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem("c7_token");

    const fromCookie = () =>
      api
        .get("/auth/session")
        .then((res) => {
          if (cancelled) return;
          cookieModeRef.current = true;
          setAuthToken(null);
          localStorage.removeItem("c7_token");
          setTokenState(null);
          setUser(res.data.user);
          setServerPermissions(Array.isArray(res.data.permissions) ? res.data.permissions : null);
          setSession({
            cookieMode: true,
            timeoutMinutes: res.data.timeoutMinutes ?? 30,
          });
        })
        .catch(() => {
          if (!cancelled) setUser(null);
        });

    const fromToken = (value: string) => {
      setAuthToken(value);
      return api
        .get("/users/me")
        .then((res) => {
          if (!cancelled) setUser(res.data);
        })
        .catch(() => {
          if (!cancelled) {
            adoptToken(null, false);
          }
        });
    };

    // A stale bypass flag left in storage would suppress the 401 redirect.
    if (localStorage.getItem("c7_bypass") === "1")
      localStorage.removeItem("c7_bypass");

    const run = stored ? fromToken(stored).then(() => undefined) : fromCookie();
    run.finally(() => {
      if (!cancelled) setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [adoptToken]);

  /** After a sign-in, decide which credential this client will live on. */
  const settleCredentials = useCallback(
    async (issuedToken: string) => {
      setAuthToken(issuedToken);
      const cookieWorks = await sessionCookieAvailable();
      cookieModeRef.current = cookieWorks;
      adoptToken(issuedToken, !cookieWorks);
      if (cookieWorks) {
        const res = await api.get("/auth/session").catch(() => null);
        setSession({
          cookieMode: true,
          timeoutMinutes: res?.data?.timeoutMinutes ?? 30,
        });
      } else {
        setSession({ cookieMode: false, timeoutMinutes: 30 });
      }
    },
    [adoptToken],
  );

  const login = useCallback(
    async (loginId: string, password: string) => {
      // Detect email vs username: if contains '@', send as email, else as username
      const body = loginId.includes("@")
        ? { email: loginId, password }
        : { username: loginId, password };
      const res = await api.post("/auth/login", body);
      if (res.data.mfaRequired) {
        return {
          mfaRequired: true as const,
          mfaToken: res.data.mfaToken as string,
        };
      }
      await settleCredentials(res.data.token);
      setUser({
        ...res.data.user,
        mustChangePassword: !!res.data.mustChangePassword,
      });
      // `settleCredentials` re-reads `/auth/session` for cookie clients, which sets these too; a token
      // client (desktop shell, add-in) has only this response, so it is set here as well.
      setServerPermissions(Array.isArray(res.data.permissions) ? res.data.permissions : null);
      if (res.data.landingPage) {
        setLandingPage(res.data.landingPage);
        localStorage.setItem(
          "c7_landing",
          JSON.stringify(res.data.landingPage),
        );
      }
      return {
        landingPage: res.data.landingPage || landingPage,
        mustChangePassword: !!res.data.mustChangePassword,
      };
    },
    [landingPage, settleCredentials],
  );

  const loginMfa = useCallback(
    async (mfaToken: string, code: string) => {
      const res = await api.post("/auth/mfa/verify", { mfaToken, code });
      await settleCredentials(res.data.token);
      setUser({
        ...res.data.user,
        mustChangePassword: !!res.data.mustChangePassword,
      });
      setServerPermissions(Array.isArray(res.data.permissions) ? res.data.permissions : null);
      if (res.data.landingPage) {
        setLandingPage(res.data.landingPage);
        localStorage.setItem(
          "c7_landing",
          JSON.stringify(res.data.landingPage),
        );
      }
      return res.data.landingPage as LandingPage | undefined;
    },
    [settleCredentials],
  );

  /** Adopt a token produced outside the password form (SSO redirect, passkey). */
  const completeSignIn = useCallback(
    async (nextToken: string) => {
      await settleCredentials(nextToken);
      const res = await api.get("/users/me");
      setUser(res.data);
      setLoading(false);
      return res.data as User;
    },
    [settleCredentials],
  );

  const markPasswordChanged = useCallback(
    (nextToken: string) => {
      adoptToken(nextToken, !cookieModeRef.current);
      setUser((u) => (u ? { ...u, mustChangePassword: false } : u));
    },
    [adoptToken],
  );

  /**
   * The permissions the **server** says this session holds, or null when it has not said.
   *
   * Preferred over anything computed here, and the reason is a defect waiting to happen rather than a
   * style preference: the effective set is role + individual grants − individual removals − whatever a
   * client's own switch takes away, and only the server knows the last two. A client-side union of the
   * role's list with the user's overrides silently *reinstates* a permission that was revoked, which is
   * how a control the API refuses stays visible in the interface.
   */
  const [serverPermissions, setServerPermissions] = useState<string[] | null>(null);

  // The API enforces permissions; this mirror is only so the UI can hide controls
  // it knows will be refused (role and permission editing, for instance).
  const permissions = useMemo(() => {
    if (serverPermissions) return serverPermissions;
    // A session that has not told us what it holds is an older payload or a client that was offline when
    // it loaded; the local union is what this did before, kept as the fallback rather than as the rule.
    const role = user?.role;
    const systemRole = typeof role === "string" ? role : role?.systemRole;
    const rolePerms: string[] =
      typeof role === "object" && role?.permissions?.length
        ? role.permissions
        : (ROLE_PERMISSIONS[systemRole as SystemRole] ?? []);
    return [...new Set([...rolePerms, ...(user?.permissions ?? [])])];
  }, [serverPermissions, user]);

  const logout = useCallback(() => {
    // End it server-side first: a cookie the browser keeps would otherwise stay valid.
    void api.post("/auth/logout").catch(() => {
      /* signing out locally still works */
    });
    clearCredentials();
    // One person's recent activity must not be visible at the next person's first paint.
    clearRecentActivityCache();
    // Force navigation to login — avoids race conditions with React batched state
    window.location.replace("/login");
  }, [clearCredentials]);

  const extendSession = useCallback(async () => {
    if (!cookieModeRef.current) return true; // a token client has no idle clock to reset
    try {
      await api.post("/auth/session/extend");
      return true;
    } catch {
      return false;
    }
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        landingPage,
        session,
        permissions,
        login,
        loginMfa,
        completeSignIn,
        markPasswordChanged,
        logout,
        extendSession,
        setLandingPage,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
