/**
 * The security screen's API: sign-ins, live sessions, and registered devices.
 *
 * Modelled on Entra's sign-in log, which answers three questions in that order — *did anybody try to
 * get in*, *who is signed in right now*, and *on what*. Each of the three endpoints below answers one,
 * and the two write endpoints act on the second and third: a session can be revoked and a device
 * removed, because seeing a session you cannot end is a screen that only tells you about a problem.
 *
 * Everything here needs `security:manage`. It is the same permission the Sessions & Security settings
 * and single sign-on use, and the reason is the contents rather than the settings: an address, a
 * device and a failed attempt are facts about people, and the sign-in log is the one screen in the
 * product whose whole purpose is to be read by somebody investigating an account.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../services/logger";
import { describeDevice } from "../services/signInAudit";
import { invalidateSessionsForUser } from "../middleware/sessionAuth";

export const securityRouter = Router();

securityRouter.use(authenticate);

/** The results a sign-in can end in, so a bad filter is refused rather than silently matching none. */
const RESULTS = ["success", "failure", "locked", "mfa_failed", "code_failed", "signed_out"] as const;

function dateOrNull(value: unknown): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ── Sign-in log ──

/**
 * The attempts, newest first, with the numbers the tiles above them show.
 *
 * The summary is computed over the *filtered* set rather than the returned page, because the whole
 * point of reading it beside a filter is "of the failures in this window, how many were lockouts?" —
 * a count over twenty rows would answer a different question and look like the same one.
 */
securityRouter.get("/sign-ins", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const result = typeof req.query.result === "string" && req.query.result ? req.query.result : "";
    if (result && !RESULTS.includes(result as (typeof RESULTS)[number])) {
      throw new AppError(`Unknown result "${result}" — use one of ${RESULTS.join(", ")}`, 400);
    }
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : "";
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const from = dateOrNull(req.query.from);
    const to = dateOrNull(req.query.to);
    const limit = Math.min(200, Math.max(1, Number(req.query.limit) || 50));
    const offset = Math.max(0, Number(req.query.offset) || 0);

    const where = {
      ...(result ? { result } : {}),
      ...(userId ? { userId } : {}),
      ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
      ...(search
        ? {
            OR: [
              { email: { contains: search, mode: "insensitive" as const } },
              { ipAddress: { contains: search } },
              { device: { contains: search, mode: "insensitive" as const } },
              { reason: { contains: search, mode: "insensitive" as const } },
            ],
          }
        : {}),
    };

    const [rows, total, byResult, users, devices] = await Promise.all([
      prisma.signInEvent.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        include: {
          user: {
            select: {
              id: true, email: true, firstName: true, lastName: true,
              role: { select: { name: true, systemRole: true } },
            },
          },
        },
      }),
      prisma.signInEvent.count({ where }),
      prisma.signInEvent.groupBy({ by: ["result"], where, _count: { _all: true } }),
      prisma.signInEvent.groupBy({ by: ["userId"], where: { ...where, userId: { not: null } }, _count: { _all: true } }),
      prisma.signInEvent.groupBy({ by: ["device"], where: { ...where, device: { not: null } }, _count: { _all: true } }),
    ]);

    const counted = new Map(byResult.map((row) => [row.result, row._count._all]));
    res.json({
      data: rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt,
        result: row.result,
        method: row.method,
        reason: row.reason,
        email: row.email,
        ipAddress: row.ipAddress,
        device: row.device,
        userAgent: row.userAgent,
        userId: row.userId,
        sessionId: row.sessionId,
        userName: row.user ? `${row.user.firstName} ${row.user.lastName}`.trim() : null,
        roleName: row.user?.role?.name ?? null,
      })),
      total,
      limit,
      offset,
      summary: {
        total,
        success: counted.get("success") ?? 0,
        failure: counted.get("failure") ?? 0,
        locked: counted.get("locked") ?? 0,
        mfaFailed: (counted.get("mfa_failed") ?? 0) + (counted.get("code_failed") ?? 0),
        signedOut: counted.get("signed_out") ?? 0,
        users: users.length,
        devices: devices.length,
      },
    });
  } catch (e) { next(e); }
});

// ── Live sessions ──

/**
 * Who is signed in, and how they got there.
 *
 * The method comes from the sign-in event that opened the session rather than from the session row,
 * which does not store it — so a screen can say "signed in with a passkey" rather than only "signed
 * in". A session whose event has been pruned reads as null rather than as a guess.
 */
securityRouter.get("/sessions", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : "";
    const state = typeof req.query.state === "string" ? req.query.state : "active";
    if (!["active", "ended", "all"].includes(state)) {
      throw new AppError(`Unknown state "${state}" — use active, ended or all`, 400);
    }

    const where = {
      ...(userId ? { userId } : {}),
      ...(state === "active" ? { invalidatedAt: null, expiresAt: { gt: new Date() } } : {}),
      ...(state === "ended" ? { OR: [{ invalidatedAt: { not: null } }, { expiresAt: { lte: new Date() } }] } : {}),
    };

    const rows = await prisma.userSession.findMany({
      where,
      orderBy: { lastActivityAt: "desc" },
      take: 200,
    });
    const sessionIds = rows.map((row) => row.id);
    // The event that opened each session, for the method. One query rather than one per row.
    const events = sessionIds.length
      ? await prisma.signInEvent.findMany({
          where: { sessionId: { in: sessionIds } },
          select: { sessionId: true, method: true },
        })
      : [];
    const methodBySession = new Map(events.map((event) => [event.sessionId, event.method]));

    const userIds = [...new Set(rows.map((row) => row.userId))];
    const users = userIds.length
      ? await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, email: true, firstName: true, lastName: true, role: { select: { name: true } } },
        })
      : [];
    const userById = new Map(users.map((user) => [user.id, user]));

    res.json({
      data: rows.map((row) => {
        const user = userById.get(row.userId);
        return {
          id: row.id,
          userId: row.userId,
          userName: user ? `${user.firstName} ${user.lastName}`.trim() : null,
          userEmail: user?.email ?? null,
          roleName: user?.role?.name ?? null,
          ipAddress: row.ipAddress,
          device: describeDevice(row.userAgent),
          userAgent: row.userAgent,
          method: methodBySession.get(row.id) ?? null,
          createdAt: row.createdAt,
          lastActivityAt: row.lastActivityAt,
          expiresAt: row.expiresAt,
          invalidatedAt: row.invalidatedAt,
          active: !row.invalidatedAt && row.expiresAt.getTime() > Date.now(),
        };
      }),
    });
  } catch (e) { next(e); }
});

/**
 * Revokes one session.
 *
 * The row is stamped rather than deleted: a session that ended is a fact worth keeping for as long as
 * it is interesting, and the cookie it belonged to stops resolving the moment `invalidatedAt` is set.
 */
securityRouter.delete("/sessions/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const session = await prisma.userSession.findUnique({ where: { id: String(req.params.id) } });
    if (!session) throw new AppError("Session not found", 404);
    if (session.invalidatedAt) {
      res.json({ revoked: false, reason: "That session had already ended" });
      return;
    }
    await prisma.userSession.update({ where: { id: session.id }, data: { invalidatedAt: new Date() } });
    logger.info("security", `Session ${session.id} for user ${session.userId} revoked by ${req.user!.userId}`);
    res.json({ revoked: true });
  } catch (e) { next(e); }
});

/** Revokes every live session for one person — the "sign this account out everywhere" button. */
securityRouter.post("/sessions/revoke-user", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const userId = String(req.body?.userId ?? "");
    if (!userId) throw new AppError("userId required");
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true } });
    if (!user) throw new AppError("User not found", 404);
    const ended = await invalidateSessionsForUser(userId);
    logger.info("security", `All sessions revoked for ${user.email} by ${req.user!.userId}`);
    res.json({ revoked: ended });
  } catch (e) { next(e); }
});

// ── Registered devices ──

/**
 * The devices a person has registered: passkeys (which sign in) and push subscriptions (which receive).
 *
 * Both are the person's own — self-service is where they are *added*, and this is where they are seen
 * and taken away, because the two situations that need it are "remove a device I have lost" and "this
 * account has a device on it that nobody recognises", and only one of them is the account holder.
 */
securityRouter.get("/devices", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const userId = typeof req.query.userId === "string" && req.query.userId ? req.query.userId : "";
    const where = userId ? { userId } : {};
    const [passkeys, push] = await Promise.all([
      prisma.webauthnCredential.findMany({
        where,
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
      prisma.pushDevice.findMany({
        where: { ...where, userId: { not: null } },
        orderBy: { createdAt: "desc" },
        include: { user: { select: { id: true, email: true, firstName: true, lastName: true } } },
      }),
    ]);

    type Row = {
      id: string; kind: "passkey" | "push"; label: string; platform: string | null;
      user: { id: string; email: string; name: string } | null;
      createdAt: Date; lastUsedAt: Date | null;
    };
    const rows: Row[] = [
      ...passkeys.map((row) => ({
        id: row.id,
        kind: "passkey" as const,
        label: row.deviceName || "Passkey",
        platform: row.transports !== "[]" ? row.transports : null,
        user: row.user ? { id: row.user.id, email: row.user.email, name: `${row.user.firstName} ${row.user.lastName}`.trim() } : null,
        createdAt: row.createdAt,
        lastUsedAt: row.lastUsedAt,
      })),
      ...push.map((row) => ({
        id: row.id,
        kind: "push" as const,
        label: `${row.platform === "web" ? "Browser" : row.platform} notifications`,
        platform: row.platform,
        user: row.user ? { id: row.user.id, email: row.user.email, name: `${row.user.firstName} ${row.user.lastName}`.trim() } : null,
        createdAt: row.createdAt,
        lastUsedAt: row.lastSeenAt,
      })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    res.json({ data: rows });
  } catch (e) { next(e); }
});

/**
 * Removes a registered device.
 *
 * Two routes rather than one with a kind, because they delete from different tables and a mistake in a
 * shared handler would be a mistake in both.
 */
securityRouter.delete("/devices/passkey/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.webauthnCredential.findUnique({ where: { id: String(req.params.id) } });
    if (!row) throw new AppError("Passkey not found", 404);
    await prisma.webauthnCredential.delete({ where: { id: row.id } });
    logger.info("security", `Passkey "${row.deviceName ?? row.id}" removed from user ${row.userId} by ${req.user!.userId}`);
    res.json({ removed: true });
  } catch (e) { next(e); }
});

securityRouter.delete("/devices/push/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.pushDevice.findUnique({ where: { id: String(req.params.id) } });
    if (!row) throw new AppError("Device not found", 404);
    await prisma.pushDevice.delete({ where: { id: row.id } });
    logger.info("security", `Push device removed from user ${row.userId ?? "unknown"} by ${req.user!.userId}`);
    res.json({ removed: true });
  } catch (e) { next(e); }
});
