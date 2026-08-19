/**
 * Email connector management API (Prisma EmailConnector model).
 * Mailbox passwords are encrypted with kumoCrypto and never returned.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { fetchUnseenEmails } from "@C7NTAX/email";
import { encryptPassword, decryptPassword } from "../services/emailConnectorCrypto";
import { emailConnectorManager } from "../services/emailConnectorRuntime";

export const emailConnectorsRouter = Router();
emailConnectorsRouter.use(authenticate);

type ConnectorRow = {
  id: string; boardId: string; host: string; port: number; secure: boolean;
  user: string; folder: string; pollIntervalSec: number; enabled: boolean;
  lastPollAt: Date | null; createdAt: Date; updatedAt: Date;
};

function toPublic(row: ConnectorRow) {
  const { ...rest } = row;
  return { ...rest, hasCredentials: Boolean(row.host && row.user) };
}

// ── List ──
emailConnectorsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.emailConnector.findMany({ orderBy: { createdAt: "asc" } });
    res.json({ data: rows.map(toPublic) });
  } catch (e) { next(e); }
});

// ── Create ──
emailConnectorsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { host, port, secure, user, password, folder, pollIntervalSec, boardId } = req.body || {};
    if (!host || !user || !password || !boardId) throw new AppError("host, user, password and boardId are required", 400);
    const board = await prisma.serviceBoard.findUnique({ where: { id: boardId } });
    if (!board) throw new AppError("Service board not found", 404);
    const row = await prisma.emailConnector.create({
      data: {
        boardId: String(boardId),
        host: String(host),
        port: Number(port) || 993,
        secure: secure !== false,
        user: String(user),
        passwordEncrypted: encryptPassword(String(password)),
        folder: folder ? String(folder) : "INBOX",
        pollIntervalSec: Math.max(30, Number(pollIntervalSec) || 300),
        enabled: false,
      },
    });
    res.status(201).json(toPublic(row));
  } catch (e) { next(e); }
});

// ── Update ──
emailConnectorsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.emailConnector.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError("Connector not found", 404);
    const { host, port, secure, user, password, folder, pollIntervalSec, boardId, enabled } = req.body || {};
    const data: Record<string, unknown> = {};
    if (host !== undefined) data.host = String(host);
    if (port !== undefined) data.port = Number(port) || 993;
    if (secure !== undefined) data.secure = secure !== false;
    if (user !== undefined) data.user = String(user);
    if (password !== undefined) data.passwordEncrypted = encryptPassword(String(password));
    if (folder !== undefined) data.folder = String(folder);
    if (pollIntervalSec !== undefined) data.pollIntervalSec = Math.max(30, Number(pollIntervalSec) || 300);
    if (boardId !== undefined) data.boardId = String(boardId);
    if (enabled !== undefined) data.enabled = Boolean(enabled);

    const updated = await prisma.emailConnector.update({ where: { id: row.id }, data: data as any });

    // Sync runtime
    emailConnectorManager.removeConnector(row.id);
    if (updated.enabled) {
      emailConnectorManager.addConnector({
        id: updated.id,
        boardId: updated.boardId,
        host: updated.host,
        port: updated.port,
        secure: updated.secure,
        user: updated.user,
        password: decryptPassword(updated.passwordEncrypted),
        folder: updated.folder,
        pollIntervalSeconds: Math.max(30, updated.pollIntervalSec || 300),
        enabled: true,
      });
    }
    res.json(toPublic(updated));
  } catch (e) { next(e); }
});

// ── Delete ──
emailConnectorsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    emailConnectorManager.removeConnector(String(req.params.id));
    await prisma.emailConnector.deleteMany({ where: { id: String(req.params.id) } });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Test connection ──
emailConnectorsRouter.post("/:id/test", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.emailConnector.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError("Connector not found", 404);
    try {
      const emails = await fetchUnseenEmails({
        host: row.host,
        port: row.port,
        secure: row.secure,
        user: row.user,
        password: decryptPassword(row.passwordEncrypted),
        folder: row.folder,
      });
      await prisma.emailConnector.update({ where: { id: row.id }, data: { lastPollAt: new Date() } });
      res.json({ ok: true, unseenMessages: emails.length });
    } catch (e: any) {
      res.status(502).json({ ok: false, error: String(e?.message || e).slice(0, 300) });
    }
  } catch (e) { next(e); }
});

// ── Poll now ──
emailConnectorsRouter.post("/:id/poll", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.emailConnector.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError("Connector not found", 404);
    if (!row.enabled) throw new AppError("Connector is disabled — enable it first", 400);
    emailConnectorManager.pollNow(row.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Status ──
emailConnectorsRouter.get("/:id/status", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.emailConnector.findUnique({ where: { id: req.params.id } });
    if (!row) throw new AppError("Connector not found", 404);
    res.json({ id: row.id, enabled: row.enabled, lastPollAt: row.lastPollAt });
  } catch (e) { next(e); }
});
