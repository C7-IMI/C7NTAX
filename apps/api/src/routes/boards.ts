import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, TicketStatus } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { encryptPassword } from "../services/emailConnectorCrypto";
import { normaliseBoardTiles } from "../services/boardLayout";

export const boardsRouter = Router();
boardsRouter.use(authenticate);

// ── Board metrics (dashboard cards) ──
boardsRouter.get("/metrics", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const boards = await prisma.serviceBoard.findMany({
      where: { isActive: true },
      orderBy: { name: "asc" },
    });

    const now = new Date();
    const threeDaysAgo = new Date(now.getTime() - 3 * 86400000);
    const sevenDaysAgo = new Date(now.getTime() - 7 * 86400000);
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 86400000);

    // Every board's arrangement in one query, so the list renders in the saved order without a
    // request per card.
    const layouts = await prisma.boardLayout.findMany({ where: { boardId: { in: boards.map(b => b.id) } }, select: { boardId: true, tiles: true } });
    const layoutByBoard = new Map(layouts.map(l => [l.boardId, l.tiles]));

    const metrics = await Promise.all(boards.map(async (board) => {
      const [open, workable, newTickets, onHold, waiting, stale3, stale7, stale30, escalations, avgAgeResult, activeClient] = await Promise.all([
        prisma.ticket.count({ where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] } } }),
        prisma.ticket.count({ where: { boardId: board.id, status: "in_progress" } }),
        prisma.ticket.count({ where: { boardId: board.id, status: "new" } }),
        prisma.ticket.count({ where: { boardId: board.id, status: "on_hold" } }),
        prisma.ticket.count({ where: { boardId: board.id, status: { in: ["waiting_on_client", "waiting_on_third_party"] } } }),
        prisma.ticket.count({ where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] }, updatedAt: { lt: threeDaysAgo } } }),
        prisma.ticket.count({ where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] }, updatedAt: { lt: sevenDaysAgo } } }),
        prisma.ticket.count({ where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] }, updatedAt: { lt: thirtyDaysAgo } } }),
        prisma.ticket.count({ where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] }, priority: "critical" } }),
        Promise.resolve(null),
        prisma.ticket.groupBy({
          by: ["companyId"],
          where: { boardId: board.id, createdAt: { gte: thirtyDaysAgo } },
          _count: { id: true },
          orderBy: { _count: { id: "desc" } },
          take: 1,
        }),
      ]);

      // Calculate average ticket age from open tickets
      let avgAgeDays = 0;
      if (open > 0) {
        const openTickets = await prisma.ticket.findMany({
          where: { boardId: board.id, status: { notIn: ["closed", "cancelled"] } },
          select: { createdAt: true },
        });
        const totalAge = openTickets.reduce((sum, t) => sum + (now.getTime() - new Date(t.createdAt).getTime()), 0);
        avgAgeDays = Math.round(totalAge / openTickets.length / 86400000);
      }

      // Active client name
      let mostActiveClient: { id: string; name: string; count: number } | null = null;
      const topClient = activeClient[0];
      if (topClient) {
        const company = await prisma.company.findUnique({
          where: { id: topClient.companyId },
          select: { id: true, name: true },
        });
        if (company) {
          mostActiveClient = { ...company, count: topClient._count.id };
        }
      }

      return {
        boardId: board.id,
        boardName: board.name,
        boardDescription: board.description,
        tiles: normaliseBoardTiles(layoutByBoard.get(board.id)),
        layoutPersonalised: layoutByBoard.has(board.id),
        metrics: {
          open,
          workable,
          new: newTickets,
          onHold,
          waitingOnResponse: waiting,
          stale3Days: stale3,
          stale7Days: stale7,
          stale30Days: stale30,
          escalations,
          averageAgeDays: avgAgeDays,
          mostActiveClient,
        },
      };
    }));

    res.json(metrics);
  } catch (e) { next(e); }
});

// ── List boards ──
boardsRouter.get("/", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const boards = await prisma.serviceBoard.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { tickets: true, emailConnectors: true } } },
    });
    res.json(boards);
  } catch (e) { next(e); }
});

// ── Get single board ──
boardsRouter.get("/:id", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const board = await prisma.serviceBoard.findUnique({
      where: { id: req.params.id },
      include: {
        _count: { select: { tickets: true } },
        emailConnectors: {
          select: { id: true, host: true, port: true, secure: true, user: true, folder: true, pollIntervalSec: true, enabled: true, lastPollAt: true },
        },
      },
    });
    if (!board) throw new AppError("Board not found", 404);
    res.json(board);
  } catch (e) { next(e); }
});

// ── Create board ──
boardsRouter.post("/", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, notifyCustomerOnClose } = req.body;
    if (!name) throw new AppError("name required");
    const board = await prisma.serviceBoard.create({
      data: {
        name,
        description: description || "",
        // Only when it is a boolean: the column's own default (on) is the answer for a board that does
        // not say, and `false` is the interesting value — it is what a NOC board is created with.
        ...(typeof notifyCustomerOnClose === "boolean" ? { notifyCustomerOnClose } : {}),
      },
    });
    res.status(201).json(board);
  } catch (e) { next(e); }
});

// ── Update board ──
boardsRouter.patch("/:id", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, enabled, ticketCode, slaResponseMinutes, slaResolutionMinutes, autoCloseEnabled, autoCloseDays, followUpEnabled, followUpIntervalMinutes, notifyCustomerOnClose } = req.body;
    const data: Record<string, unknown> = {};
    if (name !== undefined) data.name = name;
    if (description !== undefined) data.description = description;
    if (ticketCode !== undefined) data.ticketCode = ticketCode || null;
    if (enabled !== undefined) data.enabled = enabled;
    if (slaResponseMinutes !== undefined) data.slaResponseMinutes = slaResponseMinutes;
    if (slaResolutionMinutes !== undefined) data.slaResolutionMinutes = slaResolutionMinutes;
    if (autoCloseEnabled !== undefined) data.autoCloseEnabled = autoCloseEnabled;
    if (autoCloseDays !== undefined) data.autoCloseDays = autoCloseDays;
    if (followUpEnabled !== undefined) data.followUpEnabled = followUpEnabled;
    if (followUpIntervalMinutes !== undefined) data.followUpIntervalMinutes = followUpIntervalMinutes;
    if (notifyCustomerOnClose !== undefined) data.notifyCustomerOnClose = notifyCustomerOnClose === true;
    const board = await prisma.serviceBoard.update({ where: { id: req.params.id }, data });
    res.json(board);
  } catch (e) { next(e); }
});

// ─── Tile arrangement (PLAN-015 Phase B #5) ───

/**
 * A board card's tile order is shared with everybody who looks at the board, so it is a
 * management action like any other board setting: reading it needs board:view, changing it needs
 * board:manage.
 */
boardsRouter.get("/:id/layout", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const board = await prisma.serviceBoard.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!board) throw new AppError("Board not found", 404);
    const saved = await prisma.boardLayout.findUnique({ where: { boardId: board.id }, select: { tiles: true, updatedAt: true } });
    res.json({ tiles: normaliseBoardTiles(saved?.tiles), personalised: !!saved, updatedAt: saved?.updatedAt ?? null });
  } catch (e) { next(e); }
});

boardsRouter.put("/:id/layout", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const board = await prisma.serviceBoard.findUnique({ where: { id: req.params.id }, select: { id: true } });
    if (!board) throw new AppError("Board not found", 404);
    const body = req.body as { tiles?: unknown };
    if (!Array.isArray(body?.tiles)) throw new AppError("tiles must be an array", 400);
    if (body.tiles.length > 30) throw new AppError("too many tiles", 400);
    const tiles = normaliseBoardTiles(body.tiles);
    const row = await prisma.boardLayout.upsert({
      where: { boardId: board.id },
      update: { tiles: tiles as object, updatedById: req.user!.userId },
      create: { boardId: board.id, tiles: tiles as object, updatedById: req.user!.userId },
    });
    res.json({ tiles, personalised: true, updatedAt: row.updatedAt });
  } catch (e) { next(e); }
});

boardsRouter.delete("/:id/layout", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.boardLayout.deleteMany({ where: { boardId: req.params.id } });
    res.json({ tiles: normaliseBoardTiles(null), personalised: false, updatedAt: null });
  } catch (e) { next(e); }
});

// ─── Email Connectors (nested under boards) ───

// List connectors for a board
boardsRouter.get("/:boardId/connectors", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const connectors = await prisma.emailConnector.findMany({
      where: { boardId: req.params.boardId },
      select: { id: true, host: true, port: true, secure: true, user: true, folder: true, pollIntervalSec: true, enabled: true, lastPollAt: true },
    });
    res.json(connectors);
  } catch (e) { next(e); }
});

// Create email connector
boardsRouter.post("/:boardId/connectors", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const { host, port, secure, folder, user, password, pollIntervalSec } = req.body;
    if (!host || !user || !password) throw new AppError("host, user, and password required");
    const board = await prisma.serviceBoard.findUnique({ where: { id: String(req.params.boardId) } });
    if (!board) throw new AppError("Service board not found", 404);
    const existing = await prisma.emailConnector.findFirst({ where: { user: String(user), boardId: String(req.params.boardId) } });
    if (existing) throw new AppError("An email connector for that user already exists on this board", 409);
    const connector = await prisma.emailConnector.create({
      data: {
        boardId: board.id,
        host: String(host),
        port: Number(port) || 993,
        secure: secure ?? true,
        folder: folder || "INBOX",
        user: String(user),
        passwordEncrypted: encryptPassword(String(password)),
        pollIntervalSec: Number(pollIntervalSec) || 300,
      },
    });
    const { passwordEncrypted: _p, ...safe } = connector;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// Update email connector
boardsRouter.patch("/:boardId/connectors/:connectorId", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const updates: Record<string, unknown> = {};
    if (req.body.host !== undefined) updates.host = String(req.body.host);
    if (req.body.port !== undefined) updates.port = Number(req.body.port) || 993;
    if (req.body.secure !== undefined) updates.secure = req.body.secure !== false;
    if (req.body.folder !== undefined) updates.folder = String(req.body.folder);
    if (req.body.user !== undefined) updates.user = String(req.body.user);
    if (req.body.password !== undefined) updates.passwordEncrypted = encryptPassword(String(req.body.password));
    if (req.body.pollIntervalSec !== undefined) updates.pollIntervalSec = Math.max(30, Number(req.body.pollIntervalSec) || 300);
    if (req.body.enabled !== undefined) updates.enabled = Boolean(req.body.enabled);
    const connector = await prisma.emailConnector.update({ where: { id: req.params.connectorId }, data: updates as any });
    const { passwordEncrypted: _p, ...safe } = connector;
    res.json(safe);
  } catch (e) { next(e); }
});

// Delete email connector
boardsRouter.delete("/:boardId/connectors/:connectorId", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    await prisma.emailConnector.delete({ where: { id: req.params.connectorId } });
    res.json({ message: "Connector deleted" });
  } catch (e) { next(e); }
});
