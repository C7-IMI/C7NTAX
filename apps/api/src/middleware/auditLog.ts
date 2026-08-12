/**
 * Audit Middleware — logs every create, update, and delete operation
 * to the AuditLog model with user identity and change details.
 */

import type { Request, Response, NextFunction } from "express";
import { prisma } from "../index";
import type { AuthRequest } from "../middleware/auth";

/** Skip logging for these path prefixes (health, auth flows, polling) */
const SKIP_PREFIXES = [
  "/api/health",
  "/api/auth/",
  "/api/users/me",
  "/api/kumo/recently-viewed",
  "/api/system/poller",
  "/api/system/snapshot-poller",
];

function extractEntity(path: string): string {
  // /api/tickets/abc123 → tickets
  // /api/kumo/passwords/abc123 → kumo_passwords
  // /api/users → users
  const parts = path.replace("/api/", "").split("/");
  const base = parts[0]; // e.g. "tickets", "kumo", "users"
  if (parts.length >= 2 && base === "kumo") return `kumo_${parts[1]}`; // kumo_passwords
  if (parts.length >= 2 && base === "clients") return parts[1] === "contacts" ? "contact" : "company";
  if (parts.length >= 2 && base === "system" && parts[1] === "config") return "system_config";
  return base;
}

function summarizeChanges(body: Record<string, unknown>): Record<string, unknown> {
  if (!body || Object.keys(body).length === 0) return { note: "delete" };
  const safe: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(body)) {
    if (k === "password" || k === "passwordHash" || k === "encryptedPassword" ||
        k === "clientSecret" || k === "secret" || k === "privateKey" ||
        k === "iv" || k === "authTag") {
      safe[k] = "***";
    } else if (typeof v === "string" && v.length > 200) {
      safe[k] = v.slice(0, 200) + "...";
    } else {
      safe[k] = v;
    }
  }
  return safe;
}

export async function auditMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) return next();

  const path = req.path;
  if (SKIP_PREFIXES.some(p => path.startsWith(p))) return next();

  res.on("finish", async () => {
    const status = res.statusCode;
    if (status < 200 || status >= 400) return; // only log successful operations

    try {
      const authReq = req as AuthRequest;
      const userId = authReq.user?.userId || "system";
      const entity = extractEntity(path);
      const entityId = (req.params as Record<string, string>)?.id || 
                       path.split("/").pop()?.replace(/\?.*$/, "") || "";
      const action = method === "POST" ? "create" :
                     method === "DELETE" ? "delete" : "update";
      const changes = summarizeChanges(req.body || {});

      await prisma.auditLog.create({
        data: {
          action: `${entity}:${action}`,
          entity,
          entityId,
          changes: changes as any,
          userId,
          ipAddress: req.ip || req.socket.remoteAddress || null,
        },
      });
    } catch {
      // Audit logging should never break the application
    }
  });

  next();
}
