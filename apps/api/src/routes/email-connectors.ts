/**
 * Email connector management API (Integration rows with kind "email_connector").
 * Credentials are stored in Integration.credentials and never returned.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { fetchUnseenEmails } from "@C7NTAX/email";
import { emailConnectorManager } from "../services/emailConnectorRuntime";

export const emailConnectorsRouter = Router();
emailConnectorsRouter.use(authenticate);

const KIND = "email_connector";

function toPublic(row: { id: string; name: string; enabled: boolean; credentials: unknown; settings: unknown; status: string; errorMessage: string | null; lastSyncAt: Date | null; createdAt: Date; updatedAt: Date }) {
  const creds = (row.credentials || {}) as Record<string, unknown>;
  const settings = (row.settings || {}) as Record<string, unknown>;
  return {
    id: row.id,
    name: row.name,
    enabled: row.enabled,
    hasCredentials: Boolean(creds.host && creds.user),
    settings,
    status: row.status,
    errorMessage: row.errorMessage,
    lastSyncAt: row.lastSyncAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

// ── List ──
emailConnectorsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.integration.findMany({ where: { kind: KIND }, orderBy: { createdAt: "asc" } });
    res.json({ data: rows.map(toPublic) });
  } catch (e) { next(e); }
});

// ── Create ──
emailConnectorsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, host, port, secure, user, password, folder, pollIntervalSeconds, boardId } = req.body || {};
    if (!name || !host || !user || !password || !boardId) throw new AppError("name, host, user, password and boardId are required", 400);
    const board = await prisma.serviceBoard.findUnique({ where: { id: boardId } });
    if (!board) throw new AppError("Service board not found", 404);
    const row = await prisma.integration.create({
      data: {
        kind: KIND,
        name: String(name),
        enabled: false,
        credentials: { host: String(host), port: Number(port) || 993, secure: secure !== false, user: String(user), password: String(password) },
        settings: { boardId, folder: folder || "INBOX", pollIntervalSeconds: Math.max(30, Number(pollIntervalSeconds) || 300) },
      },
    });
    res.status(201).json(toPublic(row));
  } catch (e) { next(e); }
});

// ── Update ──
emailConnectorsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.integration.findUnique({ where: { id: req.params.id } });
    if (!row || row.kind !== KIND) throw new AppError("Connector not found", 404);
    const { name, enabled, host, port, secure, user, password, folder, pollIntervalSeconds, boardId } = req.body || {};
    const credentials = { ...(row.credentials as Record<string, unknown>) };
    if (host !== undefined) credentials.host = String(host);
    if (port !== undefined) credentials.port = Number(port) || 993;
    if (secure !== undefined) credentials.secure = secure !== false;
    if (user !== undefined) credentials.user = String(user);
    if (password !== undefined) credentials.password = String(password);
    const settings = { ...(row.settings as Record<string, unknown>) };
    if (folder !== undefined) settings.folder = String(folder);
    if (pollIntervalSeconds !== undefined) settings.pollIntervalSeconds = Math.max(30, Number(pollIntervalSeconds) || 300);
    if (boardId !== undefined) settings.boardId = String(boardId);

    const updated = await prisma.integration.update({
      where: { id: row.id },
      data: {
        name: name !== undefined ? String(name) : row.name,
        enabled: enabled !== undefined ? Boolean(enabled) : row.enabled,
        credentials,
        settings,
        errorMessage: null,
      },
    });

    // Sync runtime
    emailConnectorManager.removeConnector(row.id);
    if (updated.enabled && credentials.host && credentials.user && settings.boardId) {
      emailConnectorManager.addConnector({
        id: row.id,
        boardId: String(settings.boardId),
        host: String(credentials.host),
        port: Number(credentials.port) || 993,
        secure: credentials.secure !== false,
        user: String(credentials.user),
        password: String(credentials.password || ""),
        folder: settings.folder ? String(settings.folder) : undefined,
        pollIntervalSeconds: Math.max(30, Number(settings.pollIntervalSeconds) || 300),
        enabled: true,
      });
    }
    res.json(toPublic(updated));
  } catch (e) { next(e); }
});

// ── Delete ──
emailConnectorsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    emailConnectorManager.removeConnector(req.params.id);
    await prisma.integration.deleteMany({ where: { id: req.params.id, kind: KIND } });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Test connection ──
emailConnectorsRouter.post("/:id/test", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.integration.findUnique({ where: { id: req.params.id } });
    if (!row || row.kind !== KIND) throw new AppError("Connector not found", 404);
    const creds = row.credentials as Record<string, unknown>;
    if (!creds.host || !creds.user) throw new AppError("Credentials incomplete", 400);
    try {
      const emails = await fetchUnseenEmails({
        host: String(creds.host),
        port: Number(creds.port) || 993,
        secure: creds.secure !== false,
        user: String(creds.user),
        password: String(creds.password || ""),
        folder: ((row.settings as Record<string, unknown>)?.folder as string) || "INBOX",
      });
      await prisma.integration.update({ where: { id: row.id }, data: { status: "connected", errorMessage: null, lastSyncAt: new Date() } });
      res.json({ ok: true, unseenMessages: emails.length });
    } catch (e: any) {
      await prisma.integration.update({ where: { id: row.id }, data: { status: "error", errorMessage: String(e?.message || e).slice(0, 500) } });
      res.status(502).json({ ok: false, error: String(e?.message || e).slice(0, 300) });
    }
  } catch (e) { next(e); }
});

// ── Poll now ──
emailConnectorsRouter.post("/:id/poll", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.integration.findUnique({ where: { id: req.params.id } });
    if (!row || row.kind !== KIND) throw new AppError("Connector not found", 404);
    if (!row.enabled) throw new AppError("Connector is disabled — enable it first", 400);
    emailConnectorManager.pollNow(row.id);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ── Status ──
emailConnectorsRouter.get("/:id/status", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const row = await prisma.integration.findUnique({ where: { id: req.params.id } });
    if (!row || row.kind !== KIND) throw new AppError("Connector not found", 404);
    res.json({ id: row.id, status: row.status, errorMessage: row.errorMessage, lastSyncAt: row.lastSyncAt });
  } catch (e) { next(e); }
});
