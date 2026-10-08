-- References a pushed invoice back to FlexPoint's merchant API.
-- `flexpointInvoiceId` is FlexPoint's `invoiceId` (int64, stored as text so the column does not
-- imply arithmetic), and it is what makes the push idempotent: an invoice that already carries one
-- is PUT rather than POSTed again. It is also how a settled FlexPoint payment finds the local
-- invoice it belongs to when payments are recorded automatically.

ALTER TABLE "Invoice" ADD COLUMN "flexpointInvoiceId" TEXT;
ALTER TABLE "Invoice" ADD COLUMN "flexpointPushedAt" TIMESTAMP(3);

CREATE INDEX "Invoice_flexpointInvoiceId_idx" ON "Invoice"("flexpointInvoiceId");
