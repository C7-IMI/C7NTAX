import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
export const bulkRouter = Router(); bulkRouter.use(authenticate);

bulkRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const { type, entity, config, ids } = req.body;
    if (!type || !entity) throw new AppError("type and entity required");
    const op = await prisma.bulkOperation.create({ data: { type, entity, config, createdById: req.user!.userId, totalCount: (ids || []).length } });
    // Kick off async processing (simplified — real impl uses BullMQ)
    processBulk(op.id, type, entity, ids || [], config || {}).catch(console.error);
    res.status(202).json(op); }
  catch (e) { next(e); }
});

bulkRouter.get("/:id", async (req: AuthRequest, res, next) => {
  try { const op = await prisma.bulkOperation.findUnique({ where: { id: req.params.id } }); if (!op) throw new AppError("Not found", 404); res.json(op); }
  catch (e) { next(e); }
});

// Webhooks
bulkRouter.get("/webhooks", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.webhookConfig.findMany()); }
  catch (e) { next(e); }
});

bulkRouter.post("/webhooks", async (req: AuthRequest, res, next) => {
  try { res.status(201).json(await prisma.webhookConfig.create({ data: { name: req.body.name, url: req.body.url, secret: req.body.secret, events: req.body.events || [], isActive: req.body.isActive ?? true } })); }
  catch (e) { next(e); }
});

bulkRouter.delete("/webhooks/:id", async (req: AuthRequest, res, next) => {
  try { await prisma.webhookConfig.delete({ where: { id: req.params.id } }); res.json({ message: "Webhook removed" }); }
  catch (e) { next(e); }
});

// Background processor for bulk operations
async function processBulk(id: string, type: string, entity: string, ids: string[], config: Record<string, unknown>): Promise<void> {
  await prisma.bulkOperation.update({ where: { id }, data: { status: "running", startedAt: new Date() } });
  let success = 0, failure = 0; const errors: string[] = [];
  try {
    for (const itemId of ids) {
      try {
        switch (type) {
          case "ticket_update": await prisma.ticket.update({ where: { id: itemId }, data: config as Record<string, unknown> }); break;
          case "ticket_assign": await prisma.ticket.update({ where: { id: itemId }, data: { assignedToId: config.assignedToId as string } }); break;
          default: break;
        }
        success++;
      } catch (e) { failure++; errors.push(`${itemId}: ${String(e)}`); }
    }
    await prisma.bulkOperation.update({ where: { id }, data: { status: "completed", successCount: success, failureCount: failure, errors, completedAt: new Date() } });
  } catch (e) {
    await prisma.bulkOperation.update({ where: { id }, data: { status: "failed", errors: [String(e)], completedAt: new Date() } });
  }
}
