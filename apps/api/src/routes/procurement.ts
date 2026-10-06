import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";

export const procurementRouter = Router();
procurementRouter.use(authenticate);

// Vendors
procurementRouter.get("/vendors", requirePermission(Permission.BillingView), async (_req: AuthRequest, res, next) => {
  try { res.json(await prisma.vendor.findMany({ orderBy: { name: "asc" } })); }
  catch (e) { next(e); }
});

procurementRouter.post("/vendors", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const v = await prisma.vendor.create({ data: { name: req.body.name, contactName: req.body.contactName || null, email: req.body.email || null, phone: req.body.phone || null, paymentTerms: req.body.paymentTerms || null } });
    res.status(201).json(v);
  } catch (e) { next(e); }
});

// Purchase Orders
procurementRouter.get("/orders", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { status, vendorId, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (vendorId) where.vendorId = vendorId;
    const [orders, total] = await Promise.all([
      prisma.purchaseOrder.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { updatedAt: "desc" } }),
      prisma.purchaseOrder.count({ where }),
    ]);
    const [vendors, lineItems] = await Promise.all([
      prisma.vendor.findMany({ where: { id: { in: [...new Set(orders.map(o => o.vendorId))] } }, select: { id: true, name: true } }),
      prisma.pOLineItem.findMany({ where: { poId: { in: orders.map(o => o.id) } } }),
    ]);
    const vendorById = new Map(vendors.map(v => [v.id, v]));
    const data = orders.map(o => ({
      ...o,
      vendor: vendorById.get(o.vendorId) ?? null,
      lineItems: lineItems.filter(li => li.poId === o.id),
    }));
    res.json({ data, total });
  } catch (e) { next(e); }
});

procurementRouter.post("/orders", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { vendorId, lineItems, items: bodyItems } = req.body;
    if (!vendorId) throw new AppError("vendorId required");
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    let subtotal = 0;
    const items = [...(lineItems || []), ...(bodyItems || [])].map((li: { description: string; quantity: number; unitPrice: number }) => {
      const total = li.quantity * li.unitPrice;
      subtotal += total;
      return { description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total };
    });
    const po = await prisma.purchaseOrder.create({
      data: { poNumber, vendorId, subtotal, taxTotal: 0, total: subtotal, createdById: req.user!.userId },
    });
    const created = items.length
      ? await prisma.$transaction(items.map(li => prisma.pOLineItem.create({ data: { poId: po.id, ...li } })))
      : [];
    res.status(201).json({ ...po, lineItems: created });
  } catch (e) { next(e); }
});

procurementRouter.patch("/orders/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["status","expectedAt","receivedAt","notes"];
    const updates: Record<string, unknown> = {};
    for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    if (req.body.expectedAt) updates.expectedAt = new Date(req.body.expectedAt);
    if (req.body.receivedAt) updates.receivedAt = new Date(req.body.receivedAt);
    if (req.body.approvedById) updates.approvedById = req.body.approvedById;
    res.json(await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});
