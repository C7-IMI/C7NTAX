import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@c7-overwatch/shared";
import { AppError } from "../middleware/errorHandler";

export const contractsRouter = Router();
contractsRouter.use(authenticate);

contractsRouter.get("/", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { status, companyId, type, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (type) where.type = type;
    const [data, total] = await Promise.all([
      prisma.contract.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { endDate: "asc" }, include: { company: { select: { id: true, name: true } } } }),
      prisma.contract.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) { next(e); }
});

contractsRouter.post("/", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, companyId, type, startDate, endDate, value, autoRenew } = req.body;
    if (!name || !companyId || !startDate || !endDate) throw new AppError("name, companyId, startDate, endDate required");
    const contractNumber = `CTR-${Date.now().toString(36).toUpperCase()}`;
    const c = await prisma.contract.create({ data: { name, contractNumber, companyId, type: type || "service", startDate: new Date(startDate), endDate: new Date(endDate), value: value || 0, autoRenew: autoRenew || false, renewalDate: req.body.renewalDate ? new Date(req.body.renewalDate) : null } });
    res.status(201).json(c);
  } catch (e) { next(e); }
});

contractsRouter.patch("/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["status","endDate","renewalDate","autoRenew","value","notes"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.endDate) updates.endDate = new Date(req.body.endDate);
    if (req.body.renewalDate) updates.renewalDate = new Date(req.body.renewalDate);
    res.json(await prisma.contract.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});

// Milestones
contractsRouter.get("/:id/milestones", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.contractMilestone.findMany({ where: { contractId: req.params.id }, orderBy: { dueDate: "asc" } })); }
  catch (e) { next(e); }
});

contractsRouter.post("/:id/milestones", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const m = await prisma.contractMilestone.create({ data: { contractId: req.params.id, name: req.body.name, description: req.body.description || null, dueDate: new Date(req.body.dueDate), amount: req.body.amount || null } });
    res.status(201).json(m);
  } catch (e) { next(e); }
});
