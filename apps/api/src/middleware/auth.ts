import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { Permission, ROLE_PERMISSIONS, type SystemRole } from "@C7NTAX/shared";

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
 * Extract and verify JWT from Authorization header.
 * Attaches user context to request.
 * Also refreshes permissions from the database to catch newly added permissions,
 * and rejects tokens that predate the user's last password change so a reset or
 * a deactivation takes effect immediately instead of when the token expires.
 */
export function authenticate(req: AuthRequest, res: Response, next: NextFunction): void {
  let token: string | undefined;
  const header = req.headers.authorization;
  if (header?.startsWith("Bearer ")) {
    token = header.slice(7);
  } else if (req.query.token && typeof req.query.token === "string") {
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: "Missing or invalid token" });
    return;
  }

  try {
    const payload = jwt.verify(token, JWT_SECRET) as AuthUser;
    req.user = payload;
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }

  // Refresh permissions from DB to capture newly added Permission enum values,
  // and reject tokens that a password change or reset has retired.
  refreshSessionContext(req.user)
    .then((state) => {
      if (!state.valid) {
        res.status(401).json({ error: "Your session has ended — please sign in again" });
        return;
      }
      const [path = ""] = (req.originalUrl || req.url || "").split("?");
      if (state.mustChangePassword && !PASSWORD_CHANGE_EXEMPT.includes(path)) {
        res.status(403).json({
          error: { message: "Choose a new password before continuing", code: "PASSWORD_CHANGE_REQUIRED" },
        });
        return;
      }
      next();
    })
    .catch(() => next());
}

async function refreshSessionContext(user: AuthUser): Promise<{ valid: boolean; mustChangePassword: boolean }> {
  try {
    const { prisma } = await import("../index");
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: {
        permissions: true,
        mustChangePassword: true,
        tokenVersion: true,
        role: { select: { systemRole: true, permissions: true } },
      },
    });
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
    // Always refresh if the DB has different permissions (not just more)
    const hasNew = fresh.some(p => !user.permissions.includes(p));
    const hasLess = user.permissions.some(p => !fresh.includes(p));
    if (hasNew || hasLess) {
      user.permissions = fresh;
    }

    return { valid: true, mustChangePassword: state.mustChangePassword };
  } catch {
    // Silently use JWT permissions if DB is unreachable
    return { valid: true, mustChangePassword: false };
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
    { expiresIn: process.env.AUTH_HARDENING_ENABLED === "true" ? "15m" : "12h" }
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
