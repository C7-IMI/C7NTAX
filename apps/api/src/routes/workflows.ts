import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
export const workflowsRouter = Router(); workflowsRouter.use(authenticate);

workflowsRouter.get("/rules", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.workflowRule.findMany({ orderBy: { priority: "asc" }, include: { actions: { orderBy: { sortOrder: "asc" } }, _count: { select: { executions: true } } } })); }
  catch (e) { next(e); }
});

workflowsRouter.post("/rules", async (req: AuthRequest, res, next) => {
  try { const rule = await prisma.workflowRule.create({
    data: { name: req.body.name, description: req.body.description || null, entity: req.body.entity, trigger: req.body.trigger, conditions: req.body.conditions || [], isActive: req.body.isActive ?? true, priority: req.body.priority || 0,
      actions: req.body.actions ? { create: req.body.actions.map((a: { type: string; config: unknown; sortOrder: number }) => ({ type: a.type, config: a.config || {}, sortOrder: a.sortOrder || 0 })) } : undefined,
    },
    include: { actions: true },
  });
    res.status(201).json(rule); }
  catch (e) { next(e); }
});

workflowsRouter.patch("/rules/:id", async (req: AuthRequest, res, next) => {
  try { const allowed = ["name","isActive","priority","conditions","trigger"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    res.json(await prisma.workflowRule.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});

workflowsRouter.get("/rules/:id/executions", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.workflowExecution.findMany({ where: { ruleId: req.params.id }, orderBy: { startedAt: "desc" }, take: 100 })); }
  catch (e) { next(e); }
});
