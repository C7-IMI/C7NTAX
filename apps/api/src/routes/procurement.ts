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

/**
 * How many asset records one line may create.
 *
 * An asset is a thing with a tag somebody sticks on it, so a line of twelve SSDs is twelve records and
 * a line of a thousand patch leads is not a thousand records — it is stock, and the inventory would
 * become unreadable. Past the cap the line is recorded once and the count is written into the order's
 * notes, which is honest about what was not itemised rather than quietly dropping it.
 */
const ASSET_UNITS_PER_LINE_CAP = 25;

/** The asset types the inventory knows, so a catalog product's own type lands on one of them. */
const ASSET_TYPES = new Set(["hardware", "software", "license", "server", "laptop", "mobile", "network", "access_point", "switch", "firewall", "printer", "other"]);

type ReceivedLine = { id: string; description: string; quantity: number; unitPrice: number; productId: string | null };

/**
 * Record what arrived, as assets.
 *
 * Receiving an order is the moment the hardware exists as ours: before it, the lines are intentions.
 * So a received order writes one asset per unit — unassigned (`companyId` null, status `available`)
 * until somebody puts it at a client — carrying the price we paid, the date it arrived and the order
 * it came from, which is what makes "where did this come from and what did it cost" answerable later.
 *
 * Idempotent by order number: receiving the same order twice does not double the inventory, and the
 * check is on the `purchaseOrder` field the assets carry rather than on the status, so a re-receive
 * after a manual edit is safe.
 */
async function createAssetsForReceivedOrder(
  order: { id: string; poNumber: string; receivedAt: Date | null; vendorId: string },
  lines: ReceivedLine[],
  vendorName: string | null,
): Promise<{ created: number; skipped: number; capped: Array<{ description: string; quantity: number; recorded: number }> }> {
  const already = await prisma.asset.count({ where: { purchaseOrder: order.poNumber } });
  if (already) return { created: 0, skipped: already, capped: [] };

  const productIds = [...new Set(lines.map((line) => line.productId).filter((id): id is string => Boolean(id)))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, sku: true, name: true, productType: true, category: true, manufacturer: true } })
    : [];
  const receivedOn = order.receivedAt ?? new Date();
  const capped: Array<{ description: string; quantity: number; recorded: number }> = [];
  let created = 0;

  for (const [index, line] of lines.entries()) {
    const product = products.find((p) => p.id === line.productId);
    const wanted = Math.max(1, Math.round(Number(line.quantity) || 1));
    const units = Math.min(wanted, ASSET_UNITS_PER_LINE_CAP);
    if (wanted > units) capped.push({ description: line.description, quantity: wanted, recorded: units });
    const type = product?.productType && ASSET_TYPES.has(product.productType) ? product.productType : "other";
    for (let unit = 0; unit < units; unit += 1) {
      const tag = `${order.poNumber}-${String(index + 1).padStart(2, "0")}-${String(unit + 1).padStart(2, "0")}`;
      const notes = [
        `Received against ${order.poNumber}${vendorName ? ` from ${vendorName}` : ""} on ${receivedOn.toISOString().slice(0, 10)}.`,
        product?.sku ? `Catalog item ${product.sku}.` : null,
        wanted > units ? `One of ${units} record(s) for a line of ${wanted}.` : null,
      ].filter(Boolean).join(" ");
      const asset = await prisma.asset.create({
        data: {
          name: line.description || product?.name || order.poNumber,
          assetTag: tag,
          type,
          category: product?.category ?? null,
          manufacturer: product?.manufacturer ?? null,
          status: "available",
          vendor: vendorName,
          purchaseDate: receivedOn,
          purchasePrice: Number(line.unitPrice) || 0,
          purchaseOrder: order.poNumber,
          notes,
          companyId: null,
        },
        select: { id: true },
      });
      // The line remembers the first asset it produced: `POLineItem.assetId` is one id, so a line of
      // many units records the first and the rest are found by their order number and tag.
      if (unit === 0) await prisma.pOLineItem.update({ where: { id: line.id }, data: { assetId: asset.id } });
      created += 1;
    }
  }
  return { created, skipped: 0, capped };
}

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

    const updated = await prisma.purchaseOrder.update({ where: { id: req.params.id }, data: updates });

    /*
     * Receiving an order is what puts the hardware in the inventory.
     *
     * Done after the status is stored, and best-effort: the receipt is the fact somebody asked for,
     * and an inventory that failed to write must not undo it — the failure is logged, the order stays
     * received, and receiving it again (or the same order number arriving twice) will not duplicate
     * the records, because the assets carry the order number.
     */
    let assets: { created: number; skipped: number } = { created: 0, skipped: 0 };
    if (updates.status === "received" && existing.status !== "received") {
      try {
        const [lines, vendor] = await Promise.all([
          prisma.pOLineItem.findMany({ where: { poId: existing.id } }),
          prisma.vendor.findUnique({ where: { id: existing.vendorId }, select: { name: true } }),
        ]);
        const result = await createAssetsForReceivedOrder(
          { id: existing.id, poNumber: existing.poNumber, receivedAt: (updates.receivedAt as Date) ?? updated.receivedAt, vendorId: existing.vendorId },
          lines,
          vendor?.name ?? null,
        );
        assets = { created: result.created, skipped: result.skipped };
        if (result.capped.length) {
          const note = result.capped
            .map((line) => `${line.recorded} asset record(s) created for ${line.quantity} × ${line.description} — the rest was not itemised.`)
            .join("\n");
          const merged = [updated.notes?.trim(), `Received: ${note}`].filter(Boolean).join("\n\n");
          await prisma.purchaseOrder.update({ where: { id: existing.id }, data: { notes: merged } });
        }
      } catch (error) {
        console.error(`[Procurement] Order ${existing.poNumber} was received but its assets could not be created:`, error instanceof Error ? error.message : error);
      }
    }

    res.json({ ...updated, ...(assets.created || assets.skipped ? { assets } : {}) });
  } catch (e) { next(e); }
});
