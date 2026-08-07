import type { Invoice, InvoiceLineItem } from "@C7NTAX/shared";
import PDFDocument from "pdfkit";
import { WritableStream } from "stream/web"; // stub — real impl uses 'stream'

/**
 * Generates a professional PDF invoice from an Invoice object.
 * Uses PDFKit for layout. Returns a Buffer ready to attach to email.
 */
export async function generateInvoicePdf(invoice: Invoice): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "A4",
      margin: 50,
      info: {
        Title: `Invoice ${invoice.invoiceNumber}`,
        Author: "C7NTAX",
        Subject: `Invoice #${invoice.invoiceNumber}`,
      },
    });

    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    // ── Header ──
    doc
      .fontSize(24)
      .font("Helvetica-Bold")
      .text("INVOICE", { align: "right" })
      .fontSize(10)
      .font("Helvetica")
      .text(`# ${invoice.invoiceNumber}`, { align: "right" })
      .moveDown(0.5);

    // ── Company & Client Info ──
    const topY = doc.y;
    doc
      .fontSize(12)
      .font("Helvetica-Bold")
      .text("C7NTAX", 50, topY)
      .font("Helvetica")
      .fontSize(9)
      .text("Cyber 7 Group")
      .text("contact@cyber7group.com")
      .moveDown(0.5);

    doc
      .fontSize(10)
      .font("Helvetica-Bold")
      .text("Bill To:", 350, topY)
      .font("Helvetica")
      .text(invoice.clientName || "Client")
      .moveDown(1);

    // ── Dates ──
    doc
      .fontSize(9)
      .text(`Issue Date: ${new Date(invoice.issueDate).toLocaleDateString()}`)
      .text(`Due Date: ${new Date(invoice.dueDate).toLocaleDateString()}`)
      .text(`Status: ${invoice.status.toUpperCase()}`)
      .moveDown(1);

    // ── Line Items Table ──
    const tableTop = doc.y;
    const columns = {
      description: { x: 50, width: 220 },
      quantity: { x: 270, width: 60 },
      rate: { x: 330, width: 80 },
      amount: { x: 410, width: 90 },
    };

    // Table header
    doc
      .font("Helvetica-Bold")
      .fontSize(9)
      .text("Description", columns.description.x, tableTop)
      .text("Qty", columns.quantity.x, tableTop)
      .text("Rate", columns.rate.x, tableTop)
      .text("Amount", columns.amount.x, tableTop);

    // Header underline
    doc
      .moveTo(50, tableTop + 14)
      .lineTo(500, tableTop + 14)
      .strokeColor("#cccccc")
      .stroke();

    // Line items
    let y = tableTop + 20;
    for (const item of invoice.lineItems) {
      doc
        .font("Helvetica")
        .fontSize(9)
        .text(item.description, columns.description.x, y, {
          width: columns.description.width,
        })
        .text(String(item.quantity), columns.quantity.x, y)
        .text(`$${item.unitPrice.toFixed(2)}`, columns.rate.x, y)
        .text(`$${item.total.toFixed(2)}`, columns.amount.x, y);

      y += 18;

      // Page break if near bottom
      if (y > 700) {
        doc.addPage();
        y = 50;
      }
    }

    // ── Totals ──
    const totalsX = 330;
    y += 10;
    doc.moveTo(totalsX, y).lineTo(500, y).strokeColor("#cccccc").stroke();
    y += 8;

    doc
      .font("Helvetica")
      .fontSize(10)
      .text("Subtotal:", totalsX, y)
      .text(`$${invoice.subtotal.toFixed(2)}`, columns.amount.x, y);
    y += 16;

    if (invoice.taxTotal > 0) {
      doc
        .text(
          `Tax (${((invoice.taxRate || 0) * 100).toFixed(1)}%):`,
          totalsX,
          y
        )
        .text(`$${invoice.taxTotal.toFixed(2)}`, columns.amount.x, y);
      y += 16;
    }

    doc
      .font("Helvetica-Bold")
      .fontSize(12)
      .text("Total Due:", totalsX, y)
      .text(`$${invoice.total.toFixed(2)}`, columns.amount.x, y);

    // ── Footer ──
    doc
      .fontSize(8)
      .font("Helvetica")
      .fillColor("#888888")
      .text("Thank you for your business.", 50, 750, { align: "center" })
      .text("C7NTAX — Cyber 7 Group | Payment terms: Net 30", {
        align: "center",
      });

    doc.end();
  });
}

export { BillingEngine } from "./BillingEngine";
