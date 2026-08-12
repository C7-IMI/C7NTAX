import { Router } from "express";
import { prisma } from "../../index";
import { authenticate, requirePermission, type AuthRequest } from "../../middleware/auth";
import { Permission, TicketStatus } from "@C7NTAX/shared";
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
    if (boardId) {
      where.boardId = boardId;
      // If the board has a ticketCode, prefix-filter ticket numbers
      const board = await prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { ticketCode: true } });
      if (board?.ticketCode) {
        where.ticketNumber = { startsWith: `${board.ticketCode}-` };
      }
    }
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
        company: true, contact: { select: { id: true, firstName: true, lastName: true, email: true } }, assignedTo: true, board: true,
        comments: { orderBy: { createdAt: "desc" }, include: { author: { select: { id: true, firstName: true, lastName: true } } } },
        timeEntries: { orderBy: { date: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true } } } },
        serviceAgreement: { select: { id: true, name: true, billingPeriod: true, billingAmount: true } },
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
    const { title, description, boardId, companyId, priority, source, startTime, endTime, contactId, assignedToId } = req.body;
    if (!title || !boardId) throw new AppError("title and boardId required");
    const board = await prisma.serviceBoard.findUnique({ where: { id: boardId } });
    if (!board) throw new AppError("Service board not found", 404);

    // Generate ticket number: ClientType-ClientID-Sequential (e.g. MSP-1001-1003)
    let ticketNumber = `C7-${Date.now().toString(36).toUpperCase()}-${uuid().slice(0, 4).toUpperCase()}`;
    if (companyId) {
      const company = await prisma.company.findUnique({ where: { id: companyId }, select: { clientId: true, clientType: true } });
      if (company?.clientId) {
        const ct = company.clientType || "MSP";
        const count = await prisma.ticket.count({ where: { companyId } });
        const seq = 1000 + count + 1;
        ticketNumber = `${ct}-${company.clientId}-${seq}`;
      }
    }
    const autoPriority = priority || extractPriority(title, description || "");

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber, title, description: description || "", boardId, companyId: companyId || req.user!.companyId,
        priority: autoPriority, source: source || "portal",
        status: TicketStatus.New,
        createdById: req.user!.userId,
        startTime: startTime ? new Date(startTime) : null,
        endTime: endTime ? new Date(endTime) : null,
        contactId: contactId || null,
        assignedToId: assignedToId || null,
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

    const allowed = ["title", "description", "status", "priority", "boardId", "assignedToId", "dueDate", "startTime", "endTime", "contactId", "companyId", "serviceAgreementId"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) {
      if (req.body[key] !== undefined) updates[key] = req.body[key];
    }
    // Handle date conversions
    if (req.body.startTime) updates.startTime = new Date(req.body.startTime);
    if (req.body.endTime) updates.endTime = new Date(req.body.endTime);
    if (req.body.dueDate) updates.dueDate = new Date(req.body.dueDate);

    const updated = await prisma.ticket.update({ where: { id: req.params.id }, data: updates });

    // ── Audit log: detect changes and create a comment ──
    const changedFields: string[] = [];
    const labels: Record<string, string> = { title: "Title", description: "Description", status: "Status", priority: "Priority", boardId: "Board", assignedToId: "Assigned To", dueDate: "Due Date", startTime: "Start Time", endTime: "End Time", contactId: "Contact", companyId: "Company", serviceAgreementId: "Service Agreement" };
    for (const key of allowed) {
      if (req.body[key] !== undefined) {
        const oldVal = (ticket as Record<string, unknown>)[key];
        const newVal = updates[key];
        const oldStr = oldVal instanceof Date ? oldVal.toISOString().slice(0, 16) : String(oldVal ?? "(empty)");
        const newStr = newVal instanceof Date ? newVal.toISOString().slice(0, 16) : String(newVal ?? "(empty)");
        if (oldStr !== newStr) {
          const label = labels[key] || key;
          changedFields.push(`${label}: ${oldStr} → ${newStr}`);
        }
      }
    }
    if (changedFields.length > 0) {
      await prisma.ticketComment.create({
        data: {
          ticketId: req.params.id,
          body: changedFields.join("\n"),
          authorId: req.user!.userId,
          isInternal: true,
        },
      });
    }

    if (updates.status && updates.status !== oldStatus) {
      await onTicketStatusChange(req.params.id, updates.status as TicketStatus, oldStatus);
    }

    // Add comment if provided
    if (req.body.note) {
      await prisma.ticketComment.create({
        data: { ticketId: req.params.id, body: req.body.note, authorId: req.user!.userId, isInternal: req.body.noteInternal || false },
      });
    }

    res.json(updated);
  } catch (e) { next(e); }
});

// ── Add comment to ticket ──
ticketsRouter.post("/:id/notes", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { content, isInternal } = req.body;
    if (!content) throw new AppError("content required");
    const note = await prisma.ticketComment.create({
      data: { ticketId: req.params.id, body: content, authorId: req.user!.userId, isInternal: isInternal || false },
    });
    res.status(201).json(note);
  } catch (e) { next(e); }
});

// ── Add time entry ──
ticketsRouter.post("/:id/time", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { startTime, endTime, description, billable, minutes, date } = req.body;
    let mins = 0;
    if (minutes) {
      mins = Math.round(Number(minutes));
    } else if (startTime && endTime) {
      mins = Math.round((new Date(endTime).getTime() - new Date(startTime).getTime()) / 60000);
    }
    if (!mins || mins <= 0) throw new AppError("Valid time required");
    const entry = await prisma.timeEntry.create({
      data: { ticketId: req.params.id, userId: req.user!.userId, minutes: mins, date: date ? new Date(date) : new Date(), description: description || "", billable: billable ?? true },
    });
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

// ── Batch update tickets ──
ticketsRouter.post("/batch", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { ticketIds, status, priority } = req.body;
    if (!ticketIds || !Array.isArray(ticketIds) || ticketIds.length === 0) throw new AppError("ticketIds array required", 400);
    const data: Record<string, unknown> = {};
    if (status) data.status = status;
    if (priority) data.priority = priority;
    if (Object.keys(data).length === 0) throw new AppError("status or priority required", 400);
    const result = await prisma.ticket.updateMany({ where: { id: { in: ticketIds } }, data });
    res.json({ updated: result.count, ticketIds });
  } catch (e) { next(e); }
});
