import { Router } from "express";
import { prisma } from "../../index";
import { authenticate, requirePermission, type AuthRequest } from "../../middleware/auth";
import { Permission, TicketStatus } from "@c7-overwatch/shared";
import { AppError } from "../../middleware/errorHandler";
import { onTicketStatusChange, extractPriority } from "./automations";
import { v4 as uuid } from "uuid";

export const ticketsRouter = Router();
ticketsRouter.use(authenticate);

// ── List tickets ──
ticketsRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { status, priority, boardId, companyId, assignedToId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};

    // Client users only see their company's tickets unless they have view_all
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId) {
      where.companyId = req.user!.companyId;
    }
    if (status) where.status = status;
    if (priority) where.priority = priority;
    if (boardId) where.boardId = boardId;
    if (companyId && req.user!.permissions.includes(Permission.TicketViewAll)) where.companyId = companyId;
    if (assignedToId) where.assignedToId = assignedToId;
    if (search) {
      where.OR = [
        { title: { contains: search } },
        { ticketNumber: { contains: search } },
      ];
    }

    const [tickets, total] = await Promise.all([
      prisma.ticket.findMany({
        where,
        skip: Number(offset),
        take: Number(limit),
        orderBy: { updatedAt: "desc" },
        include: { company: { select: { id: true, name: true } }, assignedTo: { select: { id: true, firstName: true, lastName: true } }, board: { select: { id: true, name: true } } },
      }),
      prisma.ticket.count({ where }),
    ]);
    res.json({ data: tickets, total, limit: Number(limit), offset: Number(offset) });
  } catch (e) { next(e); }
});

// ── Get single ticket ──
ticketsRouter.get("/:id", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({
      where: { id: req.params.id },
      include: {
        company: true, assignedTo: true, board: true,
        notes: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
        timeEntries: { orderBy: { startTime: "desc" } },
      },
    });
    if (!ticket) throw new AppError("Ticket not found", 404);
    // Client scope check
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId && ticket.companyId !== req.user!.companyId) {
      throw new AppError("Not authorized", 403);
    }
    res.json(ticket);
  } catch (e) { next(e); }
});

// ── Create ticket ──
ticketsRouter.post("/", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { title, description, boardId, companyId, priority, source } = req.body;
    if (!title || !boardId) throw new AppError("title and boardId required");
    const board = await prisma.serviceBoard.findUnique({ where: { id: boardId } });
    if (!board) throw new AppError("Service board not found", 404);

    const ticketNumber = `C7-${Date.now().toString(36).toUpperCase()}-${uuid().slice(0, 4).toUpperCase()}`;
    const autoPriority = priority || extractPriority(title, description || "");

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber, title, description: description || "", boardId, companyId: companyId || req.user!.companyId,
        priority: autoPriority, source: source || "portal",
        status: TicketStatus.New,
        createdById: req.user!.userId,
      },
    });
    res.status(201).json(ticket);
  } catch (e) { next(e); }
});

// ── Update ticket ──
ticketsRouter.patch("/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const ticket = await prisma.ticket.findUnique({ where: { id: req.params.id } });
    if (!ticket) throw new AppError("Ticket not found", 404);
    const oldStatus = ticket.status;

    const allowed = ["title", "description", "status", "priority", "boardId", "assignedToId", "dueDate", "estimatedHours", "serviceAgreementId"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }

    const updated = await prisma.ticket.update({ where: { id: req.params.id }, data: updates });

    if (updates.status && updates.status !== oldStatus) {
      await onTicketStatusChange(req.params.id, updates.status as TicketStatus, oldStatus);
    }

    // Add note if provided
    if (req.body.note) {
      await prisma.ticketNote.create({
        data: { ticketId: req.params.id, content: req.body.note, authorId: req.user!.userId, isInternal: req.body.noteInternal || false },
      });
    }

    res.json(updated);
  } catch (e) { next(e); }
});

// ── Add note to ticket ──
ticketsRouter.post("/:id/notes", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { content, isInternal } = req.body;
    if (!content) throw new AppError("content required");
    const note = await prisma.ticketNote.create({
      data: { ticketId: req.params.id, content, authorId: req.user!.userId, isInternal: isInternal || false },
    });
    res.status(201).json(note);
  } catch (e) { next(e); }
});

// ── Add time entry ──
ticketsRouter.post("/:id/time", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { startTime, endTime, description, billable } = req.body;
    const hours = (new Date(endTime).getTime() - new Date(startTime).getTime()) / 3600000;
    const entry = await prisma.timeEntry.create({
      data: { ticketId: req.params.id, userId: req.user!.userId, startTime: new Date(startTime), endTime: new Date(endTime), hours: Math.round(hours * 100) / 100, description, billable: billable ?? true },
    });
    res.status(201).json(entry);
  } catch (e) { next(e); }
});
