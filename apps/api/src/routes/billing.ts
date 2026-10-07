import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { canAccessCompany, companyWhere } from "../middleware/companyScope";
import { Permission, InvoiceStatus } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { BillingEngine } from "@C7NTAX/billing";
import { AGREEMENT_TYPES } from "../services/timeRules";
import { pushExpense } from "../services/accountingSync";
import { approveBatch, createBatch, invoiceBatchEnabled, previewBatch, rejectBatch } from "../services/billingBatch";
import { configFlag } from "../services/appSettings";

/**
 * The client a scoped caller is limited to, or null for someone who may see every client.
 * Billing routes use it so a client-scoped account cannot bill somebody else's work.
 */
function scopedCompanyId(user: AuthRequest["user"]): string | null {
  if (!user) return null;
  if (user.permissions.includes(Permission.TicketViewAll)) return null;
  return user.companyId ?? null;
}

/** The categories an expense can be filed under (PLAN-015 Phase A #2). */
export const EXPENSE_CATEGORIES = ["parking", "hardware", "mileage", "travel", "software", "other"];
import { escapeHtml } from "../services/emailHtml";
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
    const { name, companyId, description, billingPeriod, price, startDate, endDate, cancellationDays, agreementType, hourlyRate, rateTier, blockHoursIncluded, overtimeEnabled, overtimeAfter, overtimeMultiplier } = req.body;
    if (!name || !companyId) throw new AppError("name and companyId required");
    const agreement = await prisma.serviceAgreement.create({
      // `autoRenew` from the client is not a ServiceAgreement column; `autoInvoiceEnabled` is the
      // persisted "keep billing automatically" switch, so it is left at its default.
      data: {
        name, companyId, description: description || "", billingPeriod: billingPeriod || "monthly", billingAmount: price || 0,
        startDate: startDate ? new Date(startDate) : new Date(), endDate: endDate ? new Date(endDate) : null, followUpIntervalDays: cancellationDays || 30,
        ...agreementTimeRules({ agreementType, hourlyRate, rateTier, blockHoursIncluded, overtimeEnabled, overtimeAfter, overtimeMultiplier }),
      },
    });
    res.status(201).json(agreement);
  } catch (e) { next(e); }
});

/**
 * The time-rule half of an agreement payload (PLAN-015 Phase A #1). Only the keys actually sent
 * are returned, so a partial update cannot silently reset a value the caller never mentioned.
 */
function agreementTimeRules(body: Record<string, unknown>): Record<string, unknown> {
  const updates: Record<string, unknown> = {};
  if (body.agreementType !== undefined) {
    if (!AGREEMENT_TYPES.includes(body.agreementType as never)) {
      throw new AppError(`agreementType must be one of ${AGREEMENT_TYPES.join(", ")}`, 400);
    }
    updates.agreementType = body.agreementType;
  }
  if (body.rateTier !== undefined) updates.rateTier = body.rateTier === null ? null : String(body.rateTier).slice(0, 40);
  if (body.hourlyRate !== undefined) {
    const rate = body.hourlyRate === null || body.hourlyRate === "" ? null : Number(body.hourlyRate);
    if (rate !== null && (!Number.isFinite(rate) || rate < 0)) throw new AppError("hourlyRate must be a positive number", 400);
    updates.hourlyRate = rate;
  }
  if (body.blockHoursIncluded !== undefined) {
    const hours = Number(body.blockHoursIncluded);
    if (!Number.isFinite(hours) || hours < 0) throw new AppError("blockHoursIncluded must be zero or more", 400);
    updates.blockHoursIncluded = hours;
  }
  if (body.overtimeEnabled !== undefined) updates.overtimeEnabled = !!body.overtimeEnabled;
  if (body.overtimeAfter !== undefined) {
    const clock = String(body.overtimeAfter ?? "").trim();
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(clock)) throw new AppError("overtimeAfter must look like 18:00", 400);
    updates.overtimeAfter = clock.padStart(5, "0");
  }
  if (body.overtimeMultiplier !== undefined) {
    const multiplier = Number(body.overtimeMultiplier);
    if (!Number.isFinite(multiplier) || multiplier < 1 || multiplier > 5) throw new AppError("overtimeMultiplier must be between 1 and 5", 400);
    updates.overtimeMultiplier = multiplier;
  }
  return updates;
}

billingRouter.patch("/agreements/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const allowed = ["name", "description", "billingPeriod", "endDate", "isActive"];
    const updates: Record<string, unknown> = {};
    for (const key of allowed) if (req.body[key] !== undefined) updates[key] = req.body[key];
    if (req.body.price !== undefined) updates.billingAmount = req.body.price;
    if (req.body.cancellationDays !== undefined) updates.followUpIntervalDays = req.body.cancellationDays;
    if (req.body.status !== undefined) updates.isActive = req.body.status === "active";
    if (req.body.startDate) updates.startDate = new Date(req.body.startDate);
    if (req.body.endDate) updates.endDate = new Date(req.body.endDate);
    Object.assign(updates, agreementTimeRules(req.body ?? {}));
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
    // Which tickets an invoice was billed from, in one grouped query rather than a lookup per
    // invoice: the invoice list is where somebody checks "did we bill that work", and the answer
    // should not need opening each invoice in turn.
    const invoiceIds = invoices.map(i => i.id);
    const billedTime = invoiceIds.length
      ? await prisma.timeEntry.findMany({
          where: { invoiceId: { in: invoiceIds } },
          select: { invoiceId: true, ticket: { select: { id: true, ticketNumber: true } } },
        })
      : [];
    const ticketsByInvoice = new Map<string, Map<string, { id: string; ticketNumber: string }>>();
    for (const entry of billedTime) {
      if (!entry.invoiceId || !entry.ticket) continue;
      if (!ticketsByInvoice.has(entry.invoiceId)) ticketsByInvoice.set(entry.invoiceId, new Map());
      ticketsByInvoice.get(entry.invoiceId)!.set(entry.ticket.id, entry.ticket);
    }
    res.json({
      data: invoices.map(invoice => ({
        ...invoice,
        sourceTickets: [...(ticketsByInvoice.get(invoice.id)?.values() ?? [])]
          .sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber)),
      })),
      total,
    });
  } catch (e) { next(e); }
});

/**
 * The agreement a generate run bills against: an explicit id wins, otherwise the client's first
 * agreement. Shared with the write path so the preview below cannot promise a different rate than
 * the invoice ends up using.
 */
async function resolveBillingAgreement(companyId: string, agreementId?: string | null) {
  const agreement = agreementId
    ? await prisma.serviceAgreement.findUnique({ where: { id: agreementId } })
    : await prisma.serviceAgreement.findFirst({ where: { companyId } });
  if (!agreement) throw new AppError("No service agreement found");
  return agreement;
}

/** Unbilled, billable, chargeable time for a client, carrying the ticket each entry came from. */
function unbilledTimeEntries(companyId: string) {
  return prisma.timeEntry.findMany({
    where: { ticket: { companyId }, invoiceId: null, billable: true, noCharge: false },
    include: { ticket: { select: { id: true, ticketNumber: true } } },
    orderBy: { date: "asc" },
  });
}

type UnbilledEntry = Awaited<ReturnType<typeof unbilledTimeEntries>>[number];

/**
 * Products sold on a client's tickets that have not been billed yet.
 *
 * They live in the ticket's `customFields.ticketProducts` (the Products tab's own storage), and
 * they are billed as their own invoice lines so hardware and licences do not have to be re-typed
 * on the invoice. An entry that came from the catalog carries `productId`, which the line keeps.
 */
async function unbilledTicketProducts(companyId: string) {
  const tickets = await prisma.ticket.findMany({
    where: { companyId },
    select: { id: true, ticketNumber: true, customFields: true },
  });
  const rows: Array<{ ticketId: string; ticketNumber: string; productId: string | null; name: string; sku: string | null; quantity: number; unitPrice: number }> = [];
  for (const ticket of tickets) {
    const custom = (ticket.customFields ?? {}) as Record<string, unknown>;
    if (custom.productsBilled === true) continue;
    const products = Array.isArray(custom.ticketProducts) ? custom.ticketProducts as Array<Record<string, unknown>> : [];
    for (const p of products) {
      const quantity = Number(p.qty ?? p.quantity ?? 1);
      const unitPrice = Number(p.unitCost ?? p.unitPrice ?? p.price ?? 0);
      const name = String(p.name ?? p.description ?? "").trim();
      if (!name || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(unitPrice)) continue;
      rows.push({
        ticketId: ticket.id,
        ticketNumber: ticket.ticketNumber,
        productId: p.productId ? String(p.productId) : null,
        name,
        sku: p.sku ? String(p.sku) : null,
        quantity,
        unitPrice,
      });
    }
  }
  return rows;
}

/** One invoice line per product sold on a ticket, priced at what was agreed on the ticket. */
function productLineItems(rows: Awaited<ReturnType<typeof unbilledTicketProducts>>) {
  return rows.map(r => {
    const quantity = +r.quantity.toFixed(2);
    const unitPrice = +r.unitPrice.toFixed(2);
    return {
      description: r.sku ? `${r.name} (${r.sku})` : r.name,
      quantity,
      unitPrice,
      total: +(quantity * unitPrice).toFixed(2),
      productId: r.productId,
    };
  });
}

/** Marks the tickets whose products have just been put on an invoice. */
async function markProductsBilled(ticketIds: string[]) {
  if (ticketIds.length === 0) return;
  const tickets = await prisma.ticket.findMany({ where: { id: { in: ticketIds } }, select: { id: true, customFields: true } });
  await Promise.all(tickets.map(t => prisma.ticket.update({
    where: { id: t.id },
    data: { customFields: { ...((t.customFields ?? {}) as Record<string, unknown>), productsBilled: true } },
  })));
}

/** One invoice line per time entry; an entry's own rate beats the agreement's default. */
function ticketLineItems(entries: UnbilledEntry[], agreement: { billingAmount: number }) {
  const defaultRate = agreement.billingAmount > 0 ? agreement.billingAmount : 150;
  return entries.map((te) => {
    const quantity = +(te.minutes / 60).toFixed(2);
    const unitPrice = te.rate && te.rate > 0 ? te.rate : defaultRate;
    // Name the source ticket rather than a slice of a UUID: the line, the invoice list and the
    // ticket all then agree about where the charge came from.
    const reference = te.ticket?.ticketNumber ? `Ticket ${te.ticket.ticketNumber}` : `Time entry ${te.id.slice(0, 8)}`;
    return { description: te.description || reference, quantity, unitPrice, total: +(quantity * unitPrice).toFixed(2) };
  });
}

/** What a client's unbilled time would add up to. Reads only, so the dialog can show it first. */
billingRouter.get("/invoices/unbilled/:companyId", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    // The preview exists to serve the generate dialog, so it disappears with the feature rather
    // than hinting at an endpoint this deployment has switched off.
    if (!configFlag("billing", "billFromTickets")) throw new AppError("Generate-from-tickets disabled", 404);
    const companyId = String(req.params.companyId);
    if (!canAccessCompany(req.user, companyId)) throw new AppError("Client not found", 404);
    const agreement = await resolveBillingAgreement(companyId);
    const entries = await unbilledTimeEntries(companyId);
    const soldProducts = await unbilledTicketProducts(companyId);
    const lineItems = [...ticketLineItems(entries, agreement), ...productLineItems(soldProducts)];
    res.json({
      entries: entries.length,
      minutes: entries.reduce((sum, te) => sum + te.minutes, 0),
      products: soldProducts.map(p => ({ ticketNumber: p.ticketNumber, name: p.name, sku: p.sku, quantity: p.quantity, unitPrice: p.unitPrice })),
      amount: +lineItems.reduce((sum, li) => sum + li.total, 0).toFixed(2),
      tickets: [...new Map([
        ...entries.map(te => [te.ticket.id, te.ticket] as const),
        ...soldProducts.map(p => [p.ticketId, { id: p.ticketId, ticketNumber: p.ticketNumber }] as const),
      ]).values()].sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber)),
      agreement: { id: agreement.id, name: agreement.name, billingAmount: agreement.billingAmount },
    });
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/generate", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const companyId = String(req.body?.companyId ?? "");
    if (!companyId) throw new AppError("companyId required");
    if (!canAccessCompany(req.user, companyId)) throw new AppError("Client not found", 404);
    const agreement = await resolveBillingAgreement(companyId, req.body?.agreementId ?? null);
    const timeEntries = await unbilledTimeEntries(companyId);
    const lineItems = ticketLineItems(timeEntries, agreement);

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + 30);
    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber, companyId, agreementId: agreement.id, issueDate: new Date(), dueDate,
        subtotal, taxRate: 0, taxTotal: 0, total: subtotal, status: InvoiceStatus.Draft,
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

// Backlog item 2 — generate a draft from unbilled time entries (gated by BILLING_FROM_TICKETS_ENABLED).
// There used to be a second handler for this same path further down the file. Express serves the
// first match, so that one was unreachable dead code with a different response shape sitting where
// it looked authoritative; it has been removed rather than left to mislead.
billingRouter.post("/invoices/generate-from-tickets", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    if (!configFlag("billing", "billFromTickets")) throw new AppError("Generate-from-tickets disabled", 404);
    const companyId = String(req.body?.companyId ?? "");
    if (!companyId) throw new AppError("companyId required");
    if (!canAccessCompany(req.user, companyId)) throw new AppError("Client not found", 404);
    const agreement = await resolveBillingAgreement(companyId, req.body?.agreementId ?? null);
    const timeEntries = await unbilledTimeEntries(companyId);
    const soldProducts = await unbilledTicketProducts(companyId);
    if (timeEntries.length === 0 && soldProducts.length === 0) throw new AppError("No unbilled time entries or products found");
    const lineItems = [...ticketLineItems(timeEntries, agreement), ...productLineItems(soldProducts)];

    const invoiceNumber = `INV-${Date.now().toString(36).toUpperCase()}`;
    const dueDate = new Date(); dueDate.setDate(dueDate.getDate() + 30);
    const subtotal = +lineItems.reduce((s, li) => s + li.total, 0).toFixed(2);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber, companyId, agreementId: agreement.id, issueDate: new Date(), dueDate,
        subtotal, taxRate: 0, taxTotal: 0, total: subtotal, status: InvoiceStatus.Draft,
        lineItems: { create: lineItems },
      },
      include: { lineItems: true },
    });
    await prisma.timeEntry.updateMany({ where: { id: { in: timeEntries.map((te) => te.id) } }, data: { invoiceId: invoice.id } });
    // The tickets whose products were just billed are marked, so a second run cannot charge for
    // the same hardware twice.
    await markProductsBilled([...new Set(soldProducts.map(p => p.ticketId))]);
    // Answer in the same shape the invoice list uses (`sourceTickets`, `company`) so the caller can
    // open what it just created without a second round trip or an empty client field.
    const sourceTicketIds = new Map<string, { id: string; ticketNumber: string }>([
      ...timeEntries.map(te => [te.ticket.id, te.ticket] as const),
      ...soldProducts.map(p => [p.ticketId, { id: p.ticketId, ticketNumber: p.ticketNumber }] as const),
    ]);
    res.status(201).json({
      invoice: {
        ...invoice,
        company: await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } }),
        sourceTickets: [...sourceTicketIds.values()].sort((a, b) => a.ticketNumber.localeCompare(b.ticketNumber)),
      },
      entriesIncluded: timeEntries.length,
      productsIncluded: soldProducts.length,
    });
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/:id/send", requirePermission(Permission.InvoiceSend), async (req: AuthRequest, res, next) => {
  try {
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id }, include: { company: true, lineItems: true } });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!canAccessCompany(req.user, invoice.companyId)) throw new AppError("Invoice not found", 404);
    if (invoice.status !== InvoiceStatus.Draft && invoice.status !== InvoiceStatus.Sent) {
      throw new AppError("Invoice cannot be sent in its current status");
    }
    const updated = await prisma.invoice.update({
      where: { id: req.params.id },
      data: { status: InvoiceStatus.Sent },
    });
    res.json({ message: "Invoice sent", invoice: updated });
  } catch (e) { next(e); }
});

billingRouter.post("/invoices/:id/record-payment", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { amount } = req.body;
    const invoice = await prisma.invoice.findUnique({ where: { id: req.params.id } });
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!canAccessCompany(req.user, invoice.companyId)) throw new AppError("Invoice not found", 404);
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
    if (!canAccessCompany(req.user, invoice.companyId)) throw new AppError("Not authorized", 403);

    const currency = "$";
    const statusLabel = invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1);
    // Every value below reaches the browser as HTML, so it is escaped: descriptions,
    // payment references and client names are all free text somebody typed.
    const lineRows = (invoice.lineItems || []).map(li =>
      `<tr><td style="padding:8px;border-bottom:1px solid #1e293b;color:#cbd5e1;">${escapeHtml(li.description)}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#cbd5e1;">${li.quantity}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#cbd5e1;">${currency}${li.unitPrice.toFixed(2)}</td>
       <td style="padding:8px;text-align:right;border-bottom:1px solid #1e293b;color:#fff;">${currency}${li.total.toFixed(2)}</td></tr>`
    ).join("");

    const paymentRows = (invoice.payments || []).map(p =>
      `<tr><td style="padding:4px 8px;color:#94a3b8;">${new Date(p.processedAt).toLocaleDateString()}</td>
       <td style="padding:4px 8px;color:#94a3b8;">${escapeHtml(p.method)}</td>
       <td style="padding:4px 8px;text-align:right;color:#94a3b8;">${escapeHtml(p.reference || "")}</td>
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
      <h1>${escapeHtml(invoice.invoiceNumber)}</h1>
      <span class="status status-${escapeHtml(invoice.status)}">${escapeHtml(statusLabel)}</span>
    </div>
  </div>
  <div class="addresses">
    <div>
      <h3>From</h3>
      <p><strong style="color:#e2e8f0;">Cyber 7 Group</strong><br>Professional Services<br>info@cyber7group.com</p>
    </div>
    <div>
      <h3>Bill To</h3>
      <p><strong style="color:#e2e8f0;">${escapeHtml(invoice.company?.name || "—")}</strong><br>${escapeHtml(invoice.company?.email || "")}</p>
    </div>
  </div>
  <div class="meta">
    <div><label>Issued</label><span>${new Date(invoice.issueDate).toLocaleDateString()}</span></div>
    <div><label>Due</label><span>${new Date(invoice.dueDate).toLocaleDateString()}</span></div>
    <div><label>Currency</label><span>${escapeHtml(invoice.currency || "USD")}</span></div>
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

// ── Time entries for the billing view ──
// The tickets list deliberately does not carry time entries, so this is the
// billing screen's own source for them.
billingRouter.get("/time-entries", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { companyId } = req.query as Record<string, string>;
    const entries = await prisma.timeEntry.findMany({
      where: companyId ? { ticket: { companyId } } : {},
      orderBy: { date: "desc" },
      take: 200,
      include: {
        ticket: { select: { id: true, ticketNumber: true, company: { select: { id: true, name: true } } } },
        user: { select: { id: true, firstName: true, lastName: true } },
      },
    });
    res.json(entries);
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
    const scope = companyWhere(req.user);
    const [totalInvoiced, totalPaid, overdueCount, overdueAmount] = await Promise.all([
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: { not: "draft" }, ...scope } }),
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid", ...scope } }),
      prisma.invoice.count({ where: { status: "overdue", ...scope } }),
      prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "overdue", ...scope } }),
    ]);
    res.json({
      totalInvoiced: totalInvoiced._sum.total || 0,
      totalPaid: totalPaid._sum.total || 0,
      overdueCount,
      overdueAmount: overdueAmount._sum.total || 0,
    });
  } catch (e) { next(e); }
});

// ── FI-032 / FI-041: Finance Dashboard ────────────────────────────
billingRouter.get("/dashboard", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const scope = companyWhere(req.user);
    const [invoices, payments] = await Promise.all([
      prisma.invoice.findMany({ where: { ...scope }, select: { status: true, total: true, dueDate: true, issueDate: true } }),
      prisma.payment.findMany({ where: scope.companyId ? { invoice: { companyId: scope.companyId } } : {}, select: { amount: true, processedAt: true, invoice: { select: { status: true } } } }),
    ]);
    const totalInvoiced = invoices.reduce((s,i) => s + i.total, 0);
    const totalPaid = payments.reduce((s,p) => s + p.amount, 0);
    const totalOutstanding = invoices.filter(i => i.status === "sent" || i.status === "partial").reduce((s,i) => s + i.total, 0);
    const totalOverdue = invoices.filter(i => i.status === "overdue").reduce((s,i) => s + i.total, 0);
    res.json({ totalInvoiced, totalPaid, totalOutstanding, totalOverdue, invoiceCount: invoices.length, paymentCount: payments.length });
  } catch (e) { next(e); }
});

// ── FI-034: Quotes ─────────────────────────────────────────────────
billingRouter.post("/quotes", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, lineItems, notes, dueDate } = req.body;
    if (!companyId) throw new AppError("companyId required", 400);
    if (!canAccessCompany(req.user, companyId)) throw new AppError("Client not found", 404);
    const total = (lineItems || []).reduce((s: number, li: any) => s + (li.quantity * li.unitPrice), 0);
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `QUOTE-${Date.now().toString(36).toUpperCase()}`,
        status: "draft", quoteStatus: "draft", companyId, total, subtotal: total, dueDate: dueDate ? new Date(dueDate) : new Date(Date.now() + 30*86400000),
        issueDate: new Date(),
        lineItems: { create: (lineItems || []).map((li: any) => ({ description: li.description, quantity: li.quantity || 1, unitPrice: li.unitPrice || 0, total: (li.quantity || 1) * (li.unitPrice || 0) })) },
      },
    });
    res.status(201).json(invoice);
  } catch (e) { next(e); }
});

billingRouter.post("/quotes/:id/accept", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, select: { companyId: true } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Quote not found", 404);
    const inv = await prisma.invoice.update({ where: { id: req.params.id }, data: { quoteStatus: "accepted", invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}` } });
    res.json(inv);
  } catch (e) { next(e); }
});

// ── FI-037: Recurring Invoices ─────────────────────────────────────
billingRouter.post("/invoices/:id/recurring", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const { recurrenceRule } = req.body; // "monthly", "quarterly", "annually"
    const existing = await prisma.invoice.findUnique({ where: { id: req.params.id }, select: { companyId: true } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Invoice not found", 404);
    const inv = await prisma.invoice.update({ where: { id: req.params.id }, data: { isRecurring: true, recurrenceRule, nextGenerationDate: new Date() } });
    res.json(inv);
  } catch (e) { next(e); }
});

// ── Bill-through batches (PLAN-015 Phase A #3, gated by INVOICE_BATCH_ENABLED) ──

/** The flag is a hard gate: with it off these routes answer 404, as if they did not exist. */
billingRouter.use("/batches", (req, res, next) => {
  if (!invoiceBatchEnabled()) { res.status(404).json({ error: "Batch invoicing is disabled" }); return; }
  next();
});

const parseThroughDate = (value: unknown): Date => {
  if (!value) throw new AppError("billThroughDate required", 400);
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) throw new AppError("billThroughDate must be a date", 400);
  // A bill-through date is inclusive of the whole day it names.
  date.setHours(23, 59, 59, 999);
  return date;
};

/** What a batch would bill. Writes nothing, which is what makes it safe to run repeatedly. */
billingRouter.post("/batches/preview", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const companyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : undefined;
    for (const id of companyIds ?? []) {
      if (!canAccessCompany(req.user, id)) throw new AppError("Client not found", 404);
    }
    const preview = await previewBatch({
      billThroughDate: parseThroughDate(req.body?.billThroughDate),
      companyIds,
      scopeCompanyId: scopedCompanyId(req.user),
    });
    res.json(preview);
  } catch (e) { next(e); }
});

/** Turn the preview into draft invoices. */
billingRouter.post("/batches", requirePermission(Permission.InvoiceCreate), async (req: AuthRequest, res, next) => {
  try {
    const companyIds = Array.isArray(req.body?.companyIds) ? req.body.companyIds : undefined;
    for (const id of companyIds ?? []) {
      if (!canAccessCompany(req.user, id)) throw new AppError("Client not found", 404);
    }
    const { batch, preview, invoices } = await createBatch({
      billThroughDate: parseThroughDate(req.body?.billThroughDate),
      companyIds,
      scopeCompanyId: scopedCompanyId(req.user),
      createdById: req.user!.userId,
      notes: req.body?.notes,
    });
    if (!batch) {
      res.status(200).json({ batch: null, preview, message: "Nothing to bill in that period" });
      return;
    }
    res.status(201).json({
      batch: { ...batch, invoiceCount: invoices?.length ?? 0, total: preview.totals.invoicesAmount },
      preview,
      invoices: (invoices ?? []).map(i => ({ id: i.id, invoiceNumber: i.invoiceNumber, companyId: i.companyId, total: i.total })),
    });
  } catch (e) { next(e); }
});

billingRouter.get("/batches", requirePermission(Permission.BillingView), async (_req: AuthRequest, res, next) => {
  try {
    const batches = await prisma.billingBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 50,
      include: { invoices: { select: { id: true, invoiceNumber: true, companyId: true, total: true, status: true } } },
    });
    res.json({ data: batches.map(b => ({ ...b, invoiceCount: b.invoices.length, total: +b.invoices.reduce((s, i) => s + i.total, 0).toFixed(2) })) });
  } catch (e) { next(e); }
});

billingRouter.get("/batches/:id", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const batch = await prisma.billingBatch.findUnique({
      where: { id: req.params.id },
      include: { invoices: { include: { lineItems: true, company: { select: { id: true, name: true } } } } },
    });
    if (!batch) throw new AppError("Batch not found", 404);
    if (batch.invoices.some(i => !canAccessCompany(req.user, i.companyId))) throw new AppError("Batch not found", 404);
    res.json(batch);
  } catch (e) { next(e); }
});

/** Approve: the drafts become issued invoices and are offered to accounting. */
billingRouter.post("/batches/:id/approve", requirePermission(Permission.InvoiceSend), async (req: AuthRequest, res, next) => {
  try {
    const batch = await prisma.billingBatch.findUnique({ where: { id: req.params.id }, include: { invoices: { select: { companyId: true } } } });
    if (!batch) throw new AppError("Batch not found", 404);
    if (batch.invoices.some(i => !canAccessCompany(req.user, i.companyId))) throw new AppError("Batch not found", 404);
    const result = await approveBatch(batch.id, req.user!.userId);
    res.json(result);
  } catch (e) { next(e); }
});

/** Reject: the drafts are discarded and the work returns to the unbilled pool. */
billingRouter.post("/batches/:id/reject", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const reason = String(req.body?.reason ?? "").trim();
    if (!reason) throw new AppError("Say why the batch was discarded", 400);
    const result = await rejectBatch(String(req.params.id), reason, req.user!.userId);
    res.json(result);
  } catch (e) { next(e); }
});

// ── FI-038: Expenses ───────────────────────────────────────────────
billingRouter.get("/expenses", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const { status, ticketId, companyId } = req.query as Record<string, string | undefined>;
    const expenses = await prisma.expense.findMany({
      where: {
        ...companyWhere(req.user),
        ...(status ? { status } : {}),
        ...(ticketId ? { ticketId } : {}),
        ...(companyId ? { companyId } : {}),
      },
      orderBy: { expenseDate: "desc" },
      take: 200,
    });
    res.json({ data: expenses });
  } catch (e) { next(e); }
});

/** Submitting out-of-pocket costs is technician work, so this only needs ticket edit — the
 * approval that follows is what billing permission is for. */
billingRouter.post("/expenses", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const { description, amount, category, vendor, miles, companyId, ticketId, receiptUrl, expenseDate } = req.body;
    if (!description || amount === undefined || amount === null || amount === "") throw new AppError("description and amount required", 400);
    const value = Number(amount);
    if (!Number.isFinite(value) || value < 0) throw new AppError("amount must be a positive number", 400);
    if (category !== undefined && !EXPENSE_CATEGORIES.includes(category)) {
      throw new AppError(`category must be one of ${EXPENSE_CATEGORIES.join(", ")}`, 400);
    }

    // A ticket-scoped expense takes its client from the ticket, so the two can never disagree.
    let effectiveCompanyId = companyId || null;
    if (ticketId) {
      const ticket = await prisma.ticket.findUnique({ where: { id: String(ticketId) }, select: { companyId: true } });
      if (!ticket) throw new AppError("Ticket not found", 404);
      if (effectiveCompanyId && effectiveCompanyId !== ticket.companyId) {
        throw new AppError("The client does not match the ticket's client", 400);
      }
      effectiveCompanyId = ticket.companyId;
    }
    if (effectiveCompanyId && !canAccessCompany(req.user, effectiveCompanyId)) throw new AppError("Client not found", 404);

    const expense = await prisma.expense.create({
      data: {
        description: String(description),
        amount: value,
        category: category || "other",
        vendor: vendor ? String(vendor).slice(0, 120) : null,
        miles: miles !== undefined && miles !== null && miles !== "" ? Number(miles) : null,
        companyId: effectiveCompanyId,
        ticketId: ticketId || null,
        receiptUrl: receiptUrl || null,
        expenseDate: expenseDate ? new Date(expenseDate) : new Date(),
        createdById: req.user!.userId,
        status: "submitted",
      },
    });
    res.status(201).json(expense);
  } catch (e) { next(e); }
});

/** Editing is for the person who filed it, while it is still waiting for a decision. */
billingRouter.patch("/expenses/:id", requirePermission(Permission.TicketEdit), async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Expense not found", 404);
    const isOwner = existing.createdById === req.user!.userId;
    const canApprove = req.user!.permissions.includes(Permission.BillingManage);
    if (!isOwner && !canApprove) throw new AppError("You can only edit your own expenses", 403);
    if (existing.status !== "submitted" && !canApprove) throw new AppError("This expense has already been decided", 409);

    const updates: Record<string, unknown> = {};
    for (const key of ["description", "vendor", "receiptUrl"] as const) {
      if (req.body[key] !== undefined) updates[key] = req.body[key] === null ? null : String(req.body[key]).slice(0, 200);
    }
    if (req.body.category !== undefined) {
      if (!EXPENSE_CATEGORIES.includes(req.body.category)) throw new AppError(`category must be one of ${EXPENSE_CATEGORIES.join(", ")}`, 400);
      updates.category = req.body.category;
    }
    if (req.body.amount !== undefined) {
      const value = Number(req.body.amount);
      if (!Number.isFinite(value) || value < 0) throw new AppError("amount must be a positive number", 400);
      updates.amount = value;
    }
    if (req.body.miles !== undefined) updates.miles = req.body.miles === null || req.body.miles === "" ? null : Number(req.body.miles);
    if (req.body.expenseDate !== undefined && req.body.expenseDate) updates.expenseDate = new Date(req.body.expenseDate);

    const expense = await prisma.expense.update({ where: { id: existing.id }, data: updates });
    res.json(expense);
  } catch (e) { next(e); }
});

/** The approval step. Only billing permission may move an expense out of `submitted`. */
billingRouter.post("/expenses/:id/approve", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { note } = req.body ?? {};
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Expense not found", 404);
    if (existing.status === "approved") throw new AppError("This expense is already approved", 409);
    if (existing.invoiceId) throw new AppError("This expense is already on an invoice", 409);
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { status: "approved", approvedById: req.user!.userId, approvedAt: new Date(), decisionNote: note ? String(note).slice(0, 500) : null },
    });
    res.json(expense);
  } catch (e) { next(e); }
});

billingRouter.post("/expenses/:id/reject", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const { note } = req.body ?? {};
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Expense not found", 404);
    if (existing.invoiceId) throw new AppError("This expense is already on an invoice", 409);
    if (!note || !String(note).trim()) throw new AppError("Say why the expense was rejected", 400);
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { status: "rejected", approvedById: req.user!.userId, approvedAt: new Date(), decisionNote: String(note).trim().slice(0, 500) },
    });
    res.json(expense);
  } catch (e) { next(e); }
});

/** Push an approved expense to the connected accounting system (PLAN-015 Phase A #2). */
billingRouter.post("/expenses/:id/sync", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const existing = await prisma.expense.findUnique({ where: { id: req.params.id } });
    if (!existing || !canAccessCompany(req.user, existing.companyId)) throw new AppError("Expense not found", 404);
    if (existing.status !== "approved") throw new AppError("Approve the expense before pushing it to accounting", 409);

    const result = await pushExpense(existing);
    if (!result.pushed) {
      // 409, not 500: nothing is broken, the other system simply is not ready for this expense.
      res.status(409).json({ error: result.reason ?? "The expense could not be pushed" });
      return;
    }
    const expense = await prisma.expense.update({
      where: { id: existing.id },
      data: { externalSystem: result.externalSystem ?? null, externalId: result.externalId ?? null, syncedAt: new Date() },
    });
    res.json({ ...expense, synced: true });
  } catch (e) { next(e); }
});

billingRouter.delete("/expenses/:id", requirePermission(Permission.BillingManage), async (req: AuthRequest, res, next) => {
  try {
    const expense = await prisma.expense.findUnique({ where: { id: req.params.id }, select: { companyId: true, createdById: true, status: true, invoiceId: true } });
    if (!expense || !canAccessCompany(req.user, expense.companyId)) throw new AppError("Expense not found", 404);
    if (expense.invoiceId) throw new AppError("This expense is on an invoice — remove it from the invoice first", 409);
    await prisma.expense.delete({ where: { id: req.params.id } });
    res.json({ message: "Deleted" });
  }
  catch (e) { next(e); }
});
