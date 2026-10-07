import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission, InvoiceStatus } from "@C7NTAX/shared";
import { configFlag } from "../services/appSettings";
import { companyWhere, canAccessCompany } from "../middleware/companyScope";

// Backlog item 1 — Quotes & service catalog. Additive, gated by QUOTES_ENABLED.
export const quotesRouter = Router();

quotesRouter.use((_req, res, next) => {
  if (!configFlag("billing", "quotes")) return res.status(404).json({ error: "Quotes disabled" });
  next();
});
quotesRouter.use(authenticate);

quotesRouter.get("/", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, status } = req.query as Record<string, string>;
    // A company-scoped account sees its own quotes and nothing else, whatever it asks for — the
    // filter below is the caller's *choice*, and this is the floor under it. Internal staff get {}
    // and are unaffected.
    const where: Record<string, unknown> = { ...companyWhere(req.user) };
    if (companyId) where.companyId = companyId;
    if (status) where.status = status;
    const quotes = await prisma.quote.findMany({
      where, orderBy: { createdAt: "desc" }, take: 200,
      include: { company: { select: { id: true, name: true } }, lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    res.json({ data: quotes });
  } catch (e) { next(e); }
});

quotesRouter.post("/", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, title, contactId, notes, taxRate = 0, lineItems = [] } = req.body;
    if (!companyId || !title) throw new AppError("companyId and title required");
    // A scoped account may only quote for its own company, whatever the body says.
    if (!canAccessCompany(req.user, companyId)) throw new AppError("You can only create quotes for your own company", 403);
    if (!Array.isArray(lineItems) || lineItems.length === 0) throw new AppError("at least one line item required");
    const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}`;
    const items = lineItems.map((li: { description?: string; quantity?: number; unitPrice?: number; productId?: string }, i: number) => {
      const quantity = Number(li.quantity || 1), unitPrice = Number(li.unitPrice || 0);
      return { description: String(li.description || ""), quantity, unitPrice, total: +(quantity * unitPrice).toFixed(2), sortOrder: i, productId: li.productId ? String(li.productId) : null };
    });
    const subtotal = +items.reduce((s, li) => s + li.total, 0).toFixed(2);
    const taxTotal = +(subtotal * (Number(taxRate) || 0)).toFixed(2);
    const quote = await prisma.quote.create({
      data: {
        quoteNumber, companyId, title, contactId: contactId || null, notes: notes || null,
        taxRate: Number(taxRate) || 0, subtotal, taxTotal, total: +(subtotal + taxTotal).toFixed(2),
        status: "draft", createdById: req.user!.userId, lineItems: { create: items },
      },
      include: { lineItems: { orderBy: { sortOrder: "asc" } } },
    });
    res.status(201).json(quote);
  } catch (e) { next(e); }
});

quotesRouter.patch("/:id/status", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["draft", "sent", "accepted", "rejected"];
    const status = String(req.body.status || "");
    if (!allowed.includes(status)) throw new AppError("invalid status");
    const existing = await prisma.quote.findUnique({ where: { id: req.params.id }, select: { companyId: true } });
    // 404 rather than 403: an id that exists but is not yours should not be distinguishable from an
    // id that does not exist.
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Quote not found", 404);
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status } });
    res.json(quote);
  } catch (e) { next(e); }
});

quotesRouter.post("/:id/convert", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } });
    if (!quote || !canAccessCompany(req.user, quote.companyId)) throw new AppError("Quote not found", 404);
    if (quote.status === "converted") throw new AppError("Quote already converted");
    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber, companyId: quote.companyId, issueDate: new Date(), dueDate,
        subtotal: quote.subtotal, taxRate: quote.taxRate, taxTotal: quote.taxTotal, total: quote.total,
        status: InvoiceStatus.Draft, quoteStatus: "converted", notes: quote.notes,
        lineItems: { create: quote.lineItems.map((li) => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })) },
      },
      include: { lineItems: true },
    });
    await prisma.quote.update({ where: { id: quote.id }, data: { status: "converted" } });
    res.status(201).json(invoice);
  } catch (e) { next(e); }
});
