import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";

export const alertsRouter = Router();
alertsRouter.use(authenticate);

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
