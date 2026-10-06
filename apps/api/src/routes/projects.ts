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
      prisma.project.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" } }),
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
    const p = await prisma.project.findUnique({ where: { id: req.params.id } });
    if (!p) throw new AppError("Not found", 404);
    const phases = await prisma.projectPhase.findMany({ where: { projectId: p.id }, orderBy: { sortOrder: "asc" } });
    const tasks = phases.length
      ? await prisma.projectTask.findMany({ where: { phaseId: { in: phases.map(ph => ph.id) } }, orderBy: { sortOrder: "asc" } })
      : [];
    const linkedTicketIds = tasks.map(t => t.ticketId).filter((id): id is string => Boolean(id));
    const [tickets, company, manager] = await Promise.all([
      linkedTicketIds.length ? prisma.ticket.findMany({ where: { id: { in: linkedTicketIds } }, select: { id: true, ticketNumber: true, title: true, status: true } }) : Promise.resolve([]),
      prisma.company.findUnique({ where: { id: p.companyId } }),
      p.managerId ? prisma.user.findUnique({ where: { id: p.managerId }, select: { id: true, firstName: true, lastName: true } }) : Promise.resolve(null),
    ]);
    res.json({ ...p, phases: phases.map(ph => ({ ...ph, tasks: tasks.filter(t => t.phaseId === ph.id) })), tickets, company, manager });
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
