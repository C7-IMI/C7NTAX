import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import type { SignOptions } from "jsonwebtoken";
import { Permission, ROLE_PERMISSIONS, type SystemRole } from "@C7NTAX/shared";
import { bypassTokenTtl, isBypassAccount } from "../services/testBypass";
import { clearSessionCookies, csrfTokenValid, resolveSession, sessionAuthEnabled, sessionExpiredResponse, touchSession } from "./sessionAuth";
import { looksLikeApiKey, verifyApiKey } from "../services/apiKeys";

const JWT_SECRET = process.env.JWT_SECRET || "C7NTAX-dev-secret-change-in-prod";

export interface AuthUser {
  userId: string;
  email: string;
  role: SystemRole;
  companyId: string | null;
  permissions: Permission[];
  /** Stamped into the JWT; must match the user's row to stay valid. */
  tokenVersion?: number;
}

export interface AuthRequest extends Request {
  user?: AuthUser;
  /** Set when the caller authenticated with an API key rather than a session (see services/apiKeys). */
  apiKey?: {
    id: string;
    name: string;
    prefix: string;
    sourceKind: string;
    scopes: string[];
  };
}

/** Routes a signed-in user may still reach while they owe a password change. */
const PASSWORD_CHANGE_EXEMPT = ["/api/auth/me", "/api/auth/change-password", "/api/users/me"];

/** Session state that the token itself cannot carry — read fresh on every request. */
interface SessionContext {
  tokenVersion: number;
  mustChangePassword: boolean;
}

/** Payload accepted by signToken — a subset of the fields that get packed into the JWT */
export interface SignTokenPayload {
  id: string;
  email: string;
  role: SystemRole;
  companyId?: string | null;
  permissions?: Permission[];
  firstName?: string;
  lastName?: string;
  mfaEnabled?: boolean;
  active?: boolean;
  /** The user's current tokenVersion — a mismatch retires the token. */
  tokenVersion?: number;
}

/**
 * Extract and verify the caller's identity.
 *
 * Two credentials are accepted, in this order (PLAN-001):
 *   1. the session cookie — browser clients, with a CSRF check on writes and an idle
 *      timeout that administrators are exempt from;
 *   2. `Authorization: Bearer` — everything that cannot hold a cookie (desktop app,
 *      Outlook add-in, integrations, probes).
 *
 * Both paths end in the same place: permissions refreshed from the database, and the same
 * gate for a password change that is still owed, so no route can tell them apart.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  if (sessionAuthEnabled()) {
    resolveSession(req)
      .then(async (result) => {
        if (result.status === "ok") {
          if (!csrfTokenValid(req, result.session.csrfToken)) {
            res.status(403).json({ error: { message: "CSRF token missing or invalid", code: "CSRF_FAILED" } });
            return;
          }
          await touchSession(result.session.sessionId).catch(() => { /* activity tracking must not fail a request */ });
          const identity = await sessionIdentity(result.session.userId, result.session.email);
          if (!identity) {
            sessionExpiredResponse(res, "invalid");
            return;
          }
          req.user = identity;
          return completeAuthentication(req, res, next);
        }
        if (result.status === "none") {
          // No cookie at all: a token client, or a browser before this change shipped.
          return authenticateByToken(req, res, next);
        }
        // A cookie that no longer works. If the caller also presented a token, honour it —
        // the desktop shell and the add-in keep tokens, and losing a working credential
        // because an unrelated cookie expired would be a needless sign-out.
        if (typeof req.headers.authorization === "string" && req.headers.authorization.startsWith("Bearer ")) {
          clearSessionCookies(res);
          return authenticateByToken(req, res, next);
        }
        sessionExpiredResponse(res, result.status);
      })
      .catch(() => {
        // Fail closed: if the session cannot be confirmed, the request is not served.
        res.status(401).json({ error: "Your session could not be verified — please sign in again" });
      });
    return;
  }
  authenticateByToken(req, res, next);
}

/** Builds the request identity from the database for a session holder. */
async function sessionIdentity(userId: string, email: string): Promise<AuthUser | null> {
  try {
    const { prisma } = await import("../index");
    const row = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        companyId: true,
        permissions: true,
        tokenVersion: true,
        isActive: true,
        role: { select: { systemRole: true, permissions: true } },
      },
    });
    if (!row || row.isActive === false) return null;
    return {
      userId: row.id,
      email: row.email || email,
      role: row.role.systemRole as SystemRole,
      companyId: row.companyId ?? null,
      permissions: computePermissions(
        row.role.systemRole as SystemRole,
        (row.role.permissions || []) as string[],
        (row.permissions || []) as string[],
      ),
      // Taken from the row, so the version check below compares like with like: the session
      // is the credential, and a password change invalidates sessions directly.
      tokenVersion: row.tokenVersion,
    };
  } catch {
    return null;
  }
}

/** The bearer-token path, unchanged apart from living in its own function. */
function authenticateByToken(req: AuthRequest, res: Response, next: NextFunction): void {
  // Only the Authorization header: a token in a query string ends up in browser history,
  // proxy logs and the access log, so `?token=` is no longer accepted (see PLAN-018 P0-12).
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  }

  if (!token) {
    res.status(401).json({ error: "Missing or invalid token" });
    return;
  }

  /*
   * An API key is a credential for a program, and it arrives here rather than on a route of its
   * own so that every existing route serves a machine without knowing about it: `req.user` is
   * filled with the account the key acts as, its permissions narrowed to the key's scopes. Because
   * the identity is a real user, `createdById` and the audit trail keep meaning something, and the
   * tail of this function — the token-version check, the password-change gate — applies unchanged.
   */
  if (looksLikeApiKey(token)) {
    verifyApiKey(token, req.ip || req.socket?.remoteAddress || undefined)
      .then(result => {
        if (!result) {
          res.status(401).json({
            error: { message: "That API key is not valid — it may be revoked, expired, or belong to a deactivated account", code: "API_KEY_INVALID" },
          });
          return;
        }
        const owner = result.owner;
        const ownerPermissions = computePermissions(owner.role, owner.rolePermissions, owner.userPermissions);
        // The intersection, not the union: a key can never exceed the account it acts as, and a
        // role change is felt on the next request rather than when the key was issued.
        const granted = ownerPermissions.filter(permission => result.key.permissions.includes(permission));
        req.user = {
          userId: owner.id,
          email: owner.email,
          role: owner.role,
          companyId: owner.companyId,
          permissions: granted,
          tokenVersion: owner.tokenVersion,
        };
        req.apiKey = {
          id: result.key.id,
          name: result.key.name,
          prefix: result.key.prefix,
          sourceKind: result.key.sourceKind,
          scopes: result.key.permissions,
        };
        completeAuthentication(req, res, next);
      })
      .catch(() => {
        res.status(401).json({ error: { message: "That API key could not be verified", code: "API_KEY_INVALID" } });
      });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  completeAuthentication(req, res, next);
}

/**
 * Shared tail of both paths: confirm the identity against the database against a token
 * version, then enforce the password-change gate.
 *
 * `apiKeyScopes` is passed for a key holder, and it is what keeps a key inside its scopes: the
 * permissions are refreshed from the database on every request, and without this the refresh would
 * hand a narrow key the owner's full authority on its very first call.
 */
function completeAuthentication(req: AuthRequest, res: Response, next: NextFunction): void {
  // Refresh permissions from DB to capture newly added Permission enum values,
  // and reject tokens that a password change or reset has retired.
  refreshSessionContext(req.user!, req.apiKey?.scopes)
    .then((state) => {
      if (!state.valid) {
        res.status(401).json({ error: "Your session has ended — please sign in again" });
        return;
      }
      const [path = ""] = (req.originalUrl || req.url || "").split("?");
      if (state.mustChangePassword && !PASSWORD_CHANGE_EXEMPT.includes(path) && !isBypassAccount(req.user?.email)) {
        res.status(403).json({
          error: { message: "Choose a new password before continuing", code: "PASSWORD_CHANGE_REQUIRED" },
        });
        return;
      }
      next();
    })
    .catch(() => {
      // Fail closed: if the session cannot be confirmed, the request is not served.
      res.status(401).json({ error: "Your session could not be verified — please sign in again" });
    });
}

async function refreshSessionContext(user: AuthUser, apiKeyScopes?: string[]): Promise<{ valid: boolean; mustChangePassword: boolean }> {
  let dbUser;
  try {
    const { prisma } = await import("../index");
    dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        permissions: true,
        mustChangePassword: true,
        tokenVersion: true,
        role: { select: { systemRole: true, permissions: true } },
      },
    });
  } catch {
    // A database we cannot read is a session we cannot vouch for.
    return { valid: false, mustChangePassword: false };
  }
  try {
    if (!dbUser) return { valid: false, mustChangePassword: false };

    const state: SessionContext = {
      tokenVersion: dbUser.tokenVersion,
      mustChangePassword: dbUser.mustChangePassword,
    };
    // A password change bumps the version, which retires every token issued before it.
    if ((user.tokenVersion ?? 0) !== state.tokenVersion) {
      return { valid: false, mustChangePassword: state.mustChangePassword };
    }

    const fresh = computePermissions(
      dbUser.role.systemRole as SystemRole,
      dbUser.role.permissions as string[],
      dbUser.permissions as string[]
    );
    /*
     * A key holder gets the intersection, recomputed here rather than only at verification, so a
     * scope it may no longer use — because the owner's role changed, or the intersection simply
     * differs — takes effect on the next request instead of never.
     */
    const effective = apiKeyScopes ? fresh.filter(permission => apiKeyScopes.includes(permission)) : fresh;
    // Always refresh if the DB has different permissions (not just more)
    const hasNew = effective.some(p => !user.permissions.includes(p));
    const hasLess = user.permissions.some(p => !effective.includes(p));
    if (hasNew || hasLess) {
      user.permissions = effective;
    }

    return { valid: true, mustChangePassword: state.mustChangePassword };
  } catch {
    // Anything unexpected while verifying the session is treated as unverified.
    return { valid: false, mustChangePassword: false };
  }
}

/**
 * Require one or more permissions. Must be used after authenticate.
 */
export function requirePermission(...permissions: Permission[]) {
  return (req: AuthRequest, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Not authenticated" });
      return;
    }
    const has = permissions.some((p) => req.user!.permissions.includes(p));
    if (!has) {
      res.status(403).json({ error: "Insufficient permissions" });
      return;
    }
    next();
  };
}

/**
 * Generate a JWT token from a sign-payload (prisma result or ad-hoc object).
 */
export function signToken(payload: SignTokenPayload): string {
  // The test-bypass account gets a long-lived token so manual testing is not cut
  // short by the 15-minute expiry that hardening switches on.
  const expiresIn = (isBypassAccount(payload.email)
    ? bypassTokenTtl()
    : (process.env.AUTH_HARDENING_ENABLED === "true" ? "15m" : "12h")) as SignOptions["expiresIn"];
  return jwt.sign(
    {
      userId: payload.id,
      email: payload.email,
      role: payload.role,
      companyId: payload.companyId ?? null,
      permissions: payload.permissions ?? [],
      tokenVersion: payload.tokenVersion ?? 0,
    } satisfies AuthUser,
    JWT_SECRET,
    { expiresIn }
  );
}

/**
 * Generate a short-lived MFA token (5 min) used during MFA flow.
 */
export function signMfaToken(userId: string): string {
  return jwt.sign({ userId, mfa: true }, JWT_SECRET, { expiresIn: "5m" });
}

export { JWT_SECRET };

/**
 * Compute the effective permission set for a user.
 * Merges role-based permissions with individual overrides (additive).
 */
export function computePermissions(roleSystemRole: SystemRole, rolePermissions: string[], userOverrides: string[]): Permission[] {
  const base = rolePermissions.length > 0 ? rolePermissions : (ROLE_PERMISSIONS[roleSystemRole] || []);
  const merged = new Set([...base, ...userOverrides]);
  return [...merged] as Permission[];
}
