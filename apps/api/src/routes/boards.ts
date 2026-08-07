import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, TicketStatus } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

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
      if (activeClient.length > 0) {
        const company = await prisma.company.findUnique({
          where: { id: activeClient[0].companyId },
          select: { id: true, name: true },
        });
        if (company) {
          mostActiveClient = { ...company, count: activeClient[0]._count.id };
        }
      }

      return {
        boardId: board.id,
        boardName: board.name,
        boardDescription: board.description,
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
          select: { id: true, email: true, host: true, port: true, secure: true, folder: true, pollIntervalSeconds: true, enabled: true, lastCheckedAt: true },
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
    const { name, description } = req.body;
    if (!name) throw new AppError("name required");
    const board = await prisma.serviceBoard.create({ data: { name, description: description || "" } });
    res.status(201).json(board);
  } catch (e) { next(e); }
});

// ── Update board ──
boardsRouter.patch("/:id", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, description, enabled } = req.body;
    const board = await prisma.serviceBoard.update({
      where: { id: req.params.id },
      data: { ...(name !== undefined && { name }), ...(description !== undefined && { description }), ...(enabled !== undefined && { enabled }) },
    });
    res.json(board);
  } catch (e) { next(e); }
});

// ─── Email Connectors (nested under boards) ───

// List connectors for a board
boardsRouter.get("/:boardId/connectors", requirePermission(Permission.BoardView), async (req: AuthRequest, res, next) => {
  try {
    const connectors = await prisma.emailConnector.findMany({
      where: { boardId: req.params.boardId },
      select: { id: true, email: true, host: true, port: true, secure: true, folder: true, pollIntervalSeconds: true, enabled: true, lastCheckedAt: true },
    });
    res.json(connectors);
  } catch (e) { next(e); }
});

// Create email connector
boardsRouter.post("/:boardId/connectors", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const { email, host, port, secure, folder, user, password, pollIntervalSeconds } = req.body;
    if (!email || !host || !user || !password) throw new AppError("email, host, user, and password required");
    const existing = await prisma.emailConnector.findUnique({ where: { email } });
    if (existing) throw new AppError("An email connector with that address already exists", 409);
    const connector = await prisma.emailConnector.create({
      data: {
        boardId: req.params.boardId, email, host, port: port || 993, secure: secure ?? true,
        folder: folder || "INBOX", user, password, pollIntervalSeconds: pollIntervalSeconds || 60,
      },
    });
    const { password: _, ...safe } = connector;
    res.status(201).json(safe);
  } catch (e) { next(e); }
});

// Update email connector
boardsRouter.patch("/:boardId/connectors/:connectorId", requirePermission(Permission.BoardManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["host", "port", "secure", "folder", "user", "password", "pollIntervalSeconds", "enabled"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    const connector = await prisma.emailConnector.update({ where: { id: req.params.connectorId }, data: updates });
    const { password: _, ...safe } = connector;
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
