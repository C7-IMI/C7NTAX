/**
 * Session Authentication Middleware
 * Implements session-based auth with sliding expiration and inactivity timeout.
 * Admin accounts bypass timeout per Autotask/ConnectWise/HaloPSA standards.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../index";

const SESSION_COOKIE = "c7_sid";
const ADMIN_TIMEOUT_BYPASS = true; // Admin + Super Admin sessions never expire per PSA standard

/** Read session timeout from SystemConfig, fallback to 30 minutes */
async function getSessionTimeoutMs(): Promise<number> {
  try {
    const cfg = await prisma.systemConfig.findUnique({ where: { key: "session_timeout" } });
    if (cfg?.value) {
      const val = JSON.parse(cfg.value as string);
      if (typeof val === "number" && val >= 5 && val <= 480) return val * 60 * 1000;
    }
  } catch {}
  return 30 * 60 * 1000; // default 30 min
}

export interface SessionUser {
  userId: string;
  email: string;
  role: string;
  companyId: string | null;
  permissions: string[];
}

export interface SessionRequest extends Request {
  user?: SessionUser;
  sessionId?: string;
}

/**
 * Load user permissions from database (role + individual overrides).
 */
async function loadPermissions(userId: string): Promise<string[]> {
  try {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        permissions: true,
        role: { select: { permissions: true } },
      },
    });
    if (!user) return [];
    const perms = new Set([...(user.role?.permissions || []), ...(user.permissions || [])]);
    return [...perms];
  } catch {
    return [];
  }
}

/**
 * Session authentication middleware.
 * Reads session cookie, validates session, loads permissions.
 * Also enforces inactivity timeout for non-admin users.
 */
export async function authenticateSession(
  req: SessionRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  const sessionToken = req.cookies?.[SESSION_COOKIE];
  if (!sessionToken) {
    // Fall back to JWT Bearer token for backward compatibility
    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      // Delegate to existing JWT auth
      const { authenticate } = await import("./auth");
      return authenticate(req as any, res, next);
    }
    res.status(401).json({ error: "Not authenticated" });
    return;
  }

  try {
    const session = await prisma.userSession.findUnique({
      where: { sessionToken },
      include: { user: { select: { id: true, email: true, role: { select: { systemRole: true } }, companyId: true } } },
    });

    if (!session || session.invalidatedAt || session.expiresAt < new Date()) {
      res.clearCookie(SESSION_COOKIE);
      res.status(401).json({ error: "Session expired", code: "SESSION_EXPIRED" });
      return;
    }

    // Inactivity timeout — admin + super_admin bypass per PSA standard
    if (ADMIN_TIMEOUT_BYPASS &&
        (session.user?.role?.systemRole === "admin" || session.user?.role?.systemRole === "super_admin")) {
      // Admin and Super Admin sessions never expire from inactivity
    } else {
      const timeoutMs = await getSessionTimeoutMs();
      const idleMs = Date.now() - session.lastActivityAt.getTime();
      if (idleMs > timeoutMs) {
        await prisma.userSession.update({
          where: { id: session.id },
          data: { invalidatedAt: new Date() },
        });
        res.clearCookie(SESSION_COOKIE);
        res.status(440).json({ error: "Session expired due to inactivity", code: "SESSION_TIMEOUT" });
        return;
      }
    }

    // Sliding expiration — extend session
    await prisma.userSession.update({
      where: { id: session.id },
      data: { lastActivityAt: new Date() },
    });

    // Load permissions
    const permissions = await loadPermissions(session.userId);

    req.user = {
      userId: session.userId,
      email: session.user.email,
      role: session.user.role?.systemRole || "technician",
      companyId: session.user.companyId,
      permissions,
    };
    req.sessionId = session.id;
    next();
  } catch (e) {
    next(e);
  }
}
