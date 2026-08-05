import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@c7-overwatch/shared";
import { AppError } from "../middleware/errorHandler";

export const boardsRouter = Router();
boardsRouter.use(authenticate);

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
