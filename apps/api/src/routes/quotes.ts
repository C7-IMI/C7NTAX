import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission, InvoiceStatus } from "@C7NTAX/shared";

// Backlog item 1 — Quotes & service catalog. Additive, gated by QUOTES_ENABLED.
export const quotesRouter = Router();

quotesRouter.use((_req, res, next) => {
  if (process.env.QUOTES_ENABLED === "false") return res.status(404).json({ error: "Quotes disabled" });
  next();
});
quotesRouter.use(authenticate);

quotesRouter.get("/", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, status } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
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
    if (!Array.isArray(lineItems) || lineItems.length === 0) throw new AppError("at least one line item required");
    const quoteNumber = `Q-${Date.now().toString(36).toUpperCase()}`;
    const items = lineItems.map((li: { description?: string; quantity?: number; unitPrice?: number }, i: number) => {
      const quantity = Number(li.quantity || 1), unitPrice = Number(li.unitPrice || 0);
      return { description: String(li.description || ""), quantity, unitPrice, total: +(quantity * unitPrice).toFixed(2), sortOrder: i };
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
    const quote = await prisma.quote.update({ where: { id: req.params.id }, data: { status } });
    res.json(quote);
  } catch (e) { next(e); }
});

quotesRouter.post("/:id/convert", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const quote = await prisma.quote.findUnique({ where: { id: req.params.id }, include: { lineItems: { orderBy: { sortOrder: "asc" } } } });
    if (!quote) throw new AppError("Quote not found", 404);
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
