/**
 * C7NC → FlexPoint: the configuration surface for the FlexPoint connector.
 *
 * Reads need `IntegrationView` (the same gate the CloudConnect list uses, so a technician who can
 * see the connection can see what it brought in). Anything that writes — the options, the links,
 * a pushed invoice — needs `IntegrationManage`, and a sync needs only view because CloudConnect
 * has always let a viewer refresh a connection.
 */
import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import {
  clientAr,
  flexpointIntegration,
  flexpointOverview,
  linkCustomer,
  pushInvoiceToFlexpoint,
  readOptions,
  syncFlexpoint,
  unlinkCustomer,
  validateOptions,
} from "../services/flexpoint";

export const flexpointRouter = Router();
flexpointRouter.use(authenticate);

/** The overview the configuration page is built from: connection, options, counts, clients. */
flexpointRouter.get("/", requirePermission(Permission.IntegrationView), async (_req, res, next) => {
  try {
    res.json(await flexpointOverview());
  } catch (e) { next(e); }
});

/**
 * Save options. They live in the integration's `settings`, beside the ones the adapter reads
 * (`syncCustomers`, `syncInvoices`, `syncDeposits`, `pageSize`), which is why a partial update is
 * merged rather than replacing the object.
 */
flexpointRouter.put("/options", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const row = await flexpointIntegration();
    if (!row) throw new AppError("No FlexPoint connection exists yet. Add one in CloudConnect first.", 400);
    const options = validateOptions(req.body?.options ?? req.body);
    if (Object.keys(options).length === 0) throw new AppError("No recognised options were sent", 400);
    const settings = { ...((row.settings ?? {}) as Record<string, unknown>), ...options };
    const updated = await prisma.integration.update({ where: { id: row.id }, data: { settings } });
    res.json({ settings: updated.settings, options: readOptions(updated.settings) });
  } catch (e) { next(e); }
});

/** Pull now. The same code path CloudConnect's Sync button takes for a FlexPoint connection. */
flexpointRouter.post("/sync", requirePermission(Permission.IntegrationView), async (_req, res, next) => {
  try {
    res.json(await syncFlexpoint());
  } catch (e) { next(e); }
});

/**
 * Link a FlexPoint customer to a client, or clear the link (`customerId: null`). Linking writes the
 * client id into the customer's external reference when that option is on, and replaces any
 * previous customer for the client — a client's receivable must be one account, not two.
 */
flexpointRouter.post("/link", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    const { companyId, customerId } = req.body as { companyId?: string; customerId?: string | null };
    if (!companyId) throw new AppError("companyId is required", 400);
    if (customerId === null || customerId === undefined || customerId === "") {
      const cleared = await unlinkCustomer(companyId);
      res.json({ linked: false, cleared });
      return;
    }
    const row = await flexpointIntegration();
    if (!row) throw new AppError("No FlexPoint connection exists yet. Add one in CloudConnect first.", 400);
    res.json({ linked: true, ...(await linkCustomer(companyId, String(customerId), readOptions(row.settings))) });
  } catch (e) { next(e); }
});

/** One client's receivable, for the client record and the clients table. */
flexpointRouter.get("/clients/:companyId", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    res.json(await clientAr(req.params.companyId!));
  } catch (e) { next(e); }
});

/**
 * Local invoices that could be pushed, with the state of any push already made — what the page's
 * invoice list is drawn from.
 */
flexpointRouter.get("/invoices", requirePermission(Permission.IntegrationView), async (req: AuthRequest, res, next) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 25, 100);
    const row = await flexpointIntegration();
    const options = readOptions(row?.settings);
    const invoices = await prisma.invoice.findMany({
      where: { quoteStatus: null },
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true, invoiceNumber: true, status: true, total: true, issueDate: true, dueDate: true,
        flexpointInvoiceId: true, flexpointPushedAt: true,
        company: { select: { id: true, name: true } },
        _count: { select: { lineItems: true } },
      },
    });
    const pushed = await prisma.payment.findMany({
      where: { method: "flexpoint", invoiceId: { in: invoices.map(invoice => invoice.id) } },
      select: { invoiceId: true, amount: true, reference: true },
    });
    const paidByInvoice = new Map<string, number>();
    for (const payment of pushed) paidByInvoice.set(payment.invoiceId, (paidByInvoice.get(payment.invoiceId) ?? 0) + payment.amount);
    res.json({
      pushEnabled: options.pushInvoices,
      data: invoices.map(invoice => ({
        id: invoice.id,
        invoiceNumber: invoice.invoiceNumber,
        status: invoice.status,
        total: invoice.total,
        companyId: invoice.company.id,
        companyName: invoice.company.name,
        lineItems: invoice._count.lineItems,
        flexpointInvoiceId: invoice.flexpointInvoiceId,
        flexpointPushedAt: invoice.flexpointPushedAt?.toISOString() ?? null,
        flexpointPaid: paidByInvoice.get(invoice.id) ?? 0,
      })),
    });
  } catch (e) { next(e); }
});

/** Push one invoice through the merchant API. Off unless the option says otherwise. */
flexpointRouter.post("/invoices/:invoiceId/push", requirePermission(Permission.IntegrationManage), async (req: AuthRequest, res, next) => {
  try {
    res.json(await pushInvoiceToFlexpoint(req.params.invoiceId!));
  } catch (e) { next(e); }
});
