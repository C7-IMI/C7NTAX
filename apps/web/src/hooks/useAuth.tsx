import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  useRef,
  type Context,
  type ReactNode,
} from "react";
import api, { setAuthToken } from "../api";
import { sessionCookieAvailable } from "../lib/session";
import { ROLE_PERMISSIONS, type MfaMethodId, type SystemRole } from "@C7NTAX/shared";
import { clearRecentActivityCache } from "./useRecentActivity";
import type { MfaPolicyView } from "../lib/mfa";

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
  /**
   * What this account has to do about a second factor, straight from the API.
   *
   * Held here rather than recomputed because the gate, the reminder banner, the wizard and the
   * sign-in redirect all have to describe the same deadline — and the decision behind it is the
   * server's (`services/mfaPolicy.ts`). Null until the server has said; a client that has not been
   * told must not guess, since guessing "required" would hold a person behind a gate the deployment
   * does not have.
   */
  mfaPolicy: MfaPolicyView | null;
  /** Re-read it from the API, including the catalogue the wizard needs. */
  refreshMfaPolicy: () => Promise<MfaPolicyView | null>;
  login: (
    email: string,
    password: string,
  ) => Promise<{
    mfaRequired?: boolean;
    mfaToken?: string;
    /** Which method the challenge is for, so the page does not show the wrong field. */
    mfaMethod?: MfaMethodId;
    /** Days a proved browser may skip the second factor; 0 means the deployment does not remember. */
    rememberDays?: number;
    landingPage?: LandingPage;
    mustChangePassword?: boolean;
  }>;
  loginMfa: (
    mfaToken: string,
    code: string,
    options?: { remember?: boolean },
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

/**
 * One context object per tab, rather than one per evaluation of this module.
 *
 * `createContext` returns a **new** object every time the module runs, and in development the module runs
 * again every time this file is edited: the provider already mounted in the tree still belongs to the
 * previous copy while a re-rendered consumer resolves the import to the new one. A consumer holding a
 * context nothing provides reads the default — which was `null!` — and the first thing every caller does
 * with it is destructure, so the failure arrives as *"Cannot destructure property 'user' of
 * 'useAuth(...)' as it is null"*: a blank screen, and a message that names the caller's local variable
 * instead of the mistake. Reusing the tab's existing context closes that window, and the effect on a real
 * deployment is nothing at all, since there this module is evaluated once.
 *
 * The same guard covers the other way a second context appears: two copies of this file in one bundle
 * (a duplicate dependency, or a specifier that resolves twice). Both copies then agree on the object.
 */
const AuthContext = ((): Context<AuthState | null> => {
  const tab = globalThis as typeof globalThis & { __c7AuthContext?: Context<AuthState | null> };
  return (tab.__c7AuthContext ??= createContext<AuthState | null>(null));
})();

const DEFAULT_SESSION: SessionInfo = { cookieMode: false, timeoutMinutes: 30 };

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(() =>
    localStorage.getItem("c7_token"),
  );
  const [loading, setLoading] = useState(true);
  const [landingPage, setLandingPage] = useState<LandingPage>({
    path: "/",
    label: "Today",
  });
  const [session, setSession] = useState<SessionInfo>(DEFAULT_SESSION);
  const cookieModeRef = useRef(false);

  /*
   * The second-factor policy, and the two ways it arrives.
   *
   * Every sign-in response carries it, so the gate can be decided from the response that signed the
   * person in rather than from a request that follows it; `refreshMfaPolicy` re-reads it from the one
   * endpoint designed to describe it, which is also the only one that carries the method catalogue.
   * The bootstrap below asks for it because a page load with an existing session has no sign-in
   * response to read it from.
   */
  const [mfaPolicy, setMfaPolicyState] = useState<MfaPolicyView | null>(null);
  const refreshMfaPolicy = useCallback(async () => {
    try {
      const res = await api.get("/auth/mfa/policy");
      const next = res.data as MfaPolicyView;
      setMfaPolicyState(next);
      return next;
    } catch {
      // Left as it was: an unreachable API is not news that the requirement has been lifted, and
      // clearing the policy would open the gate on a failure rather than on an answer.
      return null;
    }
  }, []);

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
    // The policy describes an account, so it goes the same way the account does.
    setMfaPolicyState(null);
    setSession(DEFAULT_SESSION);
  }, [adoptToken]);

  // Bootstrap: prefer the session cookie, fall back to a stored token (desktop shell,
  // Outlook add-in), and only then show the sign-in page.
  useEffect(() => {
    let cancelled = false;
    const stored = localStorage.getItem("c7_token");

    /*
     * The account's second-factor policy, read for a page that was already signed in.
     *
     * `/auth/me` is asked rather than `/auth/mfa/policy` because it is exempt from the enrolment gate
     * and answers with the policy attached — so a person stopped by the gate learns what they owe from
     * the same request that tells the application who they are, and the wizard then asks the fuller
     * endpoint for the catalogue. A failure is left silent and the policy stays unset: "not told" must
     * not collapse into "not required".
     */
    const readMfaPolicy = () =>
      api
        .get("/auth/me")
        .then((res) => {
          if (!cancelled) setMfaPolicyState((res.data?.mfaPolicy as MfaPolicyView) ?? null);
        })
        .catch(() => {
          /* Nothing to say: the sign-in response carries the same answer next time. */
        });

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
          void readMfaPolicy();
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
          void readMfaPolicy();
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
        /*
         * The challenge travels with what it needs to be answered: which method it is for (so an
         * emailed-code account is not shown an authenticator field), and how long a browser may be
         * remembered (0 meaning the deployment does not remember any, in which case the page must not
         * offer the control). `mfaPolicy` is not on this response — the sign-in has not happened, so
         * there is no session to hold a policy about.
         */
        return {
          mfaRequired: true as const,
          mfaToken: res.data.mfaToken as string,
          mfaMethod: (res.data.mfaMethod as MfaMethodId | undefined) ?? "totp",
          rememberDays: Number(res.data.rememberDays ?? 0),
        };
      }
      await settleCredentials(res.data.token);
      setUser({
        ...res.data.user,
        mustChangePassword: !!res.data.mustChangePassword,
      });
      // Carried on the sign-in response, so the gate is decided from the answer that signed the
      // person in rather than from a request that follows it.
      setMfaPolicyState((res.data.mfaPolicy as MfaPolicyView) ?? null);
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
    async (mfaToken: string, code: string, options?: { remember?: boolean }) => {
      /*
       * `remember` is passed through exactly as asked — sent as `false` to clear the box, and omitted
       * when no preference was expressed. The API treats anything but `false` as "remember", so a
       * client that always sent a value would be overruling the deployment's own default rather than
       * answering the question the control asks.
       */
      const res = await api.post("/auth/mfa/verify", {
        mfaToken,
        code,
        ...(options?.remember === undefined ? {} : { remember: options.remember }),
      });
      await settleCredentials(res.data.token);
      setUser({
        ...res.data.user,
        mustChangePassword: !!res.data.mustChangePassword,
      });
      setServerPermissions(Array.isArray(res.data.permissions) ? res.data.permissions : null);
      setMfaPolicyState((res.data.mfaPolicy as MfaPolicyView) ?? null);
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
      // The token arrived from somewhere else (an SSO redirect, a passkey prompt), so `/users/me` is
      // the only thing that has been read; the policy has to be asked for separately.
      void refreshMfaPolicy();
      setLoading(false);
      return res.data as User;
    },
    [settleCredentials, refreshMfaPolicy],
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
        mfaPolicy,
        refreshMfaPolicy,
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

/**
 * The signed-in state, from anywhere inside `<AuthProvider>`.
 *
 * A missing context is a mistake in the tree — a consumer rendered outside the provider — rather than a
 * state the application can be in, so it says which mistake it is instead of handing back `null` for the
 * caller to trip over.
 */
export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error("useAuth() was called outside <AuthProvider>");
  return context;
}
