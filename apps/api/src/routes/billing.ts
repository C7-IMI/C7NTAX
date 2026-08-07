import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission, InvoiceStatus } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { BillingEngine } from "@C7NTAX/billing";
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
      data: { name, companyId, description: description || "", billingPeriod: billingPeriod || "monthly", billingAmount: price || 0, startDate: new Date(startDate), endDate: endDate ? new Date(endDate) : null, autoRenew: autoRenew ?? true, followUpIntervalDays: cancellationDays || 30 },
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

    const hourlyRate = agreement.billingAmount > 0 ? agreement.billingAmount : 150;
    const lineItems = timeEntries.map((te) => ({
      description: te.description || `Time entry ${te.id.slice(0, 8)}`,
      quantity: +(te.minutes / 60).toFixed(2),
      unitPrice: hourlyRate,
      total: +(te.minutes / 60 * hourlyRate).toFixed(2),
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

// ── Invoice PDF ──

billingRouter.get("/invoices/:id/pdf", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({
      where: { id: req.params.id },
      include: { company: true, lineItems: true, payments: true },
    });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!req.user!.permissions.includes(Permission.TicketViewAll) && req.user!.companyId && invoice.companyId !== req.user!.companyId) {
      throw new AppError("Not authorized", 403);
    }

    const currency = "$";
    const statusLabel = invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
    const lineRows = (invoice.lineItems || []).map(li =>
      `<tr><td style="padding:8px;border-bottom:1px solid #1e293b;color:#cbd5e1;">${li.description}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#cbd5e1;">${li.quantity}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#cbd5e1;">${currency}${li.unitPrice.toFixed(2)}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#fff;">${currency}${li.total.toFixed(2)}</td></tr>`
    ).join("");

    const paymentRows = (invoice.payments || []).map(p =>
      `<tr><td style="padding:4px 8px;color:#94a3b8;">${new Date(p.processedAt).toLocaleDateString()}</td>
       <td style="padding:4px 8px;color:#94a3b8;">${p.method}</td>
       <td style="padding:4px 8px;text-align:right;color:#94a3b8;">${p.reference || ""}</td>
       <td style="padding:4px 8px;text-align:right;color:#86efac;">${currency}${p.amount.toFixed(2)}</td></tr>`
    ).join("");

    const paidTotal = (invoice.payments || []).reduce((s,p) => s + p.amount, 0);
    const balance = invoice.total - paidTotal;

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${invoice.invoiceNumber}</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background:#0b1120; color:#e2e8f0; padding:40px; }
  .page { max-width:800px; margin:0 auto; background:#0f172a; border:1px solid #1e293b; border-radius:12px; padding:48px; }
  .header { display:flex; justify-content:space-between; align-items:start; margin-bottom:40px; }
  .logo { font-size:24px; font-weight:800; color:#fff; }
  .logo span { color:#22d3ee; }
  .invoice-title { text-align:right; }
  .invoice-title h1 { font-size:28px; color:#fff; }
  .status { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:600; margin-top:8px; }
  .status-paid { background:#166534; color:#86efac; }
  .status-draft { background:#334155; color:#94a3b8; }
  .status-sent, .status-overdue { background:#1e3a5f; color:#93c5fd; }
  .status-partial { background:#78350f; color:#fde68a; }
  .addresses { display:flex; gap:48px; margin-bottom:40px; }
  .addresses div { flex:1; }
  .addresses h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#64748b; margin-bottom:8px; }
  .addresses p { color:#94a3b8; line-height:1.6; font-size:14px; }
  .meta { display:flex; gap:48px; margin-bottom:32px; }
  .meta div { flex:1; }
  .meta label { font-size:11px; text-transform:uppercase; letter-spacing:1px; color:#64748b; display:block; margin-bottom:4px; }
  .meta span { color:#e2e8f0; font-size:14px; }
  table { width:100%; border-collapse:collapse; }
  thead th { text-align:left; padding:12px 8px; border-bottom:2px solid #1e293b; color:#64748b; font-size:11px; text-transform:uppercase; letter-spacing:1px; }
  thead th:last-child, thead th:nth-child(2), thead th:nth-child(3) { text-align:right; }
  .totals { margin-top:24px; margin-left:auto; width:280px; }
  .totals div { display:flex; justify-content:space-between; padding:6px 0; color:#94a3b8; font-size:14px; }
  .totals .grand { border-top:2px solid #1e293b; margin-top:8px; padding-top:12px; font-size:18px; font-weight:700; color:#fff; }
  .payments { margin-top:32px; }
  .payments h3 { font-size:12px; text-transform:uppercase; letter-spacing:1px; color:#64748b; margin-bottom:8px; }
  .footer { margin-top:48px; padding-top:24px; border-top:1px solid #1e293b; text-align:center; color:#475569; font-size:12px; }
  @media print { body { background:#fff; padding:0; } .page { border:none; box-shadow:none; } }
</style></head>
<body>
<div class="page">
  <div class="header">
    <div class="logo">C7<span>NTAX</span></div>
    <div class="invoice-title">
      <h1>${invoice.invoiceNumber}</h1>
      <span class="status status-${invoice.status}">${statusLabel}</span>
    </div>
  </div>
  <div class="addresses">
    <div>
      <h3>From</h3>
      <p><strong style="color:#e2e8f0;">Cyber 7 Group</strong><br>Professional Services<br>info@cyber7group.com</p>
    </div>
    <div>
      <h3>Bill To</h3>
      <p><strong style="color:#e2e8f0;">${invoice.company?.name || "—"}</strong><br>${invoice.company?.email || ""}</p>
    </div>
  </div>
  <div class="meta">
    <div><label>Issued</label><span>${new Date(invoice.issueDate).toLocaleDateString()}</span></div>
    <div><label>Due</label><span>${new Date(invoice.dueDate).toLocaleDateString()}</span></div>
    <div><label>Currency</label><span>${invoice.currency || "USD"}</span></div>
  </div>
  <table>
    <thead><tr><th>Description</th><th>Qty</th><th>Rate</th><th>Amount</th></tr></thead>
    <tbody>${lineRows || '<tr><td colspan="4" style="padding:16px;text-align:center;color:#64748b;">No line items</td></tr>'}</tbody>
  </table>
  <div class="totals">
    <div><span>Subtotal</span><span>${currency}${(invoice.subtotal ?? invoice.total).toFixed(2)}</span></div>
    ${(invoice.taxRate && invoice.taxRate > 0) ? `<div><span>Tax (${(invoice.taxRate * 100).toFixed(1)}%)</span><span>${currency}${(invoice.taxTotal ?? 0).toFixed(2)}</span></div>` : ""}
    <div class="grand"><span>Total</span><span>${currency}${invoice.total.toFixed(2)}</span></div>
  </div>
  ${paymentRows ? `<div class="payments"><h3>Payments</h3>
    <table><thead><tr><th>Date</th><th>Method</th><th>Reference</th><th>Amount</th></tr></thead><tbody>${paymentRows}</tbody></table>
    ${balance > 0 ? `<div style="text-align:right;margin-top:8px;color:#fca5a5;font-size:14px;">Balance due: ${currency}${balance.toFixed(2)}</div>` : `<div style="text-align:right;margin-top:8px;color:#86efac;font-size:14px;">Paid in full</div>`}
  </div>` : ""}
  <div class="footer">C7NTAX — Professional Services Automation Platform<br>Thank you for your business.</div>
</div>
</body></html>`;

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});

// ── Payments list ──
billingRouter.get("/payments", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const payments = await prisma.payment.findMany({
      orderBy: { processedAt: "desc" },
      take: 200,
      include: { invoice: { select: { invoiceNumber: true, company: { select: { name: true } } } } },
    });
    res.json(payments);
  } catch (e) { next(e); }
});

// ── Revenue report ──
billingRouter.get("/reports/revenue", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const [totalInvoiced, totalPaid, overdueCount, overdueAmount] = await Promise.all([
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: { not: "draft" } } }),
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid" } }),
      prisma.invoice.count({ where: { status: "overdue" } }),
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "overdue" } }),
    ]);
    res.json({
      totalInvoiced: totalInvoiced._sum.total || 0,
      totalPaid: totalPaid._sum.total || 0,
      overdueCount,
      overdueAmount: overdueAmount._sum.total || 0,
    });
  } catch (e) { next(e); }
});
