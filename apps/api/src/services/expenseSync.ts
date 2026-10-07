/**
 * Pushing an approved expense to the connected accounting system (PLAN-015 Phase A #2).
 *
 * The CloudConnect adapters read from their providers; none of them can create an expense, because
 * every provider wants different reference data (QuickBooks needs account and vendor refs) that the
 * PSA does not own. So the push is deliberately explicit rather than clever:
 *
 *   · the integration must exist, be enabled, and carry a `settings.expensePushUrl`;
 *   · the request goes out through the egress policy like everything else;
 *   · whatever comes back is recorded, and a push that could not happen says why instead of
 *     pretending the expense reached the other system.
 */
import { prisma } from "../index";
import { safeFetch, assertSafeUrlLiteral } from "./egress";
import { logger } from "./logger";

/** Providers that can receive an expense. */
const ACCOUNTING_KINDS = ["quickbooks", "flexpoint"] as const;

export interface PushResult {
  pushed: boolean;
  reason?: string;
  externalId?: string;
  externalSystem?: string;
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

  const integration = await prisma.integration.findFirst({
    where: { kind: { in: [...ACCOUNTING_KINDS] }, enabled: true, status: { not: "error" } },
    orderBy: { updatedAt: "desc" },
  });
  if (!integration) {
    return { pushed: false, reason: "No connected accounting system. Connect QuickBooks or FlexPoint in CloudConnect first." };
  }

  const settings = (integration.settings ?? {}) as Record<string, unknown>;
  const pushUrl = typeof settings.expensePushUrl === "string" ? settings.expensePushUrl : "";
  if (!pushUrl) {
    return {
      pushed: false,
      reason: `${integration.name} has no expense push URL configured (settings.expensePushUrl).`,
    };
  }

  const company = await prisma.company.findUnique({ where: { id: expense.companyId }, select: { name: true } });
  const payload = {
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
  };

  let response: Response;
  try {
    assertSafeUrlLiteral(pushUrl);
    response = await safeFetch(pushUrl, {
      method: "POST",
      purpose: "other",
      headers: {
        "content-type": "application/json",
        ...authHeaders(settings),
      },
      body: JSON.stringify(payload),
    });
  } catch (err) {
    // A URL the egress policy refuses is a configuration problem, not a crash: say which URL
    // and why, and let the administrator fix the integration.
    return { pushed: false, reason: `The configured push URL could not be used: ${(err as Error).message}` };
  }

  const text = await response.text().catch(() => "");
  if (!response.ok) {
    logger.warn("expenses", `push to ${integration.kind} failed (${response.status})`);
    return { pushed: false, reason: `${integration.name} refused the expense (HTTP ${response.status})` };
  }

  let externalId = "";
  try {
    const parsed = JSON.parse(text) as { id?: string; Id?: string; expenseId?: string };
    externalId = String(parsed.id ?? parsed.Id ?? parsed.expenseId ?? "");
  } catch { /* a provider that answers with something other than JSON still succeeded */ }

  logger.info("expenses", `pushed expense ${expense.id} to ${integration.kind}`);
  return { pushed: true, externalId: externalId || undefined, externalSystem: integration.kind };
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
