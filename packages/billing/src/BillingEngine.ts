import {
  InvoiceStatus,
  BillingPeriod,
  type Invoice,
  type ServiceAgreement,
  type InvoiceLineItem,
} from "@c7-overwatch/shared";
import type { EmailService } from "@c7-overwatch/email";

// ─── Invoice Number Generator ───────────────────────────────────────

let invoiceCounter = 10000;

export function generateInvoiceNumber(): string {
  invoiceCounter++;
  const year = new Date().getFullYear();
  return `C7-INV-${year}-${String(invoiceCounter).padStart(5, "0")}`;
}

// ─── Period Calculations ────────────────────────────────────────────

/**
 * Given a billing period enum, return the next billing date after `from`.
 */
export function nextBillingDate(from: Date, period: BillingPeriod): Date {
  const d = new Date(from);
  switch (period) {
    case BillingPeriod.Weekly:
      d.setDate(d.getDate() + 7);
      break;
    case BillingPeriod.Monthly:
      d.setMonth(d.getMonth() + 1);
      break;
    case BillingPeriod.Quarterly:
      d.setMonth(d.getMonth() + 3);
      break;
    case BillingPeriod.SemiAnnually:
      d.setMonth(d.getMonth() + 6);
      break;
    case BillingPeriod.Annually:
      d.setFullYear(d.getFullYear() + 1);
      break;
    case BillingPeriod.OneTime:
    default:
      // one-time has no next
      break;
  }
  return d;
}

/**
 * Return the number of days in a billing period (approximate for scheduling).
 */
export function periodDays(period: BillingPeriod): number {
  switch (period) {
    case BillingPeriod.Weekly: return 7;
    case BillingPeriod.Monthly: return 30;
    case BillingPeriod.Quarterly: return 90;
    case BillingPeriod.SemiAnnually: return 180;
    case BillingPeriod.Annually: return 365;
    default: return 0;
  }
}

// ─── Billing Engine ─────────────────────────────────────────────────

export interface BillingEngineDeps {
  emailService: EmailService;
  /** Persist invoice to database */
  saveInvoice(invoice: Invoice): Promise<Invoice>;
  /** Fetch service agreements due for invoicing */
  getDueAgreements(): Promise<ServiceAgreement[]>;
  /** Fetch existing invoices for filtering */
  getInvoicesByAgreement(agreementId: string): Promise<Invoice[]>;
  /** Mark an agreement's last invoiced date */
  updateAgreementInvoiceDate(agreementId: string, date: Date): Promise<void>;
}

export class BillingEngine {
  constructor(private deps: BillingEngineDeps) {}

  /**
   * Run the billing cycle:
   * 1. Find all service agreements whose next invoice date ≤ now.
   * 2. Generate invoice for each.
   * 3. Send invoice email to the client.
   * 4. Update agreement's last invoiced date.
   */
  async runBillingCycle(): Promise<Invoice[]> {
    const agreements = await this.deps.getDueAgreements();
    const generated: Invoice[] = [];

    for (const agreement of agreements) {
      if (agreement.billingPeriod === BillingPeriod.OneTime) {
        // Check if already invoiced
        const existing = await this.deps.getInvoicesByAgreement(agreement.id);
        if (existing.length > 0) continue;
      }

      const invoice = await this.generateInvoice(agreement);
      const saved = await this.deps.saveInvoice(invoice);

      await this.deps.updateAgreementInvoiceDate(
        agreement.id,
        nextBillingDate(new Date(), agreement.billingPeriod)
      );

      // Send invoice email to client
      await this.sendInvoiceEmail(saved);
      generated.push(saved);
    }

    return generated;
  }

  /**
   * Build an invoice from a service agreement.
   */
  async generateInvoice(agreement: ServiceAgreement): Promise<Invoice> {
    const lineItems: InvoiceLineItem[] = agreement.services.map((svc) => ({
      id: `li_${crypto.randomUUID().slice(0, 8)}`,
      invoiceId: "", // filled on save
      description: svc.name,
      quantity: svc.quantity ?? 1,
      unitPrice: svc.unitPrice,
      total: (svc.quantity ?? 1) * svc.unitPrice,
      taxRate: agreement.taxRate ?? 0,
    }));

    const subtotal = lineItems.reduce((sum, li) => sum + li.total, 0);
    const tax = lineItems.reduce(
      (sum, li) => sum + li.total * (li.taxRate / 100),
      0
    );

    return {
      id: `inv_${crypto.randomUUID().slice(0, 8)}`,
      number: generateInvoiceNumber(),
      clientId: agreement.clientId,
      agreementId: agreement.id,
      status: InvoiceStatus.Draft,
      lineItems,
      subtotal: Math.round(subtotal * 100) / 100,
      tax: Math.round(tax * 100) / 100,
      total: Math.round((subtotal + tax) * 100) / 100,
      currency: "USD",
      issuedDate: new Date().toISOString(),
      dueDate: this.calculateDueDate(agreement),
      paidDate: null,
      notes: "",
      sentDate: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
  }

  /**
   * Calculate an invoice due date (default: net 30).
   */
  calculateDueDate(agreement: ServiceAgreement): string {
    const issued = new Date();
    if (agreement.customFields?.netTerms) {
      issued.setDate(issued.getDate() + Number(agreement.customFields.netTerms));
    } else {
      issued.setDate(issued.getDate() + 30); // net 30 default
    }
    return issued.toISOString();
  }

  /**
   * Send invoice email to client
   */
  async sendInvoiceEmail(invoice: Invoice): Promise<void> {
    await this.deps.emailService.sendInvoiceEmail({
      to: invoice.clientId, // Resolved to client email by caller
      invoiceNumber: invoice.number,
      total: invoice.total,
      dueDate: invoice.dueDate,
    });
  }

  /**
   * Mark an invoice as sent and notify client.
   */
  async sendInvoice(
    invoice: Invoice,
    clientEmail: string,
    clientName: string
  ): Promise<Invoice> {
    const updated: Invoice = {
      ...invoice,
      status: InvoiceStatus.Sent,
      sentDate: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await this.deps.saveInvoice(updated);
    await this.deps.emailService.sendInvoiceEmail({
      to: clientEmail,
      invoiceNumber: invoice.number,
      total: invoice.total,
      dueDate: invoice.dueDate,
    });
    return updated;
  }

  /**
   * Automatic follow-up for unpaid invoices.
   * Called by the background job scheduler.
   */
  async sendOverdueReminders(
    overdueInvoices: Invoice[],
    clientEmailResolver: (clientId: string) => Promise<string>
  ): Promise<void> {
    for (const invoice of overdueInvoices) {
      const email = await clientEmailResolver(invoice.clientId);
      await this.deps.emailService.sendInvoiceReminder({
        to: email,
        invoiceNumber: invoice.number,
        total: invoice.total,
        dueDate: invoice.dueDate,
        daysOverdue: this.daysSince(new Date(invoice.dueDate)),
      });
    }
  }

  private daysSince(date: Date): number {
    return Math.floor(
      (Date.now() - date.getTime()) / (1000 * 60 * 60 * 24)
    );
  }
}

// ─── PDF Invoice Generator ──────────────────────────────────────────

/**
 * Generates a PDF invoice from an Invoice object.
 * Uses PDFKit for layout.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  // In production, use PDFKit to build the PDF layout.
  // const PDFDocument = (await import("pdfkit")).default;
  // const doc = new PDFDocument({ margin: 50 });
  // ... build PDF with invoice header, line items table, totals footer
  // return doc as unknown as Buffer;

  // Stub returns empty buffer
  return Buffer.from(`Invoice ${invoice.number} — Total: $${invoice.total}`);
}
