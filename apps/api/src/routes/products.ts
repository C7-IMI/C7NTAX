/**
 * Product catalog API (Administration → Product Catalog).
 *
 * What this catalog is for: one place that says what an item is called, what it costs, what it
 * sells for and how it is billed — so a ticket, a quote, a purchase order and an invoice all
 * copy the same numbers instead of each typing them again. It follows the shape Autotask,
 * ConnectWise and Scoro converge on: a type (hardware/software/licence/subscription/service/
 * bundle), a category to filter by, a unit, separate cost and sell prices, an optional recurring
 * billing period, a taxable flag, and optional stock with a reorder point.
 *
 * Two rules worth stating because they are not obvious from the fields:
 *
 *   1. **Cost and margin are commercial data.** They are returned only to callers holding
 *      `product:manage` — a technician attaching an item to a ticket needs the sell price, not
 *      what it cost us. `productPriceFields()` is the single place that decides this, so no route
 *      can leak it by accident.
 *   2. **A product that is in use is deactivated, never deleted.** Deleting one would leave a
 *      quote line, a purchase order or an invoice pointing at a SKU that no longer exists; the
 *      delete route refuses and says which kind of record holds it.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission } from "@C7NTAX/shared";

export const productsRouter = Router();

productsRouter.use(authenticate);

/** The values the UI offers; a value outside these would not render correctly. */
export const PRODUCT_TYPES = ["hardware", "software", "license", "subscription", "service", "bundle", "other"];
export const BILLING_PERIODS = ["none", "monthly", "quarterly", "annual"];
export const PRODUCT_UNITS = ["each", "hour", "day", "user", "seat", "month", "licence", "GB"];

/** Cost and margin: the people who maintain the catalog, plus the finance role that buys at cost. */
function seesCost(permissions: string[]): boolean {
  return permissions.includes(Permission.ProductManage) || permissions.includes(Permission.BillingManage);
}

/** The fields a caller may see, with cost withheld when they may not. */
function productPriceFields(permissions: string[]) {
  return seesCost(permissions)
    ? { costPrice: true as const, sellPrice: true as const }
    : { costPrice: false as const, sellPrice: true as const };
}

type ProductRow = {
  costPrice: number;
  sellPrice: number;
  [key: string]: unknown;
};

/**
 * Shapes one row for the wire: cost removed when withheld, and the two derived figures the UI
 * would otherwise recompute (margin, and what a recurring price is worth in a year).
 */
function shapeProduct<T extends ProductRow>(product: T, permissions: string[]) {
  const showCost = seesCost(permissions);
  const { costPrice, sellPrice, ...rest } = product;
  const margin = showCost ? +(sellPrice - costPrice).toFixed(2) : undefined;
  const marginPercent = showCost && sellPrice > 0 ? +(((sellPrice - costPrice) / sellPrice) * 100).toFixed(1) : undefined;
  const annualValue = sellPrice * (BILLING_PERIODS.includes(String(rest.billingPeriod)) && String(rest.billingPeriod) !== "none"
    ? ({ monthly: 12, quarterly: 4, annual: 1 } as Record<string, number>)[String(rest.billingPeriod)] ?? 0
    : 0);
  return {
    ...rest,
    sellPrice,
    ...(showCost ? { costPrice } : {}),
    ...(showCost ? { margin, marginPercent } : {}),
    ...(annualValue > 0 ? { annualValue: +annualValue.toFixed(2) } : {}),
    ...(rest.trackStock ? { belowReorderPoint: Number(rest.reorderPoint ?? 0) > 0 && Number(rest.stockOnHand) <= Number(rest.reorderPoint) } : {}),
  };
}

/** A SKU from the name when one was not supplied: "USB-C Dock" → "USB-C-DOCK". */
function deriveSku(name: string): string {
  const base = name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 28);
  return `${base || "ITEM"}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
}

function numberField(value: unknown, field: string, { min = 0, max = 10_000_000 } = {}): number {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) throw new AppError(`${field} must be a number`);
  if (n < min || n > max) throw new AppError(`${field} must be between ${min} and ${max}`);
  return n;
}

/** Validates and normalises a create/update body. Unknown keys are ignored on purpose. */
function productBody(body: Record<string, unknown>, { partial }: { partial: boolean }) {
  const data: Record<string, unknown> = {};
  const has = (k: string) => body[k] !== undefined && body[k] !== null;

  if (has("name") || !partial) {
    const name = String(body.name ?? "").trim();
    if (!name) throw new AppError("A product name is required");
    if (name.length > 160) throw new AppError("Keep the name under 160 characters");
    data.name = name;
  }
  if (has("sku")) {
    const sku = String(body.sku).trim().toUpperCase();
    if (!sku) throw new AppError("A SKU cannot be blank — remove the field to have one generated");
    if (!/^[A-Z0-9][A-Z0-9._-]{1,39}$/.test(sku)) throw new AppError("A SKU may use letters, digits, dot, dash and underscore (2–40 characters)");
    data.sku = sku;
  } else if (!partial && data.name) {
    data.sku = deriveSku(String(data.name));
  }
  if (has("productType")) {
    const type = String(body.productType);
    if (!PRODUCT_TYPES.includes(type)) throw new AppError(`productType must be one of ${PRODUCT_TYPES.join(", ")}`);
    data.productType = type;
  } else if (!partial) {
    data.productType = "hardware";
  }
  if (has("billingPeriod")) {
    const period = String(body.billingPeriod);
    if (!BILLING_PERIODS.includes(period)) throw new AppError(`billingPeriod must be one of ${BILLING_PERIODS.join(", ")}`);
    data.billingPeriod = period;
  }
  if (has("unit")) {
    const unit = String(body.unit);
    if (!PRODUCT_UNITS.includes(unit)) throw new AppError(`unit must be one of ${PRODUCT_UNITS.join(", ")}`);
    data.unit = unit;
  }
  for (const key of ["description", "category", "subcategory", "manufacturer", "vendorSku", "purchaseUrl", "notes"] as const) {
    if (has(key)) data[key] = String(body[key]).slice(0, 2000) || null;
  }
  if (has("vendorId")) {
    data.vendorId = String(body.vendorId) || null;
  }
  if (has("costPrice")) data.costPrice = numberField(body.costPrice, "Cost price");
  if (has("sellPrice")) data.sellPrice = numberField(body.sellPrice, "Sell price");
  if (!partial && data.sellPrice === undefined) data.sellPrice = 0;
  for (const key of ["taxable", "isActive", "trackStock"] as const) {
    if (body[key] !== undefined) data[key] = Boolean(body[key]);
  }
  for (const key of ["stockOnHand", "reorderPoint", "reorderQuantity", "warrantyMonths"] as const) {
    if (has(key)) data[key] = Math.round(numberField(body[key], key.replace(/([A-Z])/g, " $1").toLowerCase(), { max: 1_000_000 }));
    else if (body[key] === null) data[key] = null;
  }
  // A subscription without a period would price as a one-off; say so rather than storing it.
  const period = data.billingPeriod ?? undefined;
  if (period === "none" && has("productType") && body.productType === "subscription") {
    throw new AppError("A subscription needs a billing period (monthly, quarterly or annual)");
  }
  return data;
}

productsRouter.get("/", requirePermission(Permission.ProductView), async (req: AuthRequest, res, next) => {
  try {
    const { type, category, search, active, lowStock, limit = "200", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (type) where.productType = type;
    if (category) where.category = category;
    if (active === "true") where.isActive = true;
    if (active === "false") where.isActive = false;
    if (search) {
      where.OR = [
        { name: { contains: search, mode: "insensitive" } },
        { sku: { contains: search, mode: "insensitive" } },
        { description: { contains: search, mode: "insensitive" } },
        { manufacturer: { contains: search, mode: "insensitive" } },
        { vendorSku: { contains: search, mode: "insensitive" } },
      ];
    }
    const [products, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: [{ isActive: "desc" }, { name: "asc" }], take: Math.min(Number(limit) || 200, 500), skip: Number(offset) || 0 }),
      prisma.product.count({ where }),
    ]);
    const shaped = products.map(p => shapeProduct(p, req.user!.permissions));
    // A low-stock filter is applied on the shaped rows because "below the reorder point" is a
    // comparison between two columns, which Prisma cannot express in a where clause.
    const data = lowStock === "true" ? shaped.filter(p => p.belowReorderPoint) : shaped;
    res.json({ data, total: lowStock === "true" ? data.length : total });
  } catch (e) { next(e); }
});

/** The filter values the page offers, so the UI never hardcodes a list that has drifted. */
productsRouter.get("/filters", requirePermission(Permission.ProductView), async (_req: AuthRequest, res, next) => {  try {
    const [categories, manufacturers, byType, stock] = await Promise.all([
      prisma.product.findMany({ where: { category: { not: null } }, select: { category: true }, distinct: ["category"], orderBy: { category: "asc" } }),
      prisma.product.findMany({ where: { manufacturer: { not: null } }, select: { manufacturer: true }, distinct: ["manufacturer"], orderBy: { manufacturer: "asc" } }),
      prisma.product.groupBy({ by: ["productType"], _count: true }),
      prisma.product.findMany({ where: { trackStock: true }, select: { stockOnHand: true, reorderPoint: true } }),
    ]);
    res.json({
      productTypes: PRODUCT_TYPES,
      billingPeriods: BILLING_PERIODS,
      units: PRODUCT_UNITS,
      categories: categories.map(c => c.category).filter(Boolean),
      manufacturers: manufacturers.map(m => m.manufacturer).filter(Boolean),
      countsByType: Object.fromEntries(byType.map(t => [t.productType, t._count])),
      lowStock: stock.filter(s => Number(s.reorderPoint ?? 0) > 0 && s.stockOnHand <= Number(s.reorderPoint)).length,
    });
  } catch (e) { next(e); }
});

/**
 * The suppliers a product can be bought from. A separate route from `/procurement/vendors`
 * because that one requires `billing:view` — a catalog manager should not need billing access
 * to record where a part comes from.
 */
productsRouter.get("/suppliers", requirePermission(Permission.ProductView), async (_req: AuthRequest, res, next) => {
  try {
    const vendors = await prisma.vendor.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true } });
    res.json({ data: vendors });
  } catch (e) { next(e); }
});

productsRouter.get("/:id", requirePermission(Permission.ProductView), async (req: AuthRequest, res, next) => {
  try {
    const product = await prisma.product.findUnique({ where: { id: String(req.params.id) } });
    if (!product) throw new AppError("Product not found", 404);
    // Where this item is already in use, so the page can say so and the delete button can explain
    // itself before it is pressed.
    const [quoteLines, poLines, invoiceLines] = await Promise.all([
      prisma.quoteLineItem.count({ where: { productId: product.id } }),
      prisma.pOLineItem.count({ where: { productId: product.id } }),
      prisma.invoiceLineItem.count({ where: { productId: product.id } }),
    ]);
    const vendor = product.vendorId
      ? await prisma.vendor.findUnique({ where: { id: product.vendorId }, select: { id: true, name: true } })
      : null;
    res.json({
      ...shapeProduct(product, req.user!.permissions),
      vendor,
      usage: { quoteLines, poLines, invoiceLines, total: quoteLines + poLines + invoiceLines },
    });
  } catch (e) { next(e); }
});

productsRouter.post("/", requirePermission(Permission.ProductCreate), async (req: AuthRequest, res, next) => {
  try {
    const data = productBody(req.body ?? {}, { partial: false });
    if (data.vendorId) {
      const vendor = await prisma.vendor.findUnique({ where: { id: String(data.vendorId) }, select: { id: true } });
      if (!vendor) throw new AppError("Unknown vendor");
    }
    const clash = await prisma.product.findUnique({ where: { sku: String(data.sku) }, select: { id: true, name: true } });
    if (clash) throw new AppError(`SKU ${data.sku} is already used by "${clash.name}"`, 409);
    const product = await prisma.product.create({ data: { ...data, createdById: req.user!.userId } as never });
    res.status(201).json(shapeProduct(product, req.user!.permissions));
  } catch (e) { next(e); }
});

productsRouter.patch("/:id", requirePermission(Permission.ProductEdit), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const existing = await prisma.product.findUnique({ where: { id }, select: { id: true, sku: true } });
    if (!existing) throw new AppError("Product not found", 404);
    const data = productBody(req.body ?? {}, { partial: true });
    if (data.sku && data.sku !== existing.sku) {
      const clash = await prisma.product.findUnique({ where: { sku: String(data.sku) }, select: { name: true } });
      if (clash) throw new AppError(`SKU ${data.sku} is already used by "${clash.name}"`, 409);
    }
    // Prices are the commercial half of the record: changing them is a `product:manage` act.
    if (data.costPrice !== undefined && !req.user!.permissions.includes(Permission.ProductManage)) {
      throw new AppError("Your role cannot change a product's cost price", 403);
    }
    const updated = await prisma.product.update({ where: { id }, data: data as never });
    res.json(shapeProduct(updated, req.user!.permissions));
  } catch (e) { next(e); }
});

/** Copies a product so a variation is a two-field edit rather than a retype. */
productsRouter.post("/:id/duplicate", requirePermission(Permission.ProductCreate), async (req: AuthRequest, res, next) => {
  try {
    const source = await prisma.product.findUnique({ where: { id: String(req.params.id) } });
    if (!source) throw new AppError("Product not found", 404);
    const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, sku, name, ...rest } = source;
    const copy = await prisma.product.create({
      data: {
        ...rest,
        name: `${name} (copy)`.slice(0, 160),
        sku: `${sku}-COPY-${Math.random().toString(36).slice(2, 5).toUpperCase()}`.slice(0, 40),
        createdById: req.user!.userId,
      },
    });
    res.status(201).json(shapeProduct(copy, req.user!.permissions));
  } catch (e) { next(e); }
});

/**
 * Stock in and out. Deliberately a counter plus the audit trail the write middleware already
 * keeps, rather than a movements table: a per-warehouse ledger is a bigger feature (and a
 * different one) than "do we have any left".
 */
productsRouter.post("/:id/stock", requirePermission(Permission.ProductManage), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const delta = Number(req.body?.delta);
    if (!Number.isFinite(delta) || delta === 0) throw new AppError("delta must be a non-zero number");
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, stockOnHand: true, trackStock: true, name: true } });
    if (!product) throw new AppError("Product not found", 404);
    if (!product.trackStock) throw new AppError(`${product.name} is not stock-tracked — switch tracking on first`);
    const next = product.stockOnHand + Math.round(delta);
    if (next < 0) throw new AppError(`That would leave stock at ${next}; ${product.stockOnHand} is on hand`);
    const updated = await prisma.product.update({ where: { id }, data: { stockOnHand: next } });
    res.json({ ...shapeProduct(updated, req.user!.permissions), reason: String(req.body?.reason ?? "").slice(0, 200) || null });
  } catch (e) { next(e); }
});

productsRouter.delete("/:id", requirePermission(Permission.ProductDelete), async (req: AuthRequest, res, next) => {
  try {
    const id = String(req.params.id);
    const product = await prisma.product.findUnique({ where: { id }, select: { id: true, name: true } });
    if (!product) throw new AppError("Product not found", 404);
    const [quoteLines, poLines, invoiceLines] = await Promise.all([
      prisma.quoteLineItem.count({ where: { productId: id } }),
      prisma.pOLineItem.count({ where: { productId: id } }),
      prisma.invoiceLineItem.count({ where: { productId: id } }),
    ]);
    const uses = [
      quoteLines ? `${quoteLines} quote line${quoteLines === 1 ? "" : "s"}` : null,
      poLines ? `${poLines} purchase order line${poLines === 1 ? "" : "s"}` : null,
      invoiceLines ? `${invoiceLines} invoice line${invoiceLines === 1 ? "" : "s"}` : null,
    ].filter(Boolean);
    if (uses.length) {
      throw new AppError(`${product.name} is used by ${uses.join(", ")} — deactivate it instead of deleting it`, 409);
    }
    await prisma.product.delete({ where: { id } });
    res.json({ message: `${product.name} deleted` });
  } catch (e) { next(e); }
});
