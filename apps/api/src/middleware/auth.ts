import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "../index";
import { Permission, type User } from "@C7NTAX/shared";

const JWT_SECRET = process.env.JWT_SECRET || "C7NTAX-dev-secret-change-in-prod";

export interface AuthUser {
  userId: string;
  email: string;
  role: string;
  companyId: string | null;
  permissions: Permission[];
}

export interface AuthRequest extends Request {
  user?: AuthUser;
}

/**
 * Extract and verify JWT from Authorization header.
 * Attaches user context to request.
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
    next();
  } catch {
    res.status(401).json({ error: "Invalid or expired token" });
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
 * Generate a JWT token for a user.
 */
export function signToken(user: User): string {
  return jwt.sign(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      companyId: user.companyId,
      permissions: user.permissions,
    } satisfies AuthUser,
    JWT_SECRET,
    { expiresIn: "12h" }
  );
}

/**
 * Generate a short-lived MFA token (5 min) used during MFA flow.
 */
export function signMfaToken(userId: string): string {
  return jwt.sign({ userId, mfa: true }, JWT_SECRET, { expiresIn: "5m" });
}

export { JWT_SECRET };
