import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";

export const alertsRouter = Router();
alertsRouter.use(authenticate);

alertsRouter.post("/", async (req: AuthRequest, res, next) => {
  try {
    const { name, entityType, triggerDays, enabled, notifyEmail } = req.body;
    if (!name || !entityType) throw new AppError("name and entityType required", 400);
    const rule = await prisma.alertRule.create({ data: { name, entityType, triggerDays: triggerDays || 30, enabled: enabled !== false, notifyEmail: notifyEmail || null, createdById: req.user!.userId } });
    res.status(201).json(rule);
  } catch (e) { next(e); }
});

alertsRouter.get("/rules", async (_req: AuthRequest, res, next) => {
  try { const rules = await prisma.alertRule.findMany({ orderBy: { name: "asc" } }); res.json({ data: rules }); }
  catch (e) { next(e); }
});

alertsRouter.delete("/rules/:id", async (req: AuthRequest, res, next) => {
  try { await prisma.alertRule.delete({ where: { id: req.params.id } }); res.json({ message: "Deleted" }); }
  catch (e) { next(e); }
});


alertsRouter.get("/", async (_req: AuthRequest, res, next) => {
  try {
    const alerts = await prisma.alertLog.findMany({ where: { dismissed: false }, orderBy: { createdAt: "desc" }, take: 50 });
    res.json({ data: alerts });
  } catch (e) { next(e); }
});

alertsRouter.post("/check", async (_req: AuthRequest, res, next) => {
  try {
    const rules = await prisma.alertRule.findMany({ where: { enabled: true } });
    const results = [];
    const now = new Date();
    for (const rule of rules) {
      const cutoff = new Date(now.getTime() + rule.triggerDays * 86400000);
      let entities: { id: string; name: string }[] = [];
      if (rule.entityType === "domain") {
        const domains = await prisma.kumoDomain.findMany({ where: { expiryDate: { lte: cutoff } }, select: { id: true, domainName: true } });
        entities = domains.map(d => ({ id: d.id, name: d.domainName }));
      } else if (rule.entityType === "certificate") {
        const certs = await prisma.kumoCertificate.findMany({ where: { expiryDate: { lte: cutoff } }, select: { id: true, name: true } });
        entities = certs.map(c => ({ id: c.id, name: c.name }));
      }
      for (const e of entities) {
        const log = await prisma.alertLog.create({ data: { ruleId: rule.id, entityType: rule.entityType, entityId: e.id, message: `${rule.name}: ${e.name} expires soon`, severity: "warning" } });
        results.push(log);
      }
    }
    res.json({ data: results, checked: rules.length });
  } catch (e) { next(e); }
});

alertsRouter.patch("/:id/dismiss", async (req: AuthRequest, res, next) => {
  try {
    await prisma.alertLog.update({ where: { id: req.params.id }, data: { dismissed: true, dismissedBy: req.user!.userId, dismissedAt: new Date() } });
    res.json({ message: "Dismissed" });
  } catch (e) { next(e); }
});
