/**
 * Email connector management API (Prisma EmailConnector model).
 *
 * Secrets (the mailbox password, the Entra client secret) are encrypted with
 * kumoCrypto and never returned; the UI is told whether one is set instead.
 *
 * Two transports, because Microsoft 365 cannot use the first one any more:
 *  - `imap`  — host/port/secure + user/password. Fine for mailboxes that still
 *              accept a password; Exchange Online has Basic authentication
 *              disabled in every tenant.
 *  - `graph` — tenantId/clientId/clientSecret plus the mailbox to watch, read
 *              app-only through Microsoft Graph. This is the Microsoft 365 path.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { encryptPassword } from "../services/emailConnectorCrypto";
import {
  startEmailConnector,
  stopEmailConnector,
  testEmailConnector,
  pollEmailConnectorNow,
  readConnectorState,
  isGraphTransport,
  type ConnectorRow,
} from "../services/emailConnectorRuntime";

export const emailConnectorsRouter = Router();
emailConnectorsRouter.use(authenticate);

const TRANSPORTS = ["imap", "graph"] as const;
type Transport = (typeof TRANSPORTS)[number];

function normalizeTransport(value: unknown, fallback: Transport = "imap"): Transport {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === "graph" || raw === "microsoftgraph" || raw === "microsoft-graph" || raw === "o365" || raw === "office365" || raw === "m365") return "graph";
  if (raw === "imap") return "imap";
  throw new AppError(`Unsupported transport "${raw}" — use "imap" or "graph"`, 400);
}

/** What the client may see: config and flags, never a secret. */
function toPublic(row: ConnectorRow & { enabled: boolean; lastPollAt: Date | null; createdAt?: Date; updatedAt?: Date }) {
  return {
    id: row.id,
    boardId: row.boardId,
    transport: normalizeTransport(row.transport, "imap"),
    host: row.host,
    port: row.port,
    secure: row.secure,
    user: row.user,
    folder: row.folder,
    pollIntervalSec: row.pollIntervalSec,
    enabled: row.enabled,
    lastPollAt: row.lastPollAt,
    tenantId: row.tenantId,
    clientId: row.clientId,
    hasPassword: Boolean(row.passwordEncrypted),
    hasClientSecret: Boolean(row.clientSecretEncrypted),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Validate a create/update body. `existing` is the stored row on update, so a
 * secret already saved can stay while the rest of the config changes.
 */
function validateConfig(
  body: Record<string, unknown>,
  transport: Transport,
  existing: { passwordEncrypted?: string; clientSecretEncrypted?: string | null } | null,
): void {
  const missing: string[] = [];
  if (!body.boardId && !existing) missing.push("boardId");
  if (transport === "graph") {
    if (!body.tenantId) missing.push("tenantId");
    if (!body.clientId) missing.push("clientId");
    if (!body.clientSecret && !existing?.clientSecretEncrypted) missing.push("clientSecret");
    // user doubles as the mailbox to watch
    if (!body.user && !existing) missing.push("user (mailbox)");
  } else {
    if (!body.host) missing.push("host");
    if (!body.user) missing.push("user");
    if (!body.password && !existing?.passwordEncrypted) missing.push("password");
  }
  if (missing.length) {
    throw new AppError(
      transport === "graph"
        ? `Microsoft 365 (Graph) needs: ${missing.join(", ")}. The app registration needs the application permission Mail.ReadWrite, consented, and its access scoped to this mailbox.`
        : `IMAP needs: ${missing.join(", ")}`,
      400,
    );
  }
}

/** Loads a row as the runtime wants it. */
async function loadRow(id: string) {
  const row = await prisma.emailConnector.findUnique({ where: { id } });
  if (!row) throw new AppError("Connector not found", 404);
  return row;
}

// ── List ──
// Carries the connector's health from the runtime's state row (last error, how
// much mail it has processed) so a broken mailbox is visible in the list.
emailConnectorsRouter.get("/", requirePermission(Permission.IntegrationView), async (_req: AuthRequest, res, next) => {
  try {
    const rows = await prisma.emailConnector.findMany({ orderBy: { createdAt: "asc" } });
    const keys = rows.map((r) => `email_connector:${r.id}:state`);
    const states = keys.length ? await prisma.systemConfig.findMany({ where: { key: { in: keys } } }) : [];
    const byKey = new Map(states.map((s) => [s.key, (s.value || {}) as { processed?: unknown; lastError?: unknown; lastErrorAt?: unknown; lastProcessedAt?: unknown }]));
    res.json({
      data: rows.map((row) => {
        const state = byKey.get(`email_connector:${row.id}:state`) || {};
        return {
          ...toPublic(row),
          lastError: typeof state.lastError === "string" ? state.lastError : null,
          lastErrorAt: typeof state.lastErrorAt === "string" ? state.lastErrorAt : null,
          lastProcessedAt: typeof state.lastProcessedAt === "string" ? state.lastProcessedAt : null,
          processedCount: Array.isArray(state.processed) ? state.processed.length : 0,
        };
      }),
    });
  } catch (e) { next(e); }
});

// ── Create ──
emailConnectorsRouter.post("/", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body || {}) as Record<string, unknown>;
    const transport = normalizeTransport(body.transport);
    validateConfig(body, transport, null);
    const board = await prisma.serviceBoard.findUnique({ where: { id: String(body.boardId) } });
    if (!board) throw new AppError("Service board not found", 404);

    const row = await prisma.emailConnector.create({
      data: {
        boardId: String(body.boardId),
        transport,
        host: transport === "graph" ? "" : String(body.host),
        port: transport === "graph" ? 443 : Number(body.port) || 993,
        secure: body.secure !== false,
        user: String(body.user),
        passwordEncrypted: body.password ? encryptPassword(String(body.password)) : "",
        clientId: transport === "graph" ? String(body.clientId) : null,
        clientSecretEncrypted: transport === "graph" && body.clientSecret ? encryptPassword(String(body.clientSecret)) : null,
        tenantId: transport === "graph" ? String(body.tenantId) : null,
        folder: body.folder ? String(body.folder) : transport === "graph" ? "Inbox" : "INBOX",
        pollIntervalSec: Math.max(30, Number(body.pollIntervalSec ?? body.pollIntervalSeconds) || 300),
        // Created disabled: the admin tests the connection, then switches it on.
        enabled: false,
      },
    });
    res.status(201).json(toPublic(row));
  } catch (e) { next(e); }
});

// ── Update ──
emailConnectorsRouter.patch("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const existing = await loadRow(String(req.params.id));
    const body = (req.body || {}) as Record<string, unknown>;
    const transport = body.transport !== undefined ? normalizeTransport(body.transport) : normalizeTransport(existing.transport);

    const data: Record<string, unknown> = {};
    if (body.transport !== undefined) data.transport = transport;
    if (body.host !== undefined) data.host = String(body.host);
    if (body.port !== undefined) data.port = Number(body.port) || 993;
    if (body.secure !== undefined) data.secure = body.secure !== false;
    if (body.user !== undefined) data.user = String(body.user);
    if (body.password !== undefined && body.password !== "") data.passwordEncrypted = encryptPassword(String(body.password));
    if (body.folder !== undefined) data.folder = String(body.folder);
    if (body.pollIntervalSec !== undefined) data.pollIntervalSec = Math.max(30, Number(body.pollIntervalSec ?? body.pollIntervalSeconds) || 300);
    if (body.boardId !== undefined) {
      const board = await prisma.serviceBoard.findUnique({ where: { id: String(body.boardId) } });
      if (!board) throw new AppError("Service board not found", 404);
      data.boardId = String(body.boardId);
    }
    if (body.tenantId !== undefined) data.tenantId = body.tenantId ? String(body.tenantId) : null;
    if (body.clientId !== undefined) data.clientId = body.clientId ? String(body.clientId) : null;
    if (body.clientSecret !== undefined && body.clientSecret !== "") data.clientSecretEncrypted = encryptPassword(String(body.clientSecret));

    if (body.enabled === true || body.transport !== undefined || body.host !== undefined || body.user !== undefined || body.password !== undefined || body.clientId !== undefined) {
      const pending = { ...existing, ...data } as Record<string, unknown>;
      validateConfig(pending, transport, {
        passwordEncrypted: String(pending.passwordEncrypted ?? ""),
        clientSecretEncrypted: (pending.clientSecretEncrypted as string | null) ?? null,
      });
    }
    if (body.enabled !== undefined) data.enabled = Boolean(body.enabled);

    const updated = await prisma.emailConnector.update({ where: { id: existing.id }, data: data as any });

    // Restart the poller so the running transport always matches the row.
    stopEmailConnector(updated.id);
    if (updated.enabled) startEmailConnector(updated);
    res.json(toPublic(updated));
  } catch (e) { next(e); }
});

// ── Delete ──
emailConnectorsRouter.delete("/:id", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    stopEmailConnector(String(req.params.id));
    await prisma.emailConnector.deleteMany({ where: { id: String(req.params.id) } });
    await prisma.systemConfig.deleteMany({ where: { key: `email_connector:${req.params.id}:state` } });
    res.json({ message: "Deleted" });
  } catch (e) { next(e); }
});

// ── Test connection ──
emailConnectorsRouter.post("/:id/test", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    const result = await testEmailConnector(row);
    if (result.ok) {
      await prisma.emailConnector.update({ where: { id: row.id }, data: { lastPollAt: new Date() } });
      res.json(result);
      return;
    }
    res.status(502).json(result);
  } catch (e) { next(e); }
});

// ── Poll now ──
emailConnectorsRouter.post("/:id/poll", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    if (!row.enabled) throw new AppError("Connector is disabled — enable it first", 400);
    await pollEmailConnectorNow(row);
    const state = await readConnectorState(row.id);
    res.json({ ok: !state.lastError, transport: isGraphTransport(row) ? "graph" : "imap", lastError: state.lastError, processedCount: state.processed.length });
  } catch (e) { next(e); }
});

// ── Status ──
emailConnectorsRouter.get("/:id/status", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const row = await loadRow(String(req.params.id));
    const state = await readConnectorState(row.id);
    res.json({
      id: row.id,
      enabled: row.enabled,
      transport: isGraphTransport(row) ? "graph" : "imap",
      lastPollAt: row.lastPollAt,
      lastError: state.lastError,
      lastErrorAt: state.lastErrorAt,
      lastProcessedAt: state.lastProcessedAt,
      processedCount: state.processed.length,
    });
  } catch (e) { next(e); }
});


