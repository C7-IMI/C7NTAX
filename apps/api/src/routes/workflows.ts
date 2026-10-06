import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
export const workflowsRouter = Router(); workflowsRouter.use(authenticate);

workflowsRouter.get("/rules", async (_req: AuthRequest, res, next) => {
  try {
    const rules = await prisma.workflowRule.findMany({ orderBy: { priority: "asc" } });
    const [actions, executionCounts] = await Promise.all([
      prisma.workflowRuleAction.findMany({ where: { ruleId: { in: rules.map(r => r.id) } }, orderBy: { sortOrder: "asc" } }),
      prisma.workflowExecution.groupBy({ by: ["ruleId"], _count: { _all: true } }),
    ]);
    const executionCount = new Map(executionCounts.map(c => [c.ruleId, c._count._all]));
    res.json(rules.map(r => ({ ...r, actions: actions.filter(a => a.ruleId === r.id), _count: { executions: executionCount.get(r.id) ?? 0 } })));
  }
  catch (e) { next(e); }
});

workflowsRouter.post("/rules", async (req: AuthRequest, res, next) => {
  try { const rule = await prisma.workflowRule.create({
    data: { name: req.body.name, description: req.body.description || null, entity: req.body.entity, trigger: req.body.trigger, conditions: req.body.conditions || [], isActive: req.body.isActive ?? true, priority: req.body.priority || 0 },
  });
    const incoming: { type: string; config: unknown; sortOrder: number }[] = req.body.actions || [];
    const actions = incoming.length
      ? await prisma.$transaction(incoming.map(a => prisma.workflowRuleAction.create({ data: { ruleId: rule.id, type: a.type, config: (a.config ?? {}) as object, sortOrder: a.sortOrder || 0 } })))
      : [];
    res.status(201).json({ ...rule, actions }); }
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
