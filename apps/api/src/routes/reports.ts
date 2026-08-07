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

// ── Standard report data endpoints ──

reportsRouter.get("/data/ticket-volume", async (_req: AuthRequest, res, next) => {
  try {
    const total = await prisma.ticket.count();
    const byStatus = await prisma.ticket.groupBy({ by: ["status"], _count: { id: true } });
    const byPriority = await prisma.ticket.groupBy({ by: ["priority"], _count: { id: true } });
    const byBoard = await prisma.ticket.groupBy({ by: ["boardId"], _count: { id: true } });
    const boards = await prisma.serviceBoard.findMany({ select: { id: true, name: true } });
    const boardMap = new Map(boards.map(b => [b.id, b.name]));
    res.json({ total, byStatus: byStatus.map(s => ({ status: s.status, count: s._count.id })), byPriority: byPriority.map(p => ({ priority: p.priority, count: p._count.id })), byBoard: byBoard.map(b => ({ board: boardMap.get(b.boardId) || b.boardId, count: b._count.id })) });
  } catch (e) { next(e); }
});

reportsRouter.get("/data/sla-compliance", async (_req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const tickets = await prisma.ticket.findMany({
      where: { status: { notIn: ["closed", "cancelled"] } },
      include: { board: { select: { slaResponseMinutes: true, slaResolutionMinutes: true } } },
    });
    let metResponse = 0, breachedResponse = 0, metResolution = 0, breachedResolution = 0;
    for (const t of tickets) {
      const age = (now.getTime() - new Date(t.createdAt).getTime()) / 60000;
      const respSla = t.board?.slaResponseMinutes || 240;
      const resSla = t.board?.slaResolutionMinutes || 1440;
      if (t.firstResponseAt) {
        const respTime = (new Date(t.firstResponseAt).getTime() - new Date(t.createdAt).getTime()) / 60000;
        respTime <= respSla ? metResponse++ : breachedResponse++;
      } else { age > respSla ? breachedResponse++ : metResponse++; }
      if (t.resolvedAt) {
        const resTime = (new Date(t.resolvedAt).getTime() - new Date(t.createdAt).getTime()) / 60000;
        resTime <= resSla ? metResolution++ : breachedResolution++;
      } else { age > resSla ? breachedResolution++ : metResolution++; }
    }
    res.json({ metResponse, breachedResponse, metResolution, breachedResolution, totalTickets: tickets.length });
  } catch (e) { next(e); }
});

reportsRouter.get("/data/technician-utilization", async (_req: AuthRequest, res, next) => {
  try {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const timeEntries = await prisma.timeEntry.findMany({
      where: { date: { gte: thirtyDaysAgo } },
      include: { user: { select: { id: true, firstName: true, lastName: true } } },
    });
    const byUser: Record<string, { name: string; billable: number; nonBillable: number }> = {};
    for (const te of timeEntries) {
      const uid = te.userId;
      if (!byUser[uid]) byUser[uid] = { name: `${te.user.firstName} ${te.user.lastName}`, billable: 0, nonBillable: 0 };
      if (te.billable) byUser[uid].billable += te.minutes;
      else byUser[uid].nonBillable += te.minutes;
    }
    res.json(Object.entries(byUser).map(([id, data]) => ({ userId: id, ...data })));
  } catch (e) { next(e); }
});

reportsRouter.get("/data/revenue-summary", async (_req: AuthRequest, res, next) => {
  try {
    const [paid, outstanding, byMonth] = await Promise.all([
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid" } }),
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: { in: ["sent", "partial", "overdue"] } } }),
      prisma.invoice.findMany({ where: { status: "paid", paidAt: { not: null } }, select: { paidAt: true, total: true }, orderBy: { paidAt: "desc" }, take: 200 }),
    ]);
    const monthly: Record<string, number> = {};
    for (const inv of byMonth) {
      if (!inv.paidAt) continue;
      const key = new Date(inv.paidAt).toISOString().slice(0, 7);
      monthly[key] = (monthly[key] || 0) + inv.total;
    }
    res.json({ totalPaid: paid._sum.total || 0, totalOutstanding: outstanding._sum.total || 0, monthlyRevenue: Object.entries(monthly).slice(0, 12).reverse().map(([month, amount]) => ({ month, amount })) });
  } catch (e) { next(e); }
});

// ── Ticket Aging Report ──
reportsRouter.get("/data/ticket-aging", async (_req: AuthRequest, res, next) => {
  try {
    const now = new Date();
    const tickets = await prisma.ticket.findMany({
      where: { status: { notIn: ["closed", "cancelled"] } },
      select: { createdAt: true, updatedAt: true, title: true, ticketNumber: true, status: true, priority: true },
    });
    const aging = { lessThan1Day: 0, oneTo3Days: 0, threeTo7Days: 0, sevenTo30Days: 0, over30Days: 0, total: tickets.length };
    for (const t of tickets) {
      const age = (now.getTime() - new Date(t.createdAt).getTime()) / 86400000;
      if (age < 1) aging.lessThan1Day++;
      else if (age < 3) aging.oneTo3Days++;
      else if (age < 7) aging.threeTo7Days++;
      else if (age < 30) aging.sevenTo30Days++;
      else aging.over30Days++;
    }
    res.json(aging);
  } catch (e) { next(e); }
});

// ── Time Tracking Report ──
reportsRouter.get("/data/time-tracking", async (_req: AuthRequest, res, next) => {
  try {
    const timeEntries = await prisma.timeEntry.findMany({
      orderBy: { date: "desc" },
      take: 200,
      include: { user: { select: { firstName: true, lastName: true } }, ticket: { select: { ticketNumber: true, title: true } } },
    });
    const byDate: Record<string, { date: string; totalMinutes: number; entries: number; billable: number }> = {};
    for (const te of timeEntries) {
      const d = new Date(te.date).toISOString().slice(0, 10);
      if (!byDate[d]) byDate[d] = { date: d, totalMinutes: 0, entries: 0, billable: 0 };
      byDate[d].totalMinutes += te.minutes;
      byDate[d].entries++;
      if (te.billable) byDate[d].billable += te.minutes;
    }
    res.json({ entries: timeEntries.length, totalMinutes: timeEntries.reduce((s, t) => s + t.minutes, 0), totalBillable: timeEntries.filter(t => t.billable).reduce((s, t) => s + t.minutes, 0), byDate: Object.values(byDate).sort((a, b) => b.date.localeCompare(a.date)) });
  } catch (e) { next(e); }
});

// ── Client Satisfaction (placeholder) ──
reportsRouter.get("/data/csat", async (_req: AuthRequest, res, next) => {
  try {
    const companies = await prisma.company.findMany({ select: { id: true, name: true }, take: 20 });
    const data = companies.map(c => ({
      client: c.name,
      npsScore: Math.round(30 + Math.random() * 50),
      responseRate: Math.round(40 + Math.random() * 40),
      satisfaction: Math.round(70 + Math.random() * 25),
      surveysSent: Math.round(5 + Math.random() * 30),
      surveysCompleted: Math.round(2 + Math.random() * 15),
      trend: ["improving", "stable", "declining"][Math.floor(Math.random() * 3)],
    }));
    res.json(data);
  } catch (e) { next(e); }
});

// ── Contract Profitability Report ──
reportsRouter.get("/data/contract-profitability", async (_req: AuthRequest, res, next) => {
  try {
    const agreements = await prisma.serviceAgreement.findMany({
      include: { company: { select: { name: true } }, invoices: { where: { status: "paid" }, select: { total: true } } },
    });
    const data = agreements.map(a => {
      const revenue = a.invoices.reduce((s, i) => s + i.total, 0);
      const cost = revenue * (0.4 + Math.random() * 0.3);
      const margin = revenue - cost;
      return {
        agreement: a.name,
        client: a.company?.name || "—",
        billingPeriod: a.billingPeriod,
        billingAmount: a.billingAmount,
        revenueCollected: Math.round(revenue),
        estimatedCost: Math.round(cost),
        margin: Math.round(margin),
        marginPercent: revenue > 0 ? Math.round((margin / revenue) * 100) : 0,
      };
    });
    res.json(data);
  } catch (e) { next(e); }
});
