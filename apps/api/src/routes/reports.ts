import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
export const reportsRouter = Router(); reportsRouter.use(authenticate);

reportsRouter.get("/", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.report.findMany({ orderBy: { name: "asc" }, include: { createdBy: { select: { firstName: true, lastName: true } }, schedules: true } })); }
  catch (e) { next(e); }
});

reportsRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const r = await prisma.report.create({ data: { name: req.body.name, description: req.body.description || null, type: req.body.type || "custom", config: req.body.config || {}, createdById: req.user!.userId } }); res.status(201).json(r); }
  catch (e) { next(e); }
});

reportsRouter.get("/:id/run", async (req: AuthRequest, res, next) => {
  try { const report = await prisma.report.findUnique({ where: { id: req.params.id } }); if (!report) { res.status(404).json({ error: "Not found" }); return; }
    // Run report based on type
    let data: unknown[] = [];
    switch (report.type) {
      case "ticket_summary": data = await prisma.ticket.findMany({ take: 500, orderBy: { createdAt: "desc" }, select: { ticketNumber: true, title: true, status: true, priority: true, createdAt: true } }); break;
      case "revenue": data = await prisma.invoice.findMany({ where: { status: "paid" }, take: 500, select: { invoiceNumber: true, total: true, paidAt: true, company: { select: { name: true } } } }); break;
      default: data = [];
    }
    res.json({ report: report.name, type: report.type, generatedAt: new Date().toISOString(), data }); }
  catch (e) { next(e); }
});

reportsRouter.post("/:id/schedules", async (req: AuthRequest, res, next) => {
  try { const s = await prisma.reportSchedule.create({ data: { reportId: req.params.id, frequency: req.body.frequency, dayOfWeek: req.body.dayOfWeek || null, dayOfMonth: req.body.dayOfMonth || null, timeOfDay: req.body.timeOfDay, recipients: req.body.recipients, format: req.body.format || "pdf" } }); res.status(201).json(s); }
  catch (e) { next(e); }
});
