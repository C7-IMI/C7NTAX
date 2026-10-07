/**
 * Bill-through batch invoicing (PLAN-015 Phase A #3).
 *
 * The shape of the problem: money earned in a period — time and approved expenses — has to
 * become invoices, but nobody wants a script emailing clients something no human has looked at.
 * So the batch is a two-step artefact:
 *
 *   1. **Preview** works out what would be billed per client and writes nothing.
 *   2. **Create** turns that into *Draft* invoices, held by the batch.
 *   3. **Approve** issues them and pushes them to the accounting system; **reject** throws the
 *      drafts away and leaves the time and expenses unbilled for the next run.
 *
 * Rates come from, in order: the time entry's own rate, the agreement's hourly rate, then the
 * agreement's recurring amount as the day-rate convention the single-client generator already
 * used. Weighted minutes (`billedMinutes`) are what the time engine decided is chargeable, so
 * the overtime rule reaches the invoice.
 */
import { prisma } from "../index";
import { InvoiceStatus } from "@C7NTAX/shared";
import { pushInvoice } from "./accountingSync";
import { logger } from "./logger";
import { configFlag } from "./appSettings";

export const invoiceBatchEnabled = (): boolean => configFlag("billing", "invoiceBatch");

const FALLBACK_HOURLY = 150;

export interface BatchLinePreview {
  description: string;
  quantity: number;
  unitPrice: number;
  total: number;
  source: "time" | "expense";
}

export interface BatchClientPreview {
  companyId: string;
  companyName: string;
  agreementId: string | null;
  agreementName: string | null;
  timeEntryIds: string[];
  expenseIds: string[];
  hours: number;
  lineItems: BatchLinePreview[];
  subtotal: number;
  alreadyBilledThrough: string | null;
}

export interface BatchPreview {
  billThroughDate: string;
  clients: BatchClientPreview[];
  totals: { clients: number; invoicesAmount: number; hours: number; expenses: number };
}

interface PreviewInput {
  billThroughDate: Date;
  companyIds?: string[];
  /** Restrict to clients the caller may see (scope enforcement lives in the route). */
  scopeCompanyId?: string | null;
}

/** Everything a batch would bill, without writing anything. */
export async function previewBatch(input: PreviewInput): Promise<BatchPreview> {
  const { billThroughDate } = input;
  const companyFilter = input.companyIds?.length
    ? { id: { in: input.companyIds } }
    : input.scopeCompanyId
      ? { id: input.scopeCompanyId }
      : {};

  // Time and expenses are "unbilled" by the absence of an invoice, not by a flag, which is the
  // same rule the existing single-client generator uses.
  const scopedCompanyIds = input.companyIds?.length
    ? input.companyIds
    : input.scopeCompanyId
      ? [input.scopeCompanyId]
      : null;

  const [timeEntries, expenses] = await Promise.all([
    prisma.timeEntry.findMany({
      where: {
        invoiceId: null,
        billable: true,
        noCharge: false,
        date: { lte: billThroughDate },
        ticket: { companyId: scopedCompanyIds ? { in: scopedCompanyIds } : undefined },
      },
      include: {
        ticket: { select: { id: true, ticketNumber: true, companyId: true, company: { select: { id: true, name: true } }, serviceAgreementId: true } },
        user: { select: { firstName: true, lastName: true } },
      },
    }),
    // `Expense` reaches its client by id rather than through a relation, so the names are
    // resolved separately below.
    prisma.expense.findMany({
      where: {
        invoiceId: null,
        status: "approved",
        expenseDate: { lte: billThroughDate },
        companyId: scopedCompanyIds ? { in: scopedCompanyIds } : { not: null },
      },
    }),
  ]);

  const companyNames = new Map(
    (await prisma.company.findMany({ where: { id: { in: expenses.map(e => e.companyId!) } }, select: { id: true, name: true } }))
      .map(c => [c.id, c.name]),
  );

  const agreements = await prisma.serviceAgreement.findMany({
    where: { id: { in: timeEntries.map(t => t.ticket?.serviceAgreementId).filter((id): id is string => !!id) } },
  });
  const agreementById = new Map(agreements.map(a => [a.id, a]));

  const companies = new Map<string, BatchClientPreview>();
  const ensureClient = (companyId: string, companyName: string): BatchClientPreview => {
    let entry = companies.get(companyId);
    if (!entry) {
      entry = { companyId, companyName, agreementId: null, agreementName: null, timeEntryIds: [], expenseIds: [], hours: 0, lineItems: [], subtotal: 0, alreadyBilledThrough: null };
      companies.set(companyId, entry);
    }
    return entry;
  };

  for (const entry of timeEntries) {
    const companyId = entry.ticket?.companyId;
    if (!companyId) continue;
    const client = ensureClient(companyId, entry.ticket?.company?.name ?? "Unknown client");
    const agreement = entry.ticket?.serviceAgreementId ? agreementById.get(entry.ticket.serviceAgreementId) : undefined;
    if (agreement && !client.agreementId) {
      client.agreementId = agreement.id;
      client.agreementName = agreement.name;
    }
    const rate = entry.rate && entry.rate > 0
      ? entry.rate
      : agreement?.hourlyRate && agreement.hourlyRate > 0
        ? agreement.hourlyRate
        : agreement && agreement.billingAmount > 0
          ? agreement.billingAmount
          : FALLBACK_HOURLY;
    const minutes = entry.billedMinutes ?? entry.minutes;
    const quantity = +(minutes / 60).toFixed(2);
    const description = entry.description?.trim()
      ? entry.description.trim()
      : `${entry.ticket?.ticketNumber ?? "Ticket"} — ${entry.user ? `${entry.user.firstName} ${entry.user.lastName}`.trim() : "time"}`;
    client.timeEntryIds.push(entry.id);
    client.hours = +(client.hours + quantity).toFixed(2);
    client.lineItems.push({ description, quantity, unitPrice: rate, total: +(quantity * rate).toFixed(2), source: "time" });
  }

  for (const expense of expenses) {
    if (!expense.companyId) continue;
    const client = ensureClient(expense.companyId, companyNames.get(expense.companyId) ?? "Unknown client");
    const parts = [expense.description, expense.vendor ? `(${expense.vendor})` : null, expense.miles ? `${expense.miles} mi` : null].filter(Boolean);
    client.expenseIds.push(expense.id);
    client.lineItems.push({
      description: parts.join(" "),
      quantity: 1,
      unitPrice: expense.amount,
      total: expense.amount,
      source: "expense",
    });
  }

  const clientList = [...companies.values()]
    .map(client => ({ ...client, subtotal: +(client.lineItems.reduce((sum, li) => sum + li.total, 0)).toFixed(2) }))
    .sort((a, b) => b.subtotal - a.subtotal);

  if (clientList.length) {
    const billed = await prisma.company.findMany({ where: { id: { in: clientList.map(c => c.companyId) } }, select: { id: true, billThroughDate: true } });
    const byId = new Map(billed.map(c => [c.id, c.billThroughDate]));
    for (const client of clientList) {
      const through = byId.get(client.companyId);
      client.alreadyBilledThrough = through ? through.toISOString() : null;
    }
  }

  return {
    billThroughDate: billThroughDate.toISOString(),
    clients: clientList,
    totals: {
      clients: clientList.length,
      invoicesAmount: +clientList.reduce((sum, c) => sum + c.subtotal, 0).toFixed(2),
      hours: +clientList.reduce((sum, c) => sum + c.hours, 0).toFixed(2),
      expenses: clientList.reduce((sum, c) => sum + c.expenseIds.length, 0),
    },
  };
}

/** Turns a preview into draft invoices held by a batch. */
export async function createBatch(input: PreviewInput & { createdById: string; notes?: string | null; companyIds?: string[] }) {
  const preview = await previewBatch(input);
  if (preview.clients.length === 0) {
    return { batch: null, preview };
  }

  const batch = await prisma.billingBatch.create({
    data: { billThroughDate: input.billThroughDate, createdById: input.createdById, notes: input.notes ?? null, status: "preview" },
  });

  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + 30);
  const invoices: { id: string; invoiceNumber: string; companyId: string; total: number }[] = [];

  for (const client of preview.clients) {
    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: `INV-${Date.now().toString(36).toUpperCase()}-${invoices.length + 1}`,
        companyId: client.companyId,
        agreementId: client.agreementId,
        issueDate: new Date(),
        dueDate,
        subtotal: client.subtotal,
        taxRate: 0,
        taxTotal: 0,
        total: client.subtotal,
        status: InvoiceStatus.Draft,
        batchId: batch.id,
        lineItems: { create: client.lineItems.map(li => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })) },
      },
      include: { lineItems: true },
    });
    invoices.push(invoice);

    // Claim the work so a second run cannot bill it twice.
    await prisma.timeEntry.updateMany({ where: { id: { in: client.timeEntryIds } }, data: { invoiceId: invoice.id } });
    await prisma.expense.updateMany({ where: { id: { in: client.expenseIds } }, data: { invoiceId: invoice.id, status: "billed" } });
  }

  logger.info("billing", `batch ${batch.id} prepared ${invoices.length} draft invoice(s) through ${input.billThroughDate.toISOString().slice(0, 10)}`);
  return { batch, preview, invoices };
}

export interface BatchApprovalResult {
  invoiceId: string;
  invoiceNumber: string;
  companyId: string;
  total: number;
  issued: boolean;
  issuedAt?: string;
  pushed?: boolean;
  pushReason?: string;
}

/**
 * Issues the batch: every draft becomes a sent invoice, the client's bill-through date moves,
 * and each invoice is offered to the accounting system. A push that could not happen does not
 * fail the approval — the invoice is real either way, and the reason comes back with it.
 */
export async function approveBatch(batchId: string, approverId: string): Promise<{ batch: unknown; results: BatchApprovalResult[] }> {
  const batch = await prisma.billingBatch.findUnique({ where: { id: batchId }, include: { invoices: { include: { lineItems: true } } } });
  if (!batch) throw Object.assign(new Error("Batch not found"), { status: 404 });
  if (batch.status === "approved") throw Object.assign(new Error("This batch has already been approved"), { status: 409 });
  if (batch.status === "rejected") throw Object.assign(new Error("This batch was rejected"), { status: 409 });

  const results: BatchApprovalResult[] = [];
  for (const invoice of batch.invoices) {
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: InvoiceStatus.Sent } });
    const push = await pushInvoice(invoice);
    results.push({
      invoiceId: invoice.id,
      invoiceNumber: invoice.invoiceNumber,
      companyId: invoice.companyId,
      total: invoice.total,
      issued: true,
      issuedAt: new Date().toISOString(),
      pushed: push.pushed,
      pushReason: push.reason,
    });
  }

  const updated = await prisma.billingBatch.update({
    where: { id: batch.id },
    data: { status: "approved", approvedAt: new Date(), approvedById: approverId },
  });

  // Each client's marker is the batch's date: what has been billed, and therefore how far the
  // next run starts from.
  const companyIds = [...new Set(batch.invoices.map(i => i.companyId))];
  for (const companyId of companyIds) {
    const current = await prisma.company.findUnique({ where: { id: companyId }, select: { billThroughDate: true } });
    if (!current?.billThroughDate || current.billThroughDate < batch.billThroughDate) {
      await prisma.company.update({ where: { id: companyId }, data: { billThroughDate: batch.billThroughDate } });
    }
  }

  logger.info("billing", `batch ${batch.id} approved: ${results.length} invoice(s) issued`);
  return { batch: updated, results };
}

/** Discards a batch, returning its work to the unbilled pool. */
export async function rejectBatch(batchId: string, reason: string, rejectedById: string) {
  const batch = await prisma.billingBatch.findUnique({ where: { id: batchId }, include: { invoices: true } });
  if (!batch) throw Object.assign(new Error("Batch not found"), { status: 404 });
  if (batch.status === "approved") {
    throw Object.assign(new Error("An approved batch cannot be discarded — void the invoices instead"), { status: 409 });
  }

  const invoiceIds = batch.invoices.map(i => i.id);
  await prisma.timeEntry.updateMany({ where: { invoiceId: { in: invoiceIds } }, data: { invoiceId: null } });
  await prisma.expense.updateMany({ where: { invoiceId: { in: invoiceIds } }, data: { invoiceId: null, status: "approved" } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoiceId: { in: invoiceIds } } });
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } });

  const updated = await prisma.billingBatch.update({
    where: { id: batch.id },
    data: { status: "rejected", notes: reason.slice(0, 500), approvedById: rejectedById, approvedAt: new Date() },
  });
  logger.info("billing", `batch ${batch.id} rejected: ${invoiceIds.length} draft invoice(s) discarded`);
  return { batch: updated, discarded: invoiceIds.length };
}
