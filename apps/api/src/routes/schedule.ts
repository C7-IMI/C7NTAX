import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const scheduleRouter = Router();
scheduleRouter.use(authenticate);

scheduleRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { userId, from, to, limit = "200" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    if (from || to) {
      where.startTime = {};
      if (from) (where.startTime as Record<string, unknown>).gte = new Date(from);
      if (to) (where.startTime as Record<string, unknown>).lte = new Date(to);
    }
    const entries = await prisma.scheduleEntry.findMany({ where, take: Number(limit), orderBy: { startTime: "asc" }, include: { user: { select: { id: true, firstName: true, lastName: true } }, ticket: { select: { id: true, ticketNumber: true, title: true } } } });
    res.json(entries);
  } catch (e) { next(e); }
});

scheduleRouter.post("/", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { title, startTime, endTime, userId, ticketId, location } = req.body;
    if (!title || !startTime || !endTime) throw new AppError("title, startTime, endTime required");
    const entry = await prisma.scheduleEntry.create({ data: { title, startTime: new Date(startTime), endTime: new Date(endTime), userId: userId || req.user!.userId, ticketId: ticketId || null, location: location || null, description: req.body.description || null } });
    res.status(201).json(entry);
  } catch (e) { next(e); }
});

scheduleRouter.patch("/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["status","startTime","endTime","location"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.startTime) updates.startTime = new Date(req.body.startTime);
    if (req.body.endTime) updates.endTime = new Date(req.body.endTime);
    res.json(await prisma.scheduleEntry.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});

// Skills
scheduleRouter.get("/skills", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { userId } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (userId) where.userId = userId;
    res.json(await prisma.technicianSkill.findMany({ where, include: { user: { select: { id: true, firstName: true, lastName: true } } } }));
  } catch (e) { next(e); }
});

scheduleRouter.post("/skills", requirePermission(Permission.UserManage), async (req: AuthRequest, res, next) => {
  try {
    const skill = await prisma.technicianSkill.create({ data: { userId: req.body.userId, skill: req.body.skill, level: req.body.level || 1 } });
    res.status(201).json(skill);
  } catch (e) { next(e); }
});
