import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const inventoryRouter = Router();
inventoryRouter.use(authenticate);

inventoryRouter.get("/assets", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    const { type, status, companyId, search, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.type = type;
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (search) where.OR = [{ name: { contains: search } }, { assetTag: { contains: search } }, { serialNumber: { contains: search } }];
    const [data, total] = await Promise.all([
      prisma.asset.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" } }),
      prisma.asset.count({ where }),
    ]);
    res.json({ data, total });
  } catch (e) { next(e); }
});

inventoryRouter.post("/assets", requirePermission(Permission.TicketCreate), async (req: AuthRequest, res, next) => {
  try {
    const { name, assetTag, type, serialNumber, model, manufacturer, purchaseDate, purchasePrice, warrantyExpiry, location, companyId } = req.body;
    if (!name || !assetTag || !type) throw new AppError("name, assetTag, and type required");
    const asset = await prisma.asset.create({ data: { name, assetTag, type, serialNumber: serialNumber || null, model: model || null, manufacturer: manufacturer || null, purchaseDate: purchaseDate ? new Date(purchaseDate) : null, purchasePrice: purchasePrice || null, warrantyExpiry: warrantyExpiry ? new Date(warrantyExpiry) : null, location: location || null, companyId: companyId || null } });
    res.status(201).json(asset);
  } catch (e) { next(e); }
});

inventoryRouter.patch("/assets/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["status","location","companyId","notes","warrantyExpiry","purchasePrice"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.warrantyExpiry) updates.warrantyExpiry = new Date(req.body.warrantyExpiry);
    res.json(await prisma.asset.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});

// Assignments
inventoryRouter.get("/assets/:id/assignments", requirePermission(Permission.TicketView), async (req: AuthRequest, res, next) => {
  try {
    res.json(await prisma.assetAssignment.findMany({ where: { assetId: req.params.id }, orderBy: { checkedOutAt: "desc" }, include: { assignedTo: { select: { id: true, firstName: true, lastName: true } }, ticket: { select: { id: true, ticketNumber: true } } } }));
  } catch (e) { next(e); }
});

inventoryRouter.post("/assets/:id/checkout", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    // Set asset to assigned
    await prisma.asset.update({ where: { id: req.params.id }, data: { status: "assigned" } });
    const assignment = await prisma.assetAssignment.create({ data: { assetId: req.params.id, assignedToId: req.body.assignedToId || null, ticketId: req.body.ticketId || null, notes: req.body.notes || null } });
    res.status(201).json(assignment);
  } catch (e) { next(e); }
});

inventoryRouter.post("/assignments/:id/checkin", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const assignment = await prisma.assetAssignment.update({ where: { id: req.params.id }, data: { checkedInAt: new Date() } });
    await prisma.asset.update({ where: { id: assignment.assetId }, data: { status: "available" } });
    res.json(assignment);
  } catch (e) { next(e); }
});
