/**
 * Pushing records to the connected accounting system (PLAN-015 Phase A #2 and #3).
 *
 * The CloudConnect adapters read from their providers; none of them can create an expense or an
 * invoice, because every provider wants different reference data (QuickBooks needs account and
 * vendor refs) that the PSA does not own. So the push is deliberately explicit rather than clever:
 *
 *   · the integration must exist, be enabled, and carry a `settings.expensePushUrl` (expenses) or
 *     `settings.invoicePushUrl` (invoices);
 *   · the request goes out through the egress policy like everything else;
 *   · whatever comes back is recorded, and a push that could not happen says why instead of
 *     pretending the record reached the other system.
 */
import { prisma } from "../index";
import { safeFetch, assertSafeUrlLiteral } from "./egress";
import { logger } from "./logger";

/** Providers that can receive billing records. */
const ACCOUNTING_KINDS = ["quickbooks", "flexpoint"] as const;

export interface PushResult {
  pushed: boolean;
  reason?: string;
  externalId?: string;
  externalSystem?: string;
}

/** The enabled accounting integration, if there is one. */
async function accountingIntegration() {
  return prisma.integration.findFirst({
    where: { kind: { in: [...ACCOUNTING_KINDS] }, enabled: true, status: { not: "error" } },
    orderBy: { updatedAt: "desc" },
  });
}

/**
 * Posts one record to the integration's configured endpoint. Everything about the outcome is in
 * the return value: callers must not have to catch to find out whether it worked.
 */
async function postToAccounting(
  settingKey: "expensePushUrl" | "invoicePushUrl",
  payload: Record<string, unknown>,
  label: string,
): Promise<PushResult> {
  const integration = await accountingIntegration();
  if (!integration) {
    return { pushed: false, reason: "No connected accounting system. Connect QuickBooks or FlexPoint in CloudConnect first." };
  }

  const settings = (integration.settings ?? {}) as Record<string, unknown>;
  const pushUrl = typeof settings[settingKey] === "string" ? settings[settingKey] as string : "";
  if (!pushUrl) {
    return { pushed: false, reason: `${integration.name} has no ${label} push URL configured (settings.${settingKey}).` };
  }

  let response: Response;
  try {
    assertSafeUrlLiteral(pushUrl);
    response = await safeFetch(pushUrl, {
      method: "POST",
      purpose: "other",
      headers: { "content-type": "application/json", ...authHeaders(settings) },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // A URL the egress policy refuses is a configuration problem, not a crash: say which URL
    // and why, and let the administrator fix the integration.
    return { pushed: false, reason: `The configured push URL could not be used: ${(err as Error).message}` };
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    logger.warn("accounting", `push to ${integration.kind} failed (${response.status})`);
    return { pushed: false, reason: `${integration.name} refused the ${label} (HTTP ${response.status})` };
  }

  let externalId = "";
  try {
    const parsed = JSON.parse(text) as { id?: string; Id?: string; expenseId?: string; invoiceId?: string };
    externalId = String(parsed.id ?? parsed.Id ?? parsed.expenseId ?? parsed.invoiceId ?? "");
  } catch { /* a provider that answers with something other than JSON still succeeded */ }

  logger.info("accounting", `pushed ${label} to ${integration.kind}`);
  return { pushed: true, externalId: externalId || undefined, externalSystem: integration.kind };
}

export async function pushExpense(expense: {
  id: string;
  description: string;
  amount: number;
  category: string;
  vendor: string | null;
  miles: number | null;
  expenseDate: Date;
  companyId: string | null;
  ticketId: string | null;
  receiptUrl: string | null;
}): Promise<PushResult> {
  if (!expense.companyId) {
    return { pushed: false, reason: "The expense is not attached to a client, so there is nothing to bill it to." };
  }

  const company = await prisma.company.findUnique({ where: { id: expense.companyId }, select: { name: true } });
  return postToAccounting("expensePushUrl", {
    reference: expense.id,
    description: expense.description,
    amount: expense.amount,
    category: expense.category,
    vendor: expense.vendor,
    miles: expense.miles,
    date: expense.expenseDate.toISOString().slice(0, 10),
    client: company?.name ?? null,
    ticketId: expense.ticketId,
    receiptUrl: expense.receiptUrl,
  }, "expense");
}

/** Pushes an issued invoice. Same rules: configured target, egress policy, honest outcome. */
export async function pushInvoice(invoice: {
  id: string;
  invoiceNumber: string;
  companyId: string;
  issueDate: Date;
  dueDate: Date;
  subtotal: number;
  taxTotal: number;
  total: number;
  lineItems?: { description: string; quantity: number; unitPrice: number; total: number }[];
}): Promise<PushResult> {
  const company = await prisma.company.findUnique({ where: { id: invoice.companyId }, select: { name: true } });
  return postToAccounting("invoicePushUrl", {
    reference: invoice.id,
    invoiceNumber: invoice.invoiceNumber,
    client: company?.name ?? null,
    issueDate: invoice.issueDate.toISOString().slice(0, 10),
    dueDate: invoice.dueDate.toISOString().slice(0, 10),
    subtotal: invoice.subtotal,
    tax: invoice.taxTotal,
    total: invoice.total,
    lines: (invoice.lineItems ?? []).map(li => ({ description: li.description, quantity: li.quantity, unitPrice: li.unitPrice, total: li.total })),
  }, "invoice");
}

/** Whatever the integration was configured with, as request headers. */
function authHeaders(settings: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {};
  if (typeof settings.expensePushToken === "string" && settings.expensePushToken) {
    headers.authorization = `Bearer ${settings.expensePushToken}`;
  }
  if (typeof settings.expensePushApiKey === "string" && settings.expensePushApiKey) {
    headers["x-api-key"] = settings.expensePushApiKey;
  }
  return headers;
}
