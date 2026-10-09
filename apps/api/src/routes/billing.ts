import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { canAccessCompany, companyWhere } from "../middleware/companyScope";
import { Permission, InvoiceStatus, type DocumentBrand } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { routeParam } from "../middleware/routeParams";
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
import { brandForDocument } from "../services/brand";
import {
  amountDueBox, currencyName, currencySymbol, daysBetween, formatDate, inkRule, letterhead,
  metaGrid, metaLine, money, moneyNegative, note, paginate, paginateKeepingAction, payBlock, rateLabel,
  renderDocument, runHead, section, statusMark, tableBlock, totalsBlock,
  type DocTableRow, type DocumentBlock, type DocumentPage, type DocumentStatusTone,
} from "../services/documentHtml";
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
      data: { invoiceId: routeParam(req, "id"), amount, method: req.body.method || "other", reference: req.body.reference || "", processedAt: new Date() },
    });
    res.json(updated);
  } catch (e) { next(e); }
});

// ── Invoice PDF ──

billingRouter.get("/invoices/:id/pdf", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const invoice = await invoiceForDocument(routeParam(req, "id"));
    if (!invoice) throw new AppError("Invoice not found", 404);
    if (!canAccessCompany(req.user, invoice.companyId)) throw new AppError("Not authorized", 403);

    const html = await renderInvoiceDocument(invoice);

    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});

// ── Time entries for the billing view ──
// The tickets list deliberately does not carry time entries, so this is the
// billing screen's own source for them.
// ── The invoice and the statement, drawn on paper ──────────────────

/**
 * An invoice with everything a document draws.
 *
 * The agreement is included because an invoice raised from one may carry no `InvoiceLineItem` rows at
 * all: `INV-2026-002` in this instance records a real $8,000.00 subtotal and not one line, and the
 * document then has to say what the charge *was* rather than print an empty table over a live figure.
 */
function invoiceForDocument(id: string) {
  return prisma.invoice.findUnique({
    where: { id },
    include: { company: true, lineItems: true, payments: true, agreement: true },
  });
}
type InvoiceForDocument = NonNullable<Awaited<ReturnType<typeof invoiceForDocument>>>;
type CompanyForDocument = InvoiceForDocument["company"];

/** Where the client is, as a document prints it: `Chicago, IL, US`. */
function clientLocation(company: CompanyForDocument | null): string | null {
  const city = company?.billingCity || company?.city || "";
  const state = company?.billingState || company?.state || "";
  const country = company?.billingCountry || company?.country || "";
  const place = [city, state].filter(Boolean).join(", ");
  return [place, country].filter(Boolean).join(", ") || null;
}

/**
 * The nearest thing this database has to a tax jurisdiction.
 *
 * `Invoice` stores a rate and an amount and no jurisdiction column, which is why
 * `billingTaxSummaryReport` counts `invoicesMissingJurisdiction`. The same derivation is used here, from
 * the client's billing address falling back to its primary one, so the printed invoice and the
 * compliance report cannot disagree about where a tax belongs.
 */
function taxJurisdiction(company: CompanyForDocument | null): string | null {
  const country = company?.billingCountry || company?.country || "";
  const state = company?.billingState || company?.state || "";
  return [country, state].filter(Boolean).join(" \u00b7 ") || null;
}

/**
 * The label on the tax line: what the tax is, at what rate, in which jurisdiction where one is known.
 *
 * An amount alone is a question the reader has to ask, so the rate and the place are stated beside it.
 */
function taxLineLabel(rate: number, jurisdiction: string | null): string {
  return ["Sales tax", rateLabel(rate), jurisdiction].filter(Boolean).join(" \u00b7 ");
}

/** The terms a document states, from the invoice's own two dates rather than a fixed assumption. */
function paymentTerms(issueDate: Date, dueDate: Date): string {
  const days = daysBetween(issueDate, dueDate);
  if (days <= 0) return "Payment terms: due on receipt.";
  return `Payment terms: net ${days} (the due date above).`;
}

/**
 * Who to reply to about a document.
 *
 * This is the **instance's** accounts contact and never the client's own address: naming the customer as
 * the person to ask about their own invoice is a sentence that looks like a mistake and reads like one.
 * When the instance has recorded no contact line, the documents fall back to naming the company.
 */
function accountsContact(brand: DocumentBrand): string | null {
  return brand.contactLine || null;
}

/**
 * The value a document's "pay or query" box carries: the accounts contact, or who to ask.
 *
 * Deliberately **not** a URL. The only invoice link the product has today is
 * `${WEB_ORIGIN}/billing?invoice=…`, which is the *staff* Billing screen — the overdue-reminder worker
 * already sends it to customers — because `/api/portal` has no invoice route at all. That address on a
 * customer's invoice is an affordance the customer cannot use, so the box names a person instead. When
 * the client portal grows an invoice route, this is the one line that changes.
 */
function queryTarget(brand: DocumentBrand, contact: string | null): string {
  return contact ?? `${brand.company} accounts`;
}

/** A quantity as a document prints it: `60`, `1.5`, never `60.00`. */
function quantityText(quantity: number): string {
  return Number.isInteger(quantity) ? String(quantity) : String(+quantity.toFixed(2));
}

/**
 * The agreement an un-itemised invoice was raised from.
 *
 * The invoice's own `agreementId` is null on the seeded `INV-2026-002` even though the charge is the
 * client's agreement, so the client's agreement whose amount matches the recorded subtotal is preferred
 * and their largest active one is the fallback. The document states the basis it found; it does not
 * invent a rate.
 */
async function billingAgreementFor(invoice: InvoiceForDocument) {
  const agreements = await prisma.serviceAgreement.findMany({
    where: { companyId: invoice.companyId, isActive: true },
    orderBy: { billingAmount: "desc" },
  });
  return agreements.find((agreement) => Math.abs(agreement.billingAmount - (invoice.subtotal ?? 0)) < 0.01)
    ?? agreements[0]
    ?? null;
}

/**
 * The word and the mark a document uses for a state. Never colour alone, always a word as well.
 *
 * The balance the payments make decides "paid in full", not the stored status: a status that says `paid`
 * over a residual balance is precisely the case that must not tell a customer nothing is owed.
 */
function invoiceStatusLabel(
  status: string,
  total: number,
  balance: number,
  received: number,
  overdue: boolean,
): { label: string; tone: DocumentStatusTone } {
  if (status === InvoiceStatus.Draft) return { label: "Draft", tone: "draft" };
  if (status === InvoiceStatus.Void) return { label: "Void", tone: "plain" };
  if (status === InvoiceStatus.Collections) return { label: "In collections", tone: "overdue" };
  if (total > 0 && balance <= 0.005) return { label: "Paid in full", tone: "paid" };
  if (received > 0.005 || status === InvoiceStatus.Partial) return { label: "Part paid", tone: "part" };
  if (overdue || status === InvoiceStatus.Overdue) return { label: "Overdue", tone: "overdue" };
  if (status === InvoiceStatus.Sent) return { label: "Awaiting payment", tone: "plain" };
  return { label: status.charAt(0).toUpperCase() + status.slice(1), tone: "plain" };
}

/** How many line items fit on the summary page before the schedule moves to a continuation sheet. */
const INVOICE_SUMMARY_ROWS = 6;

/**
 * The invoice, redrawn as a paper document.
 *
 * Page one keeps the summary and the action — the amount due, the line items, the totals and the ways to
 * pay — and a continuation sheet carries the detail the reader may need but does not have to act on: the
 * full schedule, the tax breakdown and the payments applied. Nothing important is ever only on page two,
 * because a page two that is missing is a document nobody can act on.
 */
async function renderInvoiceDocument(invoice: InvoiceForDocument): Promise<string> {
  const brand = await brandForDocument("invoice", invoice.companyId);
  const size = brand.presentation.pageSize;
  const generatedAt = new Date();
  const company = invoice.company;
  const currency = invoice.currency || "USD";
  const symbol = currencySymbol(currency);

  const subtotal = +(invoice.subtotal ?? 0).toFixed(2);
  const taxTotal = +(invoice.taxTotal ?? 0).toFixed(2);
  const total = +invoice.total.toFixed(2);
  const received = +invoice.payments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2);
  const balance = +(total - received).toFixed(2);
  const paidInFull = total > 0 && balance <= 0.005;
  // Settledness is decided by the payments, not by the status column. The approved mockup's rule is
  // that the balance is the one the payments make it, and a stored status that says "paid" over a
  // residual balance is exactly the case that must not tell a customer nothing is owed.
  const open = balance > 0.005 && invoice.status !== InvoiceStatus.Draft && invoice.status !== InvoiceStatus.Void;
  const overdueDays = open ? Math.max(0, daysBetween(invoice.dueDate, generatedAt)) : 0;
  const overdue = overdueDays > 0;
  const recordedAsPaid = invoice.status === InvoiceStatus.Paid || !!invoice.paidAt;

  const status = invoiceStatusLabel(invoice.status, total, balance, received, overdue);
  const jurisdiction = taxJurisdiction(company);
  const taxShown = taxTotal !== 0 || (invoice.taxRate ?? 0) !== 0;
  const contact = accountsContact(brand);
  const terms = paymentTerms(invoice.issueDate, invoice.dueDate);

  // The charge, and — when the invoice records no lines of its own — the basis the amount came from.
  const itemised = invoice.lineItems.length > 0;
  const agreement = invoice.agreement ?? (itemised ? null : await billingAgreementFor(invoice));
  const chargeRows: DocTableRow[] = itemised
    ? invoice.lineItems.map((line) => ({
        cells: [line.description, quantityText(line.quantity), `${symbol}${money(line.unitPrice)}`, `${symbol}${money(line.total)}`],
      }))
    : [{
        cells: [
          {
            text: agreement ? agreement.name : "Charge for this invoice",
            sub: agreement
              ? `Agreement charge \u00b7 billed ${agreement.billingPeriod} \u00b7 this invoice records no itemised lines of its own`
              : "This invoice records no itemised lines; the amount is its recorded subtotal.",
          },
          "1",
          `${symbol}${money(subtotal)}`,
          `${symbol}${money(subtotal)}`,
        ],
      }];

  const summaryRows = chargeRows.length > INVOICE_SUMMARY_ROWS ? chargeRows.slice(0, 4) : chargeRows;
  const truncated = summaryRows.length !== chargeRows.length;
  const needsContinuation = truncated || invoice.payments.length > 0;

  // The totals block ends at what is owed, and the box at the top states that figure once.
  const totalsRows: { key: string; value: string; strong?: boolean; rule?: boolean }[] = [
    { key: "Subtotal", value: `${symbol}${money(subtotal)}` },
  ];
  if (taxShown) totalsRows.push({ key: taxLineLabel(invoice.taxRate ?? 0, jurisdiction), value: `${symbol}${money(taxTotal)}` });
  if (received > 0) {
    totalsRows.push({ key: "Total", value: `${symbol}${money(total)}`, rule: true });
    totalsRows.push({ key: "Less payments applied", value: moneyNegative(received) });
    totalsRows.push({ key: "Balance due", value: `${symbol}${money(balance)}`, rule: true, strong: true });
  } else {
    totalsRows.push({ key: paidInFull ? "Total" : "Total", value: `${symbol}${money(total)}`, rule: true, strong: true });
  }
  // The totals block is arithmetic, not commentary: the tax rate and its jurisdiction are already in the
  // tax line, and the fuller explanation of where the jurisdiction came from belongs with the tax
  // breakdown on the continuation sheet rather than under the figures on page one.

  const dueLabel = paidInFull ? "Paid in full" : received > 0 ? "Balance due" : "Amount due";
  const dueAmount = paidInFull ? 0 : balance;
  const dueSub = paidInFull
    ? `Settled ${formatDate(invoice.paidAt ?? generatedAt)} \u00b7 ${currencyName(currency)} \u00b7 nothing further is due`
    : received > 0
      ? `${symbol}${money(total)} total, less ${symbol}${money(received)} received \u00b7 payable by ${formatDate(invoice.dueDate)}`
      : `${invoice.status === InvoiceStatus.Draft ? "Draft, not issued. " : ""}Payable by ${formatDate(invoice.dueDate)} \u00b7 ${currencyName(currency)}`;

  const nextBody = paidInFull
    ? `Nothing further is due. This invoice was settled on ${formatDate(invoice.paidAt ?? generatedAt)}.`
    : overdue
      ? `This invoice was due on ${formatDate(invoice.dueDate)} and is ${overdueDays} days overdue. A reminder is sent every seven days while the balance is unpaid.`
      : `This invoice is payable by ${formatDate(invoice.dueDate)}. If payment is not received by then the balance becomes overdue and a reminder is sent every seven days until it is settled.`;

  const payWays = [
    { label: "Bank transfer", body: "ACH or wire, quoting the reference below", reference: invoice.invoiceNumber },
    { label: "Cheque", body: `Payable to ${brand.company}` },
    {
      label: "Card",
      body: contact ? `Online, or email ${contact} for the account details for this invoice` : "Contact us and we will send the account details for this invoice",
    },
  ];
  const pageOne: DocumentBlock[] = [
    letterhead(brand, "Invoice", statusMark(status.label, status.tone)),
    metaGrid([
      { label: "Client", value: company?.name ?? "Client", sub: [clientLocation(company), company?.clientId ? `Client account ${company.clientId}` : null].filter(Boolean).join(" \u00b7 ") || null },
      { label: "Invoice", value: invoice.invoiceNumber, mono: true },
      { label: "Issued", value: formatDate(invoice.issueDate) },
      { label: "Due", value: formatDate(invoice.dueDate), sub: overdue ? `${overdueDays} days overdue` : null, accent: overdue },
    ]),
    inkRule(),
    metaLine(`Quote <span class="dh-mono">${escapeHtml(invoice.invoiceNumber)}</span> on any payment${contact ? ` \u00b7 questions to <b>${escapeHtml(contact)}</b>` : ""}`),
    amountDueBox({ label: dueLabel, sub: dueSub, amount: dueAmount, currency, overdue, footnote: overdue ? `${overdueDays} days overdue` : undefined }),
    section("The charge", truncated ? `Itemised on page ${needsContinuation ? 2 : 1}` : itemised ? undefined : "Agreement basis"),
    tableBlock({
      columns: [
        { label: "Description" },
        { label: "Qty", align: "right", width: "16mm" },
        { label: "Unit price", align: "right", width: "26mm" },
        { label: "Amount", align: "right", width: "30mm" },
      ],
      rows: summaryRows,
    }),
    // The basis is already stated in the line-item row's own second line, so a note repeating it would
    // only push the ways to pay off the first sheet. The note is kept for the one case the row cannot
    // explain: an invoice with no lines and no agreement found to attribute them to.
    ...(!itemised && !agreement
      ? [note("This invoice records no itemised lines. The amount above is the subtotal recorded against the invoice.")]
      : []),
    totalsBlock(totalsRows),
  ];

  // The action block is held back from the summary's own budgeting so the ways to pay always land on
  // the same sheet as the amount, however tall the summary turned out to be.
  const pageOneAction: DocumentBlock[] = [payBlock({
      title: received > 0 && !paidInFull ? "How to pay the balance" : "How to pay",
      ways: payWays,
      nextTitle: "What happens next",
      nextBody,
      portalLabel: "Pay or query this invoice",
      portalUrl: queryTarget(brand, contact),
      closing: `Quote ${invoice.invoiceNumber} with any payment.${contact ? ` If anything here looks wrong, email ${contact} and we will correct it.` : " If anything here looks wrong, contact us and we will correct it."}`,
    }),
  ];

  const continuation: DocumentBlock[] = [];
  if (truncated) {
    continuation.push(section("Schedule of charges", "continued"));
    continuation.push(tableBlock({
      columns: [
        { label: "Description" },
        { label: "Qty", align: "right", width: "16mm" },
        { label: "Unit price", align: "right", width: "26mm" },
        { label: "Amount", align: "right", width: "30mm" },
      ],
      rows: chargeRows,
      totalRow: { label: "Total charge", value: `${symbol}${money(subtotal)}` },
    }));
  }
  if (needsContinuation && taxShown) {
    continuation.push(section("Tax"));
    continuation.push(metaGrid([
      { label: "Jurisdiction", value: jurisdiction ?? "Not recorded", sub: jurisdiction ? "Derived from the billing address on this account" : "The client has no billing address on file" },
      { label: "Rate", value: rateLabel(invoice.taxRate ?? 0), sub: "The invoice's own recorded rate" },
      { label: "Tax on this invoice", value: `${symbol}${money(taxTotal)}`, sub: `${rateLabel(invoice.taxRate ?? 0)} of ${symbol}${money(subtotal)}` },
    ], 3));
    continuation.push(note("The invoice records a rate and an amount and no jurisdiction of its own, so the jurisdiction above is derived from the client's billing address rather than stated by a tax engine."));
  }
  if (invoice.payments.length > 0) {
    continuation.push(section("Payments applied", `${invoice.payments.length} received`));
    continuation.push(tableBlock({
      columns: [
        { label: "Date", width: "34mm" },
        { label: "Method", width: "28mm" },
        { label: "Reference" },
        { label: "Amount", align: "right", width: "30mm" },
      ],
      rows: [...invoice.payments]
        .sort((a, b) => new Date(a.processedAt).getTime() - new Date(b.processedAt).getTime())
        .map((payment) => ({
          cells: [
            formatDate(payment.processedAt),
            paymentMethodLabel(payment.method),
            { text: payment.reference || "Not recorded", mono: !!payment.reference },
            `${symbol}${money(payment.amount)}`,
          ],
        })),
      totalRow: { label: "Total received", value: `${symbol}${money(received)}` },
    }));
  }
  if (needsContinuation) {
    continuation.push(section("The balance"));
    continuation.push(totalsBlock(totalsRows));
    continuation.push(note(
      // The recorded status can disagree with the recorded payments. On a customer's document the
      // payments win, and the disagreement is stated plainly rather than silently resolved.
      recordedAsPaid && !paidInFull
        ? `This invoice is recorded as settled, but the payments recorded against it leave ${symbol}${money(balance)} outstanding, which is the balance above.`
        : paidInFull
          ? "This invoice is paid in full."
          : `The balance due on this invoice is ${symbol}${money(balance)}, and a reminder is sent every seven days while it remains unpaid.`,
    ));
  }

  const pages: DocumentPage[] = [
    ...paginateKeepingAction(pageOne, pageOneAction, size),
    ...(needsContinuation ? paginate(continuation, size, { continuations: true }) : []),
  ];

  return renderDocument({
    brand,
    size,
    title: `Invoice ${invoice.invoiceNumber}`,
    pages,
    continuationHead: (page, total) => runHead(invoice.invoiceNumber, company?.name ?? "Client", "Invoice", page, total),
    terms,
    generatedAt,
  });
}

/** How a document names the way money arrived. The stored values are the API's own. */
function paymentMethodLabel(method: string): string {
  const labels: Record<string, string> = {
    credit_card: "Card",
    ach: "ACH transfer",
    check: "Cheque",
    wire: "Wire transfer",
    flexpoint: "FlexPoint",
    other: "Other",
  };
  return labels[method] ?? method;
}

/** The invoices a statement lists: everything issued and not settled. A draft has not been issued. */
function openInvoicesFor(companyId: string) {
  return prisma.invoice.findMany({
    where: { companyId, status: { in: [InvoiceStatus.Sent, InvoiceStatus.Partial, InvoiceStatus.Overdue] } },
    include: { payments: true, lineItems: true, agreement: true },
    orderBy: { dueDate: "asc" },
  });
}
type StatementInvoice = Awaited<ReturnType<typeof openInvoicesFor>>[number];

/** The client a statement is issued to. */
function companyForDocument(id: string) {
  return prisma.company.findUnique({ where: { id } });
}
type CompanyForStatement = NonNullable<Awaited<ReturnType<typeof companyForDocument>>>;

/**
 * The ageing bands a statement totals by.
 *
 * `not yet due` is a band of its own rather than an omission: an account statement that only listed the
 * overdue part would look like it had forgotten the invoice issued last week.
 */
const AGE_BANDS: { key: string; from: number; to: number }[] = [
  { key: "Not yet due", from: Number.NEGATIVE_INFINITY, to: 0 },
  { key: "1\u201330 days", from: 1, to: 30 },
  { key: "31\u201360 days", from: 31, to: 60 },
  { key: "61\u201390 days", from: 61, to: 90 },
  { key: "Over 90 days", from: 91, to: Number.POSITIVE_INFINITY },
];

/** Which band an invoice's age falls in. */
function bandFor(days: number): string {
  return AGE_BANDS.find((band) => days >= band.from && days <= band.to)?.key ?? "Over 90 days";
}

/** How many invoices fit on the first sheet before the schedule moves to a continuation. */
const STATEMENT_SUMMARY_ROWS = 8;

/**
 * The statement: what a client owes, invoice by invoice, aged and totalled by band.
 *
 * This is the document the overdue-reminder email has never carried. That email states `invoice.total`
 * as the outstanding balance, which is the wrong figure the moment anything has been paid, so the
 * statement's balance is the one the payments make it and the two can never disagree.
 *
 * `invoiceId` narrows the statement to one invoice — the shape the reminder needs, and the shape the
 * approved mockup draws on its reminder screen — while leaving the ageing and the totals intact, so one
 * renderer serves both the account statement and the reminder attachment.
 */
async function renderStatementDocument(company: CompanyForStatement, invoiceId: string | null): Promise<string> {
  const brand = await brandForDocument("statement", company.id);
  const size = brand.presentation.pageSize;
  const generatedAt = new Date();

  const open = await openInvoicesFor(company.id);
  let rows: StatementInvoice[] = open;
  if (invoiceId) {
    // A reminder may be raised for an invoice whose status has since moved; load it on its own rather
    // than answering with an empty statement.
    if (!rows.some((invoice) => invoice.id === invoiceId)) {
      const single = await prisma.invoice.findFirst({ where: { id: invoiceId, companyId: company.id }, include: { payments: true, lineItems: true, agreement: true } });
      if (single) rows = [single];
    }
    rows = rows.filter((invoice) => invoice.id === invoiceId);
  }

  const currency = rows[0]?.currency ?? company.currency ?? "USD";
  const symbol = currencySymbol(currency);

  const lines = rows
    .map((invoice) => {
      const received = +invoice.payments.reduce((sum, payment) => sum + payment.amount, 0).toFixed(2);
      const balance = +(invoice.total - received).toFixed(2);
      const days = Math.max(0, daysBetween(invoice.dueDate, generatedAt));
      return { invoice, received, balance, days, band: bandFor(days) };
    })
    // An account statement lists what is owed. Narrowed to one invoice it lists that invoice whatever
    // its balance, because the reminder exists precisely because someone believes it is unpaid.
    .filter((line) => invoiceId !== null || line.balance > 0.005);

  const outstanding = +lines.reduce((sum, line) => sum + line.balance, 0).toFixed(2);
  const bands = AGE_BANDS.map((band) => {
    const inBand = lines.filter((line) => line.days >= band.from && line.days <= band.to);
    return { key: band.key, count: inBand.length, total: +inBand.reduce((sum, line) => sum + line.balance, 0).toFixed(2) };
  });
  const maxOverdue = lines.reduce((max, line) => Math.max(max, line.days), 0);
  const overdueCount = lines.filter((line) => line.days > 0).length;
  const single = invoiceId !== null ? lines[0] ?? null : null;
  const contact = accountsContact(brand);
  const status = maxOverdue > 0
    ? statusMark("Overdue", "overdue")
    : statusMark(single ? "Awaiting payment" : "Current", "plain");

  const metaItems = single
    ? [
        { label: "Client", value: company.name, sub: [clientLocation(company), company.clientId ? `Client account ${company.clientId}` : null].filter(Boolean).join(" \u00b7 ") || null },
        { label: "Invoice", value: single.invoice.invoiceNumber, mono: true },
        { label: "Issued", value: formatDate(single.invoice.issueDate) },
        { label: "Due", value: formatDate(single.invoice.dueDate), sub: single.days > 0 ? `${single.days} days overdue` : null, accent: single.days > 0 },
      ]
    : [
        { label: "Client", value: company.name, sub: clientLocation(company) },
        { label: "Account", value: company.clientId ? String(company.clientId) : "Not recorded" },
        { label: "Statement date", value: formatDate(generatedAt) },
        { label: "Invoices", value: String(lines.length), sub: overdueCount > 0 ? `${overdueCount} overdue` : "none overdue" },
      ];

  const dueSub = single
    ? `${single.days > 0 ? `Payable immediately \u00b7 the invoice was due ${formatDate(single.invoice.dueDate)}` : `Payable by ${formatDate(single.invoice.dueDate)}`} \u00b7 ${currencyName(currency)}`
    : `${lines.length === 1 ? "1 open invoice" : `${lines.length} open invoices`} \u00b7 ${overdueCount > 0 ? `${overdueCount} overdue` : "nothing overdue yet"} \u00b7 ${currencyName(currency)}`;

  const invoiceRows: DocTableRow[] = lines.map((line) => ({
    cells: [
      { text: line.invoice.invoiceNumber, mono: true },
      formatDate(line.invoice.issueDate),
      formatDate(line.invoice.dueDate),
      { text: line.days > 0 ? `${line.days} d` : "\u2014", sub: line.band },
      `${symbol}${money(line.invoice.total)}`,
      `${symbol}${money(line.received)}`,
      `${symbol}${money(line.balance)}`,
    ],
  }));

  const summaryRows = invoiceRows.length > STATEMENT_SUMMARY_ROWS ? invoiceRows.slice(0, STATEMENT_SUMMARY_ROWS) : invoiceRows;
  const truncated = summaryRows.length !== invoiceRows.length;

  const breakdownRows: DocTableRow[] = single
    ? [
        {
          cells: [
            {
              text: single.invoice.lineItems.length > 0
                ? single.invoice.lineItems[0]?.description ?? "Charge for this invoice"
                : single.invoice.agreement?.name ?? "Charge for this invoice",
              sub: single.invoice.lineItems.length > 1
                ? `${single.invoice.lineItems.length} lines, itemised on the invoice itself`
                : single.invoice.lineItems.length === 0
                  ? "This invoice records no itemised lines of its own"
                  : null,
            },
            "",
            `${symbol}${money(+(single.invoice.subtotal ?? 0).toFixed(2))}`,
          ],
        },
        { cells: [{ text: taxLineLabel(single.invoice.taxRate ?? 0, taxJurisdiction(company)) }, "", `${symbol}${money(+(single.invoice.taxTotal ?? 0).toFixed(2))}`] },
        { cells: ["Total invoiced", "", `${symbol}${money(+(single.invoice.total ?? 0).toFixed(2))}`] },
        { cells: ["Payments received", "", `${symbol}${money(single.received)}`] },
      ]
    : [];

  const pageOne: DocumentBlock[] = [
    letterhead(brand, "Statement", status),
    metaGrid(metaItems),
    inkRule(),
    metaLine(single
      ? `Quote <span class="dh-mono">${escapeHtml(single.invoice.invoiceNumber)}</span> on any payment${contact ? ` \u00b7 questions to <b>${escapeHtml(contact)}</b>` : ""}`
      : `Statement for the ${lines.length === 1 ? "invoice" : `${lines.length} invoices`} listed below${contact ? ` \u00b7 questions to <b>${escapeHtml(contact)}</b>` : ""}`),    amountDueBox({
      label: single ? "Balance outstanding" : "Outstanding balance",
      sub: dueSub,
      amount: single ? single.balance : outstanding,
      currency,
      overdue: maxOverdue > 0,
      footnote: maxOverdue > 0 ? `${maxOverdue} days overdue` : undefined,
    }),
    ...(lines.length === 0 ? [note("Nothing is outstanding on this account. No invoice issued to this client is unpaid.")] : []),
    ...(single
      ? [
          section("This invoice", "reminder statement"),
          tableBlock({
            columns: [{ label: "Charge" }, { label: "Period", align: "right", width: "30mm" }, { label: "Amount", align: "right", width: "32mm" }],
            rows: breakdownRows,
            totalRow: { label: "Balance outstanding", value: `${symbol}${money(single.balance)}`, span: 2 },
          }),
        ]
      : [
          section("Invoices outstanding", truncated ? `Itemised on page 2` : `${lines.length} listed`),
          tableBlock({
            columns: [
              { label: "Invoice", width: "30mm" },
              { label: "Issued", width: "24mm" },
              { label: "Due", width: "26mm" },
              { label: "Overdue", align: "right", width: "16mm" },
              { label: "Total", align: "right", width: "24mm" },
              { label: "Payments", align: "right", width: "22mm" },
              { label: "Balance", align: "right", width: "28mm" },
            ],
            rows: summaryRows,
          }),
        ]),
    ...(single
      ? []
      : [
          // An ageing summary is five figures across, not a table of five one-row entries: the shape
          // saves the sheet a page and reads as one comparison, which is what an age analysis is.
          section("Ageing"),
          metaGrid([
            { label: "Not yet due", value: `${symbol}${money(bands[0]?.total ?? 0)}`, sub: `${bands[0]?.count ?? 0} invoice${(bands[0]?.count ?? 0) === 1 ? "" : "s"}` },
            { label: "1\u201330 days", value: `${symbol}${money(bands[1]?.total ?? 0)}`, sub: `${bands[1]?.count ?? 0} invoice${(bands[1]?.count ?? 0) === 1 ? "" : "s"}` },
            { label: "31\u201360 days", value: `${symbol}${money(bands[2]?.total ?? 0)}`, sub: `${bands[2]?.count ?? 0} invoice${(bands[2]?.count ?? 0) === 1 ? "" : "s"}` },
            { label: "61\u201390 days", value: `${symbol}${money(bands[3]?.total ?? 0)}`, sub: `${bands[3]?.count ?? 0} invoice${(bands[3]?.count ?? 0) === 1 ? "" : "s"}` },
            { label: "Over 90 days", value: `${symbol}${money(bands[4]?.total ?? 0)}`, sub: `${bands[4]?.count ?? 0} invoice${(bands[4]?.count ?? 0) === 1 ? "" : "s"}` },
            { label: "Total", value: `${symbol}${money(outstanding)}`, sub: `${lines.length} open` },
          ], 6),
        ]),
  ];

  const pageOneAction: DocumentBlock[] = [payBlock({
    title: "How to pay",
      ways: [
        { label: "Bank transfer", body: "ACH or wire, quoting the reference below", reference: single ? single.invoice.invoiceNumber : "the invoice number" },
        { label: "Cheque", body: `Payable to ${brand.company}` },
        {
          label: "Card",
          body: contact ? `Online, or email ${contact} for the account details` : "Contact us and we will send the account details",
        },
      ],
      nextTitle: "What happens next",
      nextBody: maxOverdue > 0
        ? `The oldest invoice on this account is ${maxOverdue} days overdue. A reminder is sent every seven days while a balance remains, and this statement travels with it.`
        : "Each invoice is payable by its own due date. A reminder is sent every seven days once an invoice becomes overdue.",
      portalLabel: single ? "Pay this invoice" : "Pay or query this statement",
      portalUrl: queryTarget(brand, contact),
      closing: "If payment has already been sent, please ignore this statement, and thank you.",
  })];

  const continuation: DocumentBlock[] = [];
  if (truncated) {
    continuation.push(section("Invoices outstanding", "continued"));
    continuation.push(tableBlock({
      columns: [
        { label: "Invoice", width: "26mm" },
        { label: "Issued", width: "22mm" },
        { label: "Due", width: "22mm" },
        { label: "Overdue", align: "right", width: "18mm" },
        { label: "Total", align: "right", width: "25mm" },
        { label: "Payments", align: "right", width: "25mm" },
        { label: "Balance", align: "right", width: "30mm" },
      ],
      rows: invoiceRows,
      totalRow: { label: "Total outstanding", value: `${symbol}${money(outstanding)}` },
    }));
  }

  const pages: DocumentPage[] = [
    ...paginateKeepingAction(pageOne, pageOneAction, size),
    ...(truncated ? paginate(continuation, size, { continuations: true }) : []),
  ];

  const reference = single ? single.invoice.invoiceNumber : company.clientId ? `Account ${company.clientId}` : company.name;
  return renderDocument({
    brand,
    size,
    title: `Statement ${company.name}`,
    pages,
    continuationHead: (page, total) => runHead(reference, company.name, "Statement", page, total),
    terms: single
      ? paymentTerms(single.invoice.issueDate, single.invoice.dueDate)
      : "Statement of account. Each invoice is payable by its own due date.",
    generatedAt,
  });
}

/**
 * What a client owes, and the statement that says so.
 *
 * `invoice` narrows the document to a single invoice, which is the shape the overdue-reminder email
 * needs; without it the statement is the whole account, aged and totalled by band.
 */
billingRouter.get("/clients/:companyId/statement", requirePermission(Permission.BillingView), async (req: AuthRequest, res, next) => {
  try {
    const companyId = routeParam(req, "companyId");
    if (!canAccessCompany(req.user, companyId)) throw new AppError("Client not found", 404);
    const company = await companyForDocument(companyId);
    if (!company) throw new AppError("Client not found", 404);
    const invoiceId = typeof req.query.invoice === "string" && req.query.invoice ? req.query.invoice : null;
    if (invoiceId) {
      const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId }, select: { companyId: true } });
      if (!invoice || invoice.companyId !== companyId) throw new AppError("Invoice not found", 404);
    }

    const html = await renderStatementDocument(company, invoiceId);
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    res.send(html);
  } catch (e) { next(e); }
});

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
