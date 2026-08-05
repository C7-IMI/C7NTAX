import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, InvoiceStatus } from "@c7-overwatch/shared";
import { AppError } from "../middleware/errorHandler";
import { BillingEngine } from "@c7-overwatch/billing";
import { v4 as uuid } from "uuid";

export const billingRouter = Router();
billingRouter.use(authenticate);

// ── Service Agreements ──

billingRouter.get("/agreements", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const agreements = await prisma.serviceAgreement.findMany({
      orderBy: { name: "asc" },
      include: { company: { select: { id: true, name: true } } },
    });
    res.json(agreements);
  } catch (e) { next(e); }
});

billingRouter.post("/agreements", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { name, companyId, description, billingPeriod, price, startDate, endDate, autoRenew, cancellationDays } = req.body;
    if (!name || !companyId) throw new AppError("name and companyId required");
    const agreement = await prisma.serviceAgreement.create({
      data: { name, companyId, description: description || "", billingPeriod: billingPeriod || "monthly", price: price || 0, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null, autoRenew: autoRenew ?? true, cancellationDays: cancellationDays || 30 },
    });
    res.status(201).json(agreement);
  } catch (e) { next(e); }
});

billingRouter.patch("/agreements/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "description", "billingPeriod", "price", "endDate", "autoRenew", "cancellationDays", "status"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (req.body.startDate) updates.startDate = new Date(req.body.startDate);
    const agreement = await prisma.serviceAgreement.update({ where: { id: req.params.id }, data: updates });
    res.json(agreement);
  } catch (e) { next(e); }
});

// ── Invoices ──

billingRouter.get("/invoices", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { status, companyId, limit = "50", offset = "0" } = req.query as Record<string, string>;
    const where: Record<string, unknown> = {};
    if (status) where.status = status;
    if (companyId) where.companyId = companyId;
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId) {
      where.companyId = req.user!.companyId;
    }
    const [invoices, total] = await Promise.all([
      prisma.invoice.findMany({ where, skip: Number(offset), take: Number(limit), orderBy: { issueDate: "desc" }, include: { company: { select: { id: true, name: true } }, lineItems: true } }),
      prisma.invoice.count({ where }),
    ]);
    res.json({ data: invoices, total });
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/generate", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, agreementId } = req.body;
    if (!companyId) throw new AppError("companyId required");
    const agreement = agreementId
      ? await prisma.serviceAgreement.findUnique({ where: { id: agreementId } })
      : await prisma.serviceAgreement.findFirst({ where: { companyId } });
    if (!agreement) throw new AppError("No service agreement found");

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);

    // Get unbilled time entries
    const timeEntries = await prisma.timeEntry.findMany({
      where: { ticket: { companyId }, invoiceId: null, billable: true },
    });

    const lineItems = timeEntries.map((te) => ({
      description: te.description || `Time entry ${te.id.slice(0, 8)}`,
      quantity: te.hours,
      unitPrice: agreement.price > 0 ? agreement.price : 150, // default hourly rate
      total: te.hours * (agreement.price > 0 ? agreement.price : 150),
    }));

    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const taxRate = 0; // TODO: configurable per client location
    const taxTotal = subtotal * taxRate;

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber, companyId, agreementId: agreement.id, issueDate: new Date(), dueDate,
        subtotal, taxRate, taxTotal, total: subtotal + taxTotal, status: InvoiceStatus.Draft,
        lineItems: { create: lineItems },
      },
      include: { lineItems: true },
    });

    // Link time entries to invoice
    if (timeEntries.length > 0) {
      await prisma.timeEntry.updateMany({
        where: { id: { in: timeEntries.map((te) => te.id) } },
        data: { invoiceId: invoice.id },
      });
    }

    res.status(201).json(invoice);
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/:id/send", requirePermission(Permission.InvoiceSend), async (req: AuthRequest, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { company: true, lineItems: true } });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (invoice.status !== InvoiceStatus.Draft && invoice.status !== InvoiceStatus.Sent) {
      throw new AppError("Invoice cannot be sent in its current status");
    }
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: InvoiceStatus.Sent, sentAt: new Date() },
    });
    res.json({ message: "Invoice sent", invoice: updated });
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/:id/record-payment", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { amount } = req.body;
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) throw new AppError("Invoice not found", 404);
    const newStatus = amount >= invoice.total ? InvoiceStatus.Paid : InvoiceStatus.Partial;
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: newStatus, paidAt: newStatus === InvoiceStatus.Paid ? new Date() : undefined },
    });
    await prisma.payment.create({
      data: { invoiceId: req.params.id, amount, method: req.body.method || "other", reference: req.body.reference || "", processedAt: new Date() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});
