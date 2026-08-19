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
}

export interface AuthRequest extends Request {
  user?: AuthUser;
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
}

/**
 * Extract and verify JWT from Authorization header.
 * Attaches user context to request.
 * Also refreshes permissions from the database to catch newly added permissions.
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
    // Refresh permissions from DB to capture newly added Permission enum values
    refreshPermissionsFromDB(req.user).then(() => next()).catch(() => next());
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
  }
}

async function refreshPermissionsFromDB(user: AuthUser): Promise<void> {
  try {
    const { prisma } = await import("../index");
    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { permissions: true, role: { select: { systemRole: true, permissions: true } } },
    });
    if (dbUser) {
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
    }
  } catch {
    // Silently use JWT permissions if DB is unreachable
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
