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
import { Permission, DEVELOPER_ACCOUNT_REFUSAL, isSuperAdminRole, wearsDeveloperRole } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { logger } from "../services/logger";
import { describeDevice } from "../services/signInAudit";
import { invalidateSessionsForUser } from "../middleware/sessionAuth";
import { developerRoleUserEmails, developerRoleUserIds } from "../services/developerAccounts";

export const securityRouter = Router();

securityRouter.use(authenticate);

/*
 * ── The developer accounts ────────────────────────────────────────────────────────────────────────
 * A Super Admin is the only person who may see or change an account on the Developer Admin role, and
 * this screen names people three times over: the sign-in log, the live sessions and the registered
 * devices. Hiding the account in Manage Users and leaving it named here would be a half-measure, so
 * every read below narrows its query by `developerRoleUserIds()` for a caller who is not a Super Admin
 * — and every write refuses, by name, rather than acting on an account the caller cannot be shown.
 *
 * The sign-in log is the one place the exclusion cannot be total: a row records **what was typed**,
 * which is not always an account that exists, so an attempt against an unknown address still reads.
 * What is excluded is the account itself — the events attached to it, and the totals counted beside
 * them, which are computed over the same filtered set.
 */

/**
 * The ids of the developer accounts, or none at all when the caller is a Super Admin.
 *
 * A helper rather than a repeated call because a non-Super-Admin is the common case for these routes
 * and `[]` in a `notIn` is a no-op: the query reads the same with and without the narrowing.
 */
async function hiddenUserIds(req: AuthRequest): Promise<string[]> {
  return isSuperAdminRole(req.user!.role) ? [] : developerRoleUserIds();
}

/**
 * Refuses when the account a write is about to act on is on the developer surface and the caller is not
 * a Super Admin. It throws rather than returning a flag, so a route cannot forget to read the answer:
 * the refusal is the helper's whole effect.
 */
async function refuseDeveloperAccount(caller: { role?: string } | undefined, userId: string | null | undefined): Promise<void> {
  if (isSuperAdminRole(caller?.role) || !userId) return;
  const user = await prisma.user.findUnique({ where: { id: userId }, include: { role: true } });
  if (user && wearsDeveloperRole(user)) {
    throw new AppError(`Refused: ${user.email}. ${DEVELOPER_ACCOUNT_REFUSAL}`, 403);
  }
}

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

    /*
     * Events about a developer account are excluded for a caller who is not a Super Admin, and the
     * filter goes into the *same* `where` every query below uses — the page, the total, the three
     * group-bys — so the tiles beside the list cannot report an account the list does not show.
     *
     * The address is excluded as well as the id, and that is not belt-and-braces: a sign-in row holds
     * **what was typed**, and a row can be written with no `userId` at all, so filtering by id alone
     * would leave `devadmin@…` in a successful sign-in reading in front of an administrator who may not
     * see the account. That is also why the exclusion is the best this endpoint can do — a row whose
     * address is not an account at all is still a row about what somebody typed.
     */
    const hidden = await hiddenUserIds(req);
    const hiddenEmails = hidden.length ? await developerRoleUserEmails() : [];
    const scoped = hidden.length
      ? {
          ...where,
          AND: [
            { OR: [{ userId: null }, { userId: { notIn: hidden } }] },
            ...hiddenEmails.map((email) => ({ NOT: { email: { equals: email, mode: "insensitive" as const } } })),
          ],
        }
      : where;

    const [rows, total, byResult, users, devices] = await Promise.all([
      prisma.signInEvent.findMany({
        where: scoped,
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
      prisma.signInEvent.count({ where: scoped }),
      prisma.signInEvent.groupBy({ by: ["result"], where: scoped, _count: { _all: true } }),
      prisma.signInEvent.groupBy({ by: ["userId"], where: { ...scoped, userId: { not: null } }, _count: { _all: true } }),
      prisma.signInEvent.groupBy({ by: ["device"], where: { ...scoped, device: { not: null } }, _count: { _all: true } }),
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

    // A developer account's live sessions are not listed to a caller who is not a Super Admin: the row
    // names the person, the address and the device, which is more of the account than a refusal to show
    // it in Manage Users would suggest. `AND` rather than a second `userId`, so an explicit filter for
    // one person is narrowed to nothing rather than replaced.
    const hidden = await hiddenUserIds(req);
    const scoped = hidden.length ? { ...where, AND: [{ userId: { notIn: hidden } }] } : where;

    const rows = await prisma.userSession.findMany({
      where: scoped,
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
    // Ending somebody's session is changing their account, and the account on the developer surface is
    // a Super Admin's to change.
    await refuseDeveloperAccount(req.user, session.userId);
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
    await refuseDeveloperAccount(req.user, userId);
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
    // Devices carry the account's name and address, so the developer accounts are excluded from the
    // inventory of them for a caller who is not a Super Admin — the same narrowing the sessions list has.
    const hidden = await hiddenUserIds(req);
    const where = {
      ...(userId ? { userId } : {}),
      ...(hidden.length ? { AND: [{ userId: { notIn: hidden } }] } : {}),
    };
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
    // Removing a credential is an edit to the account it belongs to.
    await refuseDeveloperAccount(req.user, row.userId);
    await prisma.webauthnCredential.delete({ where: { id: row.id } });
    logger.info("security", `Passkey "${row.deviceName ?? row.id}" removed from user ${row.userId} by ${req.user!.userId}`);
    res.json({ removed: true });
  } catch (e) { next(e); }
});

securityRouter.delete("/devices/push/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.pushDevice.findUnique({ where: { id: String(req.params.id) } });
    if (!row) throw new AppError("Device not found", 404);
    await refuseDeveloperAccount(req.user, row.userId);
    await prisma.pushDevice.delete({ where: { id: row.id } });
    logger.info("security", `Push device removed from user ${row.userId ?? "unknown"} by ${req.user!.userId}`);
    res.json({ removed: true });
  } catch (e) { next(e); }
});
