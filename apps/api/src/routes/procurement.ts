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
    const v = await prisma.vendor.create({ data: { name: req.body.name, contactName: req.body.contactName || null, email: req.body.email || null, phone: req.body.phone || null, website: req.body.website || null, address: req.body.address || null, taxId: req.body.taxId || null, paymentTerms: req.body.paymentTerms || null, notes: req.body.notes || null } });
    res.status(201).json(v);
  } catch (e) { next(e); }
});

// A vendor's own record is a config: who to call, on what terms, and against which tax id. Editing it
// is deliberately not the same permission as reading it, because these are the details that end up on
// a purchase order somebody else is paying.
procurementRouter.patch("/vendors/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "contactName", "email", "phone", "website", "address", "taxId", "paymentTerms", "notes", "isActive"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (!Object.keys(updates).length) throw new AppError("Nothing to update", 400);
    if (typeof updates.name === "string" && !updates.name.trim()) throw new AppError("A vendor needs a name", 400);
    res.json(await prisma.vendor.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});

/** The four states a purchase order moves through, in order. */
const PO_STATUSES = ["draft", "ordered", "shipped", "received"] as const;

// Purchase Orders
procurementRouter.get("/orders", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {  try {
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

/*
 * One purchase order, in full.
 *
 * The list deliberately carries only what a row needs; this is the record — the lines as they were
 * ordered, the vendor's own details, who raised it and who approved it, and the dates that say whether
 * it is late. Kept separate from the list route so the detail can grow without making every row of the
 * list pay for it.
 */
procurementRouter.get("/orders/:id", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const order = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!order) throw new AppError("Purchase order not found", 404);
    const [vendor, lineItems, createdBy, approvedBy] = await Promise.all([
      prisma.vendor.findUnique({ where: { id: order.vendorId } }),
      prisma.pOLineItem.findMany({ where: { poId: order.id }, orderBy: { description: "asc" } }),
      prisma.user.findUnique({ where: { id: order.createdById }, select: { id: true, firstName: true, lastName: true, email: true } }),
      order.approvedById
        ? prisma.user.findUnique({ where: { id: order.approvedById }, select: { id: true, firstName: true, lastName: true } })
        : Promise.resolve(null),
    ]);
    const productIds = [...new Set(lineItems.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
    const products = productIds.length
      ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true } })
      : [];
    res.json({
      ...order,
      vendor,
      lineItems: lineItems.map((line) => ({ ...line, sku: products.find((p) => p.id === line.productId)?.sku ?? null })),
      createdBy,
      approvedBy,
    });
  } catch (e) { next(e); }
});

procurementRouter.post("/orders", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { vendorId, lineItems, items: bodyItems } = req.body;
    if (!vendorId) throw new AppError("vendorId required");
    const poNumber = `PO-${Date.now().toString(36).toUpperCase()}`;
    let subtotal = 0;
    const items = [...(lineItems || []), ...(bodyItems || [])].map((li: { description: string; quantity: number; unitPrice: number; productId?: string }) => {
      const total = li.quantity * li.unitPrice;
      subtotal += total;
      return { description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total, productId: li.productId ? String(li.productId) : null };
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
    const existing = await prisma.purchaseOrder.findUnique({ where: { id: req.params.id } });
    if (!existing) throw new AppError("Purchase order not found", 404);
    const allowed = ["status", "expectedAt", "receivedAt", "notes"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (req.body.expectedAt) updates.expectedAt = new Date(req.body.expectedAt);
    if (req.body.receivedAt) updates.receivedAt = new Date(req.body.receivedAt);
    if (req.body.approvedById) updates.approvedById = req.body.approvedById;
    if (updates.status !== undefined && !PO_STATUSES.includes(String(updates.status) as (typeof PO_STATUSES)[number])) {
      throw new AppError(`Status must be one of ${PO_STATUSES.join(", ")}`, 400);
    }

    // The dates a status implies, written for whoever reads the record later: ordered when it was
    // placed, received when it turned up. Sent explicitly, they win — that is how a late delivery is
    // recorded as the date it actually arrived rather than the day somebody typed it in.
    if (updates.status === "ordered" && !existing.orderedAt && !updates.receivedAt) updates.orderedAt = new Date();
    if (updates.status === "received" && !updates.receivedAt) updates.receivedAt = new Date();
    if (updates.status && updates.status !== "received" && existing.receivedAt && (updates.status === "ordered" || updates.status === "shipped")) {
      updates.receivedAt = null;
    }

    /*
     * Editing the lines rewrites the order.
     *
     * Allowed while the order is still being placed — draft or ordered — and refused once it has been
     * received, because a received order is a record of what arrived: changing its lines afterwards
     * would make the receipt say something that never happened. Totals are recomputed from the lines
     * rather than trusted from the request, so the header can never disagree with the body.
     */
    const lineItems = Array.isArray(req.body?.lineItems) ? req.body.lineItems : null;
    if (lineItems) {
      if (existing.status === "received") throw new AppError("A received purchase order cannot be re-priced", 400);
      const lines = lineItems
        .map((line: { description?: unknown; quantity?: unknown; unitPrice?: unknown; productId?: unknown }) => ({
          description: String(line.description ?? "").trim(),
          quantity: Number(line.quantity) || 0,
          unitPrice: Number(line.unitPrice) || 0,
          productId: line.productId ? String(line.productId) : null,
        }))
        .filter((line: { description: string }) => line.description.length > 0);
      if (!lines.length) throw new AppError("A purchase order needs at least one line", 400);
      const subtotal = lines.reduce((sum: number, line: { quantity: number; unitPrice: number }) => sum + line.quantity * line.unitPrice, 0);
      const taxTotal = Number(existing.taxTotal) || 0;
      updates.subtotal = subtotal;
      updates.total = subtotal + taxTotal;
      const [, , updated] = await prisma.$transaction([
        prisma.pOLineItem.deleteMany({ where: { poId: existing.id } }),
        prisma.pOLineItem.createMany({
          data: lines.map((line: { description: string; quantity: number; unitPrice: number; productId: string | null }) => ({
            poId: existing.id,
            description: line.description,
            quantity: line.quantity,
            unitPrice: line.unitPrice,
            total: line.quantity * line.unitPrice,
            productId: line.productId,
          })),
        }),
        prisma.purchaseOrder.update({ where: { id: existing.id }, data: updates }),
      ]);
      return res.json(updated);
    }

    res.json(await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: updates }));
  } catch (e) { next(e); }
});
