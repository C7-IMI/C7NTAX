import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const projectsRouter = Router();
projectsRouter.use(authenticate);

projectsRouter.get("/", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { status, companyId, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    const [data, total] = await Promise.all([
      prisma.project.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" }, include: { company: { select: { id: true, name: true } }, manager: { select: { id: true, firstName: true, lastName: true } }, _count: { select: { phases: true } } } }),
      prisma.project.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) { next(e); }
});

projectsRouter.post("/", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, companyId, description, startDate, endDate, budget } = req.body;
    if (!name || !companyId) throw new AppError("name and companyId required");
    const p = await prisma.project.create({ data: { name, companyId, description: description || "", startDate: startDate ? new Date(startDate) : null, endDate: endDate ? new Date(endDate) : null, budget: budget || 0, managerId: req.body.managerId || req.user!.userId } });
    res.status(201).json(p);
  } catch (e) { next(e); }
});

projectsRouter.get("/:id", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const p = await prisma.project.findUnique({ where: { id: req.params.id }, include: { phases: { orderBy: { sortOrder: "asc" }, include: { tasks: { orderBy: { sortOrder: "asc" } } } }, tickets: { select: { id: true, ticketNumber: true, title: true, status: true } }, company: true, manager: { select: { id: true, firstName: true, lastName: true } } } });
    if (!p) throw new AppError("Not found", 404);
    res.json(p);
  } catch (e) { next(e); }
});

// Phases
projectsRouter.post("/:id/phases", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const phase = await prisma.projectPhase.create({ data: { projectId: req.params.id, name: req.body.name, description: req.body.description || "", sortOrder: req.body.sortOrder || 0 } });
    res.status(201).json(phase);
  } catch (e) { next(e); }
});

// Tasks
projectsRouter.post("/:projectId/phases/:phaseId/tasks", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const task = await prisma.projectTask.create({ data: { phaseId: req.params.phaseId, name: req.body.name, description: req.body.description || "", sortOrder: req.body.sortOrder || 0, estimatedHours: req.body.estimatedHours || null, assignedToId: req.body.assignedToId || null } });
    res.status(201).json(task);
  } catch (e) { next(e); }
});

projectsRouter.patch("/:projectId/tasks/:taskId", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["status","assignedToId","estimatedHours","actualHours","startDate","endDate"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.startDate) updates.startDate = new Date(req.body.startDate);
    if (req.body.endDate) updates.endDate = new Date(req.body.endDate);
    res.json(await prisma.projectTask.update({ where: { id: req.params.taskId }, data: updates }));
  } catch (e) { next(e); }
});

// Dependencies
projectsRouter.post("/tasks/:taskId/dependencies", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const dep = await prisma.projectTaskDependency.create({ data: { taskId: req.params.taskId, dependsOnId: req.body.dependsOnId, type: req.body.type || "finish_to_start", lagMinutes: req.body.lagMinutes || 0 } });
    res.status(201).json(dep);
  } catch (e) { next(e); }
});
