import { Router } from "express";
import { prisma } from "../index";
import { authenticate, type AuthRequest } from "../middleware/auth";
export const ptoRouter = Router(); ptoRouter.use(authenticate);

ptoRouter.get("/", async (req: AuthRequest, res, next) => {
  try { res.json(await prisma.ptoRequest.findMany({ where: { userId: req.user!.userId }, orderBy: { startDate: "desc" } })); }
  catch (e) { next(e); }
});

ptoRouter.get("/all", async (req: AuthRequest, res, next) => {
  try { const { status, userId } = req.query as Record<string, string>; const where: Record<string, unknown> = {}; if (status) where.status = status; if (userId) where.userId = userId;
    const requests = await prisma.ptoRequest.findMany({ where, orderBy: { startDate: "desc" } });
    // PtoRequest stores userId/approvedById as scalars (no relations) — join manually
    const userIds = [...new Set(requests.map((r) => r.userId))];
    const approverIds = [...new Set(requests.map((r) => r.approvedById).filter(Boolean))] as string[];
    const [users, approvers] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, firstName: true, lastName: true } }),
      prisma.user.findMany({ where: { id: { in: approverIds } }, select: { id: true, firstName: true, lastName: true } }),
    ]);
    const userMap = new Map(users.map((u) => [u.id, u]));
    const approverMap = new Map(approvers.map((u) => [u.id, u]));
    res.json(requests.map((r) => ({ ...r, user: userMap.get(r.userId) ?? null, approvedBy: r.approvedById ? approverMap.get(r.approvedById) ?? null : null }))); }
  catch (e) { next(e); }
});

ptoRouter.post("/", async (req: AuthRequest, res, next) => {
  try { const r = await prisma.ptoRequest.create({ data: { userId: req.user!.userId, type: req.body.type || "vacation", startDate: new Date(req.body.startDate), endDate: new Date(req.body.endDate), hours: req.body.hours, reason: req.body.reason || null } });
    res.status(201).json(r); }
  catch (e) { next(e); }
});

ptoRouter.patch("/:id", async (req: AuthRequest, res, next) => {
  try { const allowed = ["status","approvedById","deniedReason"]; const updates: Record<string, unknown> = {}; for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k]; if (updates.status === "approved") { updates.approvedById = req.user!.userId; updates.approvedAt = new Date(); }
    res.json(await prisma.ptoRequest.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});

// Holidays
ptoRouter.get("/holidays", async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.holiday.findMany({ orderBy: { date: "asc" } })); }
  catch (e) { next(e); }
});

ptoRouter.post("/holidays", async (req: AuthRequest, res, next) => {
  try { const h = await prisma.holiday.create({ data: { name: req.body.name, date: new Date(req.body.date), recurring: req.body.recurring ?? true, country: req.body.country || "US" } }); res.status(201).json(h); }
  catch (e) { next(e); }
});
