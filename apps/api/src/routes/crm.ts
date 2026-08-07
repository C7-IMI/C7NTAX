import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const crmRouter = Router();
crmRouter.use(authenticate);

// ── Opportunities ──
crmRouter.get("/opportunities", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { stage, companyId, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (stage) where.stage = stage;
    if (companyId) where.companyId = companyId;
    const [data, total] = await Promise.all([
      prisma.opportunity.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" } }),
      prisma.opportunity.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) { next(e); }
});

crmRouter.post("/opportunities", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, companyId, stage, probability, amount, expectedCloseDate } = req.body;
    if (!name || !companyId) throw new AppError("name and companyId required");
    const opp = await prisma.opportunity.create({ data: { name, companyId, stage: stage || "prospect", probability: probability || 0, amount: amount || 0, expectedCloseDate: expectedCloseDate ? new Date(expectedCloseDate) : null, assignedToId: req.body.assignedToId || req.user!.userId } });
    res.status(201).json(opp);
  } catch (e) { next(e); }
});

crmRouter.patch("/opportunities/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name","stage","probability","amount","expectedCloseDate","assignedToId","notes"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.expectedCloseDate) updates.expectedCloseDate = new Date(req.body.expectedCloseDate);
    if (req.body.closedAt) updates.closedAt = new Date(req.body.closedAt);
    const opp = await prisma.opportunity.update({ where: { id: req.params.id }, data: updates });
    res.json(opp);
  } catch (e) { next(e); }
});

// ── Sales Activities ──
crmRouter.get("/opportunities/:id/activities", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const activities = await prisma.salesActivity.findMany({ where: { opportunityId: req.params.id }, orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, firstName: true, lastName: true } } } });
    res.json(activities);
  } catch (e) { next(e); }
});

crmRouter.post("/opportunities/:id/activities", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { type, subject, body, scheduledAt } = req.body;
    if (!type || !subject) throw new AppError("type and subject required");
    const activity = await prisma.salesActivity.create({ data: { opportunityId: req.params.id, type, subject, body: body || "", userId: req.user!.userId, scheduledAt: scheduledAt ? new Date(scheduledAt) : null } });
    res.status(201).json(activity);
  } catch (e) { next(e); }
});
