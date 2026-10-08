/**
 * The FlexPoint side of the application — what C7NTAX does with FlexPoint's merchant API.
 *
 * The adapter (packages/integrations) speaks HTTP to FlexPoint; this service is what the
 * application does with the answers, and it is deliberately the *only* place that decides:
 *
 *   · which records are pulled and where they are stored (`SyncedEntity`, so there is one generic
 *     store for third-party records rather than a table per vendor);
 *   · how a FlexPoint customer becomes a C7NTAX client — by `externalUri` first, then by a unique
 *     exact name, and only by creating a client when that has been switched on;
 *   · that a settled FlexPoint invoice can be recorded against the local invoice it was pushed as
 *     (payments live in `Payment` with method "flexpoint" and reference "flexpoint:<invoiceId>",
 *     which is what makes the recording idempotent);
 *   · that a local invoice can be pushed to FlexPoint through the same API the CloudConnect
 *     adapters read from, instead of a hand-configured URL.
 *
 * Every switch below is read from the integration's `settings`, and every one of them changes what
 * happens. Nothing here invents a FlexPoint field: the write payloads follow `PostCustomerRequest`,
 * `PutCustomerRequest`, `PostInvoiceRequest` and `PutInvoiceRequest` from FlexPoint's own OpenAPI
 * document, including its `additionalProperties: false`, which is why optional keys are omitted
 * rather than sent empty.
 */
import { prisma } from "../index";
import { AppError } from "../middleware/errorHandler";
import { FlexpointAdapter } from "@C7NTAX/integrations";
import type {
  FlexpointInvoiceStatus,
  FlexpointRecord,
  IntegrationConfig,
} from "@C7NTAX/integrations";

/** FlexPoint's own invoice status enum. */
const INVOICE_STATUSES: FlexpointInvoiceStatus[] = ["Draft", "Posted", "Paid", "Processing", "Void"];

export interface FlexpointOptions {
  /** Which of the merchant's records are pulled. Each maps to one list endpoint. */
  syncCustomers: boolean;
  syncInvoices: boolean;
  syncDeposits: boolean;
  /** `page_size` for every list request; FlexPoint's own default is 50 and its maximum 200. */
  pageSize: number;
  /**
   * How a FlexPoint customer is matched to a client:
   * `externalUri` — only a customer carrying the client's id in its external reference;
   * `externalUriOrName` — that, then a unique exact name match;
   * `name` — the name only.
   */
  matchRule: "externalUri" | "externalUriOrName" | "name";
  /** Create a client for a customer that matches nothing. Off by default: it writes to the CRM. */
  createMissingClients: boolean;
  /** Write the client's id into the customer's external reference when a link is made. */
  writeBackExternalUri: boolean;
  /**
   * Record a settled FlexPoint invoice as a payment on the local invoice it was pushed as, and
   * mark that invoice paid or partial. Off by default: it writes to the ledger.
   */
  recordSettledPayments: boolean;
  /** Allow a local invoice to be pushed to FlexPoint. Off by default: it writes to the AR system. */
  pushInvoices: boolean;
  /** The status a pushed invoice is created with. */
  pushStatus: FlexpointInvoiceStatus;
}

export const DEFAULT_FLEXPOINT_OPTIONS: FlexpointOptions = {
  syncCustomers: true,
  syncInvoices: true,
  syncDeposits: true,
  pageSize: 50,
  matchRule: "externalUriOrName",
  createMissingClients: false,
  writeBackExternalUri: true,
  recordSettledPayments: false,
  pushInvoices: false,
  pushStatus: "Draft",
};

export const FLEXPOINT_OPTION_META: Array<{ key: keyof FlexpointOptions; label: string; hint: string; group: string }> = [
  { key: "syncCustomers", label: "Customers", group: "What to pull", hint: "GET /api/merchant/v1/Customers — the merchant's customers, which are what get linked to your clients." },
  { key: "syncInvoices", label: "Invoices", group: "What to pull", hint: "GET /api/merchant/v1/Invoices — amounts, dates, status and the outstanding balance per invoice." },
  { key: "syncDeposits", label: "Deposits", group: "What to pull", hint: "GET /api/merchant/v1/Deposits — payouts settled to the merchant's bank account. FlexPoint does not attach a deposit to a customer, so these stay merchant-level." },
  { key: "pageSize", label: "Records per request (page_size)", group: "What to pull", hint: "FlexPoint's default is 50 and its maximum 200." },
  { key: "matchRule", label: "Client matching", group: "How customers become clients", hint: "Which of a customer's fields may tie it to one of your clients." },
  { key: "createMissingClients", label: "Create clients for unmatched customers", group: "How customers become clients", hint: "Off: an unmatched customer is listed as unlinked and waits for you. On: a client is created from the customer's name and address." },
  { key: "writeBackExternalUri", label: "Write the client id back to FlexPoint", group: "How customers become clients", hint: "PUT /Customers/{id} with externalUri set to the client's id, so the link survives a rename on either side. FlexPoint requires the customer's name on every update, and that is sent too." },
  { key: "recordSettledPayments", label: "Record settled payments on pushed invoices", group: "What to write back", hint: "When a FlexPoint invoice you pushed has been paid, add a payment to the local invoice (method flexpoint, reference flexpoint:<invoiceId>) and mark it paid — or partial, if only part has been received. Recorded once: the reference stops it being added twice." },
  { key: "pushInvoices", label: "Push invoices to FlexPoint", group: "What to write back", hint: "Lets a C7NTAX invoice be created in FlexPoint through the merchant API — and lets the accounting push use it instead of a configured URL." },
  { key: "pushStatus", label: "Status for pushed invoices", group: "What to write back", hint: "FlexPoint's own statuses. Draft is the safe choice: nothing is issued to a customer until you say so." },
];

/** Coerce whatever is in `settings` into options, so a hand-edited row cannot break a sync. */
export function readOptions(settings: unknown): FlexpointOptions {
  const s = (settings ?? {}) as Record<string, unknown>;
  const bool = (key: keyof FlexpointOptions, fallback: boolean) => (typeof s[key] === "boolean" ? s[key] as boolean : fallback);
  const pageSize = Number(s.pageSize);
  const matchRule = s.matchRule;
  const pushStatus = s.pushStatus;
  return {
    syncCustomers: bool("syncCustomers", DEFAULT_FLEXPOINT_OPTIONS.syncCustomers),
    syncInvoices: bool("syncInvoices", DEFAULT_FLEXPOINT_OPTIONS.syncInvoices),
    syncDeposits: bool("syncDeposits", DEFAULT_FLEXPOINT_OPTIONS.syncDeposits),
    pageSize: Number.isFinite(pageSize) && pageSize > 0 ? Math.min(Math.floor(pageSize), 200) : DEFAULT_FLEXPOINT_OPTIONS.pageSize,
    matchRule: matchRule === "externalUri" || matchRule === "externalUriOrName" || matchRule === "name" ? matchRule : DEFAULT_FLEXPOINT_OPTIONS.matchRule,
    createMissingClients: bool("createMissingClients", DEFAULT_FLEXPOINT_OPTIONS.createMissingClients),
    writeBackExternalUri: bool("writeBackExternalUri", DEFAULT_FLEXPOINT_OPTIONS.writeBackExternalUri),
    recordSettledPayments: bool("recordSettledPayments", DEFAULT_FLEXPOINT_OPTIONS.recordSettledPayments),
    pushInvoices: bool("pushInvoices", DEFAULT_FLEXPOINT_OPTIONS.pushInvoices),
    pushStatus: INVOICE_STATUSES.includes(pushStatus as FlexpointInvoiceStatus) ? pushStatus as FlexpointInvoiceStatus : DEFAULT_FLEXPOINT_OPTIONS.pushStatus,
  };
}

/** Validate a partial update, so the API refuses a value it would only coerce later. */
export function validateOptions(input: unknown): Partial<FlexpointOptions> {
  if (typeof input !== "object" || input === null) throw new AppError("options must be an object", 400);
  const body = input as Record<string, unknown>;
  const out: Partial<FlexpointOptions> = {};
  const booleans: Array<keyof FlexpointOptions> = ["syncCustomers", "syncInvoices", "syncDeposits", "createMissingClients", "writeBackExternalUri", "recordSettledPayments", "pushInvoices"];
  for (const key of booleans) {
    if (body[key] === undefined) continue;
    if (typeof body[key] !== "boolean") throw new AppError(`${key} must be true or false`, 400);
    (out as Record<string, unknown>)[key] = body[key];
  }
  if (body.pageSize !== undefined) {
    const pageSize = Number(body.pageSize);
    if (!Number.isFinite(pageSize) || pageSize < 1 || pageSize > 200) throw new AppError("pageSize must be between 1 and 200, which is FlexPoint's own maximum", 400);
    out.pageSize = Math.floor(pageSize);
  }
  if (body.matchRule !== undefined) {
    if (!["externalUri", "externalUriOrName", "name"].includes(String(body.matchRule))) throw new AppError("matchRule must be externalUri, externalUriOrName or name", 400);
    out.matchRule = body.matchRule as FlexpointOptions["matchRule"];
  }
  if (body.pushStatus !== undefined) {
    if (!INVOICE_STATUSES.includes(String(body.pushStatus) as FlexpointInvoiceStatus)) throw new AppError(`pushStatus must be one of ${INVOICE_STATUSES.join(", ")}`, 400);
    out.pushStatus = body.pushStatus as FlexpointInvoiceStatus;
  }
  return out;
}

// ── The connection ─────────────────────────────────────────────────────────

type IntegrationRow = {
  id: string; kind: string; name: string; enabled: boolean;
  credentials: unknown; settings: unknown; lastSyncAt: Date | null;
  status: string; errorMessage: string | null;
};

export async function flexpointIntegration(integrationId?: string): Promise<IntegrationRow | null> {
  if (integrationId) return prisma.integration.findUnique({ where: { id: integrationId } });
  return prisma.integration.findFirst({ where: { kind: "flexpoint" }, orderBy: { createdAt: "desc" } });
}

export function toAdapterConfig(row: IntegrationRow): IntegrationConfig {
  return {
    id: row.id,
    kind: "flexpoint",
    name: row.name,
    enabled: row.enabled,
    credentials: (row.credentials ?? {}) as Record<string, string>,
    settings: (row.settings ?? {}) as Record<string, unknown>,
    status: row.status as IntegrationConfig["status"],
    errorMessage: row.errorMessage ?? undefined,
    lastSyncAt: row.lastSyncAt,
  };
}

/** The adapter, plus the options, for a caller that has already resolved the connection. */
async function connected(integrationId?: string): Promise<{ row: IntegrationRow; cfg: IntegrationConfig; options: FlexpointOptions; adapter: FlexpointAdapter }> {
  const row = await flexpointIntegration(integrationId);
  if (!row) throw new AppError("No FlexPoint connection exists yet. Add one in CloudConnect first.", 400);
  if (row.kind !== "flexpoint") throw new AppError(`${row.name} is not a FlexPoint connection`, 400);
  const cfg = toAdapterConfig(row);
  const hasSecret = Boolean((cfg.credentials.apiSecret as string) || (cfg.credentials.apiKey as string));
  if (!hasSecret) throw new AppError("The FlexPoint connection has no merchant API secret yet. Set it in CloudConnect.", 400);
  return { row, cfg, options: readOptions(row.settings), adapter: new FlexpointAdapter() };
}

// ── Reading what has been synced ───────────────────────────────────────────

function rowsOf(rows: Array<{ externalId: string; displayName: string | null; data: unknown; linkedCompanyId: string | null; lastSyncedAt: Date }>): Array<FlexpointRecord & { linkedCompanyId: string | null; syncedAt: Date }> {
  return rows.map(row => ({
    ...((row.data ?? {}) as Record<string, unknown>),
    id: row.externalId,
    displayName: row.displayName ?? row.externalId,
    linkedCompanyId: row.linkedCompanyId,
    syncedAt: row.lastSyncedAt,
  }));
}

const num = (row: Record<string, unknown>, key: string): number => {
  const value = Number(row[key]);
  return Number.isFinite(value) ? value : 0;
};

const money = (value: number): number => Math.round(value * 100) / 100;

function isOpen(row: Record<string, unknown>): boolean {
  const status = String(row.status ?? "");
  return status !== "Paid" && status !== "Void";
}

function isOverdue(row: Record<string, unknown>, today: string): boolean {
  if (!isOpen(row)) return false;
  const due = String(row.dtDue ?? "").slice(0, 10);
  return due !== "" && due < today;
}

export interface FlexpointClientRow {
  companyId: string;
  companyName: string;
  customerId: string;
  customerName: string;
  externalUri: string | null;
  openBalance: number;
  overdueAmount: number;
  overdueCount: number;
  invoiceCount: number;
  paidTotal: number;
  linkedAt: string;
}

export interface FlexpointOverview {
  connection: {
    configured: boolean;
    id: string | null;
    name: string | null;
    enabled: boolean;
    status: string;
    errorMessage: string | null;
    lastSyncAt: string | null;
    baseUrl: string;
    hasSecret: boolean;
  };
  options: FlexpointOptions;
  optionMeta: typeof FLEXPOINT_OPTION_META;
  counts: { customers: number; invoices: number; deposits: number; linkedClients: number; unlinkedCustomers: number };
  totals: { openBalance: number; overdue: number; paid: number; deposits: number; lastPaymentAt: string | null };
  clients: FlexpointClientRow[];
  unlinked: Array<{ customerId: string; name: string; email: string | null; city: string | null }>;
  lastSync: { status: string; startedAt: string; recordsProcessed: number; recordsFailed: number; errorMessage: string | null } | null;
}

const today = (): string => new Date().toISOString().slice(0, 10);

export async function flexpointOverview(): Promise<FlexpointOverview> {
  const row = await flexpointIntegration();
  const options = readOptions(row?.settings);
  const baseUrl = String((row?.credentials as Record<string, string>)?.baseUrl || "https://apps.getflexpoint.com/core-api").replace(/\/+$/, "");

  if (!row) {
    return {
      connection: { configured: false, id: null, name: null, enabled: false, status: "not configured", errorMessage: null, lastSyncAt: null, baseUrl, hasSecret: false },
      options, optionMeta: FLEXPOINT_OPTION_META,
      counts: { customers: 0, invoices: 0, deposits: 0, linkedClients: 0, unlinkedCustomers: 0 },
      totals: { openBalance: 0, overdue: 0, paid: 0, deposits: 0, lastPaymentAt: null },
      clients: [], unlinked: [], lastSync: null,
    };
  }

  const [customerRows, invoiceRows, depositRows, log] = await Promise.all([
    prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "customers" }, orderBy: { lastSyncedAt: "desc" } }),
    prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "invoices" } }),
    prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "deposits" } }),
    prisma.syncLog.findFirst({ where: { integrationId: row.id }, orderBy: { startedAt: "desc" } }),
  ]);

  const customers = rowsOf(customerRows);
  const invoices = rowsOf(invoiceRows);
  const deposits = rowsOf(depositRows);
  const day = today();

  const linkedByCompany = new Map<string, Array<FlexpointRecord & { linkedCompanyId: string | null; syncedAt: Date }>>();
  for (const customer of customers) {
    if (!customer.linkedCompanyId) continue;
    const list = linkedByCompany.get(customer.linkedCompanyId) ?? [];
    list.push(customer);
    linkedByCompany.set(customer.linkedCompanyId, list);
  }

  const companies = linkedByCompany.size > 0
    ? await prisma.company.findMany({ where: { id: { in: [...linkedByCompany.keys()] } }, select: { id: true, name: true } })
    : [];
  const companyNames = new Map(companies.map(c => [c.id, c.name]));

  const clients: FlexpointClientRow[] = [];
  let openBalance = 0;
  let overdue = 0;
  let paid = 0;
  for (const [companyId, customerList] of linkedByCompany) {
    const ids = new Set(customerList.map(c => c.id));
    const mine = invoices.filter(invoice => ids.has(String(invoice.customerId ?? "")));
    const clientOpen = mine.filter(isOpen).reduce((sum, invoice) => sum + num(invoice, "openBalanceAmount"), 0);
    const clientOverdue = mine.filter(invoice => isOverdue(invoice, day));
    const clientPaid = mine.reduce((sum, invoice) => sum + num(invoice, "paymentsReceivedAmount"), 0);
    openBalance += clientOpen;
    overdue += clientOverdue.reduce((sum, invoice) => sum + num(invoice, "openBalanceAmount"), 0);
    paid += clientPaid;
    clients.push({
      companyId,
      companyName: companyNames.get(companyId) ?? "Unknown client",
      customerId: customerList[0]!.id,
      customerName: String(customerList[0]!.displayName ?? ""),
      externalUri: (customerList[0]!.externalUri as string) ?? null,
      openBalance: money(clientOpen),
      overdueAmount: money(clientOverdue.reduce((sum, invoice) => sum + num(invoice, "openBalanceAmount"), 0)),
      overdueCount: clientOverdue.length,
      invoiceCount: mine.length,
      paidTotal: money(clientPaid),
      linkedAt: customerList[0]!.syncedAt.toISOString(),
    });
  }
  clients.sort((a, b) => b.openBalance - a.openBalance || a.companyName.localeCompare(b.companyName));

  const depositsTotal = deposits.reduce((sum, deposit) => sum + num(deposit, "amount"), 0);
  const lastDeposit = deposits
    .map(deposit => String(deposit.datePaid ?? ""))
    .filter(Boolean)
    .sort()
    .pop() ?? null;
  const lastPayment = await prisma.payment.findFirst({ where: { method: "flexpoint" }, orderBy: { processedAt: "desc" }, select: { processedAt: true } });

  return {
    connection: {
      configured: true,
      id: row.id,
      name: row.name,
      enabled: row.enabled,
      status: row.status,
      errorMessage: row.errorMessage,
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      baseUrl,
      hasSecret: Boolean((row.credentials as Record<string, string>)?.apiSecret || (row.credentials as Record<string, string>)?.apiKey),
    },
    options,
    optionMeta: FLEXPOINT_OPTION_META,
    counts: {
      customers: customers.length,
      invoices: invoices.length,
      deposits: deposits.length,
      linkedClients: clients.length,
      unlinkedCustomers: customers.length - clients.length,
    },
    totals: { openBalance: money(openBalance), overdue: money(overdue), paid: money(paid), deposits: money(depositsTotal), lastPaymentAt: lastPayment?.processedAt.toISOString() ?? lastDeposit },
    clients,
    unlinked: customers
      .filter(customer => !customer.linkedCompanyId)
      .slice(0, 100)
      .map(customer => ({
        customerId: customer.id,
        name: String(customer.displayName ?? ""),
        email: (customer.email as string) ?? null,
        city: (customer.city as string) ?? null,
      })),
    lastSync: log
      ? { status: log.status, startedAt: log.startedAt.toISOString(), recordsProcessed: log.recordsProcessed, recordsFailed: log.recordsFailed, errorMessage: log.errorMessage }
      : null,
  };
}

export interface ClientAr {
  linked: boolean;
  customerId: string | null;
  customerName: string | null;
  openBalance: number;
  overdueAmount: number;
  overdueCount: number;
  paidTotal: number;
  invoices: Array<{ id: string; docNum: string | null; status: string; issued: string | null; due: string | null; amount: number; openBalance: number; received: number; paymentUrl: string | null; localInvoiceId: string | null; pushed: boolean }>;
  payments: Array<{ id: string; amount: number; processedAt: string; reference: string | null }>;
}

/** Everything FlexPoint knows about one client. Read-only: the writes happen on the C7NC page. */
export async function clientAr(companyId: string): Promise<ClientAr> {
  const empty: ClientAr = { linked: false, customerId: null, customerName: null, openBalance: 0, overdueAmount: 0, overdueCount: 0, paidTotal: 0, invoices: [], payments: [] };
  const row = await flexpointIntegration();
  if (!row) return empty;

  const customerRows = await prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "customers", linkedCompanyId: companyId } });
  if (customerRows.length === 0) return empty;
  const customers = rowsOf(customerRows);

  const invoiceRows = await prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "invoices" } });
  const ids = new Set(customers.map(customer => customer.id));
  const mine = rowsOf(invoiceRows).filter(invoice => ids.has(String(invoice.customerId ?? "")));
  const day = today();

  const localInvoices = await prisma.invoice.findMany({
    where: { companyId, flexpointInvoiceId: { in: mine.map(invoice => invoice.id) } },
    select: { id: true, invoiceNumber: true, flexpointInvoiceId: true },
  });
  const localByFlexpointId = new Map(localInvoices.map(invoice => [invoice.flexpointInvoiceId!, invoice]));

  const payments = await prisma.payment.findMany({
    where: { method: "flexpoint", invoice: { companyId } },
    orderBy: { processedAt: "desc" },
    take: 20,
    select: { id: true, amount: true, processedAt: true, reference: true },
  });

  return {
    linked: true,
    customerId: customers[0]!.id,
    customerName: String(customers[0]!.displayName ?? ""),
    openBalance: money(mine.filter(isOpen).reduce((sum, invoice) => sum + num(invoice, "openBalanceAmount"), 0)),
    overdueAmount: money(mine.filter(invoice => isOverdue(invoice, day)).reduce((sum, invoice) => sum + num(invoice, "openBalanceAmount"), 0)),
    overdueCount: mine.filter(invoice => isOverdue(invoice, day)).length,
    paidTotal: money(mine.reduce((sum, invoice) => sum + num(invoice, "paymentsReceivedAmount"), 0)),
    invoices: mine
      .map(invoice => ({
        id: invoice.id,
        docNum: (invoice.docNum as string) ?? null,
        status: String(invoice.status ?? ""),
        issued: String(invoice.dtInvoice ?? "").slice(0, 10) || null,
        due: String(invoice.dtDue ?? "").slice(0, 10) || null,
        amount: money(num(invoice, "invoiceAmount")),
        openBalance: money(num(invoice, "openBalanceAmount")),
        received: money(num(invoice, "paymentsReceivedAmount")),
        paymentUrl: (invoice.paymentUrl as string) ?? null,
        localInvoiceId: localByFlexpointId.get(invoice.id)?.invoiceNumber ?? null,
        pushed: localByFlexpointId.has(invoice.id),
      }))
      .sort((a, b) => String(b.due ?? "").localeCompare(String(a.due ?? ""))),
    payments: payments.map(payment => ({ id: payment.id, amount: payment.amount, processedAt: payment.processedAt.toISOString(), reference: payment.reference })),
  };
}

// ── Linking a customer to a client ─────────────────────────────────────────

/** A name only ties a customer to a client when exactly one client carries it. */
async function companyByName(name: string): Promise<string | null> {
  if (!name.trim()) return null;
  const matches = await prisma.company.findMany({ where: { name: { equals: name.trim(), mode: "insensitive" } }, select: { id: true }, take: 2 });
  return matches.length === 1 ? matches[0]!.id : null;
}

async function companyByExternalUri(externalUri: unknown): Promise<string | null> {
  const value = String(externalUri ?? "").trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) return null;
  const company = await prisma.company.findUnique({ where: { id: value }, select: { id: true } });
  return company?.id ?? null;
}

/**
 * Links one customer to a client and records it on the synced row. The customer's own
 * `externalUri` is written back when the option allows it, so the link survives a rename.
 */
export async function linkCustomer(companyId: string, customerId: string, options: FlexpointOptions): Promise<{ companyId: string; customerId: string; wroteExternalUri: boolean }> {
  const { row, cfg, adapter } = await connected();
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
  if (!company) throw new AppError("Unknown client", 400);

  const customerRow = await prisma.syncedEntity.findFirst({ where: { integrationId: row.id, entityType: "customers", externalId: String(customerId) } });
  if (!customerRow) throw new AppError("That FlexPoint customer has not been synced yet — run a sync first.", 400);

  // One customer per client: the AR for a client must not be the sum of two accounts.
  await prisma.syncedEntity.updateMany({ where: { integrationId: row.id, entityType: "customers", linkedCompanyId: companyId }, data: { linkedCompanyId: null } });
  await prisma.syncedEntity.update({ where: { id: customerRow.id }, data: { linkedCompanyId: companyId } });

  let wroteExternalUri = false;
  if (options.writeBackExternalUri) {
    const customer = (customerRow.data ?? {}) as Record<string, unknown>;
    try {
      // FlexPoint requires `name` on every customer update, so it is sent with the reference.
      await adapter.updateCustomer(cfg, String(customerId), { name: String(customer.name || company.name), externalUri: companyId });
      wroteExternalUri = true;
    } catch {
      // The link stands without it: the write-back is a convenience, not the source of truth.
      wroteExternalUri = false;
    }
  }
  return { companyId, customerId: String(customerId), wroteExternalUri };
}

/** Clears the link. The customer stays in FlexPoint; only this application's opinion changes. */
export async function unlinkCustomer(companyId: string): Promise<number> {
  const row = await flexpointIntegration();
  if (!row) return 0;
  const result = await prisma.syncedEntity.updateMany({ where: { integrationId: row.id, entityType: "customers", linkedCompanyId: companyId }, data: { linkedCompanyId: null } });
  return result.count;
}

// ── Sync ───────────────────────────────────────────────────────────────────

export interface FlexpointSyncSummary {
  success: boolean;
  recordsProcessed: number;
  /** New rows and refreshed rows, so the CloudConnect toast keeps meaning what it meant. */
  recordsCreated: number;
  recordsUpdated: number;
  stored: { customers: number; invoices: number; deposits: number };
  linked: { byExternalUri: number; byName: number; created: number; ambiguous: number };
  paymentsRecorded: number;
  invoicesMarked: number;
  errors: string[];
}

/**
 * Pulls everything the options ask for, stores it, links customers to clients, and — when it is
 * switched on — records the settled payments of invoices this application pushed.
 *
 * It writes the same `SyncLog` row and integration status as CloudConnect's own Sync button, so
 * the two screens cannot disagree about when the connection last ran or what it said.
 */
export async function syncFlexpoint(integrationId?: string): Promise<FlexpointSyncSummary> {
  const { row, cfg, options, adapter } = await connected(integrationId);

  const log = await prisma.syncLog.create({ data: { integrationId: row.id, status: "running", entityType: "all", startedAt: new Date() } });
  const result = await adapter.sync(cfg);

  const stored = { customers: 0, invoices: 0, deposits: 0 };
  let recordsCreated = 0;
  for (const resource of ["customers", "invoices", "deposits"] as const) {
    const items = (((result as unknown as Record<string, unknown>)[resource] as FlexpointRecord[] | undefined) ?? []).filter(item => item.id);
    // Which of these has never been stored, so "created" means created rather than upserted.
    const known = items.length > 0
      ? new Set((await prisma.syncedEntity.findMany({
          where: { integrationId: row.id, entityType: resource, externalId: { in: items.map(item => item.id) } },
          select: { externalId: true },
        })).map(entity => entity.externalId))
      : new Set<string>();

    for (const item of items) {
      await prisma.syncedEntity.upsert({
        where: { integrationId_entityType_externalId: { integrationId: row.id, entityType: resource, externalId: item.id } },
        create: {
          integrationId: row.id,
          entityKind: "flexpoint",
          entityType: resource,
          externalId: item.id,
          displayName: item.displayName,
          data: item as never,
          lastSyncedAt: new Date(),
        },
        update: {
          displayName: item.displayName,
          data: item as never,
          lastSyncedAt: new Date(),
        },
      });
      if (!known.has(item.id)) recordsCreated++;
      stored[resource]++;
    }
  }

  const linked = { byExternalUri: 0, byName: 0, created: 0, ambiguous: 0 };
  if (stored.customers > 0 && options.matchRule !== "name") {
    const customerRows = await prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "customers" } });
    for (const customerRow of customerRows) {
      const customer = (customerRow.data ?? {}) as Record<string, unknown>;
      let companyId = await companyByExternalUri(customer.externalUri);
      let how: "externalUri" | "name" | null = companyId ? "externalUri" : null;

      if (!companyId && options.matchRule === "externalUriOrName") {
        const byName = await companyByName(String(customer.name ?? ""));
        if (byName) { companyId = byName; how = "name"; }
        else if (String(customer.name ?? "").trim()) {
          const candidates = await prisma.company.count({ where: { name: { equals: String(customer.name).trim(), mode: "insensitive" } } });
          if (candidates > 1) linked.ambiguous++;
        }
      }

      if (!companyId && options.createMissingClients && String(customer.name ?? "").trim()) {
        const created = await prisma.company.create({
          data: {
            name: String(customer.name).trim().slice(0, 200),
            email: (customer.email as string) || null,
            phone: (customer.tel as string) || null,
            website: (customer.webSite as string) || null,
            addressLine1: (customer.addr as string) || null,
            city: (customer.city as string) || null,
            state: (customer.state as string) || null,
            postalCode: (customer.zip as string) || null,
            country: (customer.country as string) || null,
            isActive: true,
          },
          select: { id: true, name: true },
        });
        companyId = created.id;
        how = null;
        linked.created++;
        if (options.writeBackExternalUri) {
          try { await adapter.updateCustomer(cfg, String(customerRow.externalId), { name: created.name, externalUri: created.id }); } catch { /* the link stands without it */ }
        }
      }

      if (companyId && customerRow.linkedCompanyId !== companyId) {
        await prisma.syncedEntity.update({ where: { id: customerRow.id }, data: { linkedCompanyId: companyId } });
        if (how === "externalUri") linked.byExternalUri++;
        else if (how === "name") {
          linked.byName++;
          if (options.writeBackExternalUri) {
            try { await adapter.updateCustomer(cfg, String(customerRow.externalId), { name: String(customer.name ?? companyId), externalUri: companyId }); } catch { /* ignore */ }
          }
        }
      }
    }
  } else if (stored.customers > 0) {
    // matchRule "name": the reference is ignored on purpose, so only the name decides.
    const customerRows = await prisma.syncedEntity.findMany({ where: { integrationId: row.id, entityType: "customers" } });
    for (const customerRow of customerRows) {
      const customer = (customerRow.data ?? {}) as Record<string, unknown>;
      const byName = await companyByName(String(customer.name ?? ""));
      if (byName && customerRow.linkedCompanyId !== byName) {
        await prisma.syncedEntity.update({ where: { id: customerRow.id }, data: { linkedCompanyId: byName } });
        linked.byName++;
      }
    }
  }

  const reconciliation = options.recordSettledPayments
    ? await recordSettledPayments()
    : { paymentsRecorded: 0, invoicesMarked: 0 };

  await prisma.syncLog.update({
    where: { id: log.id },
    data: {
      status: result.success ? "success" : "failed",
      recordsProcessed: result.recordsProcessed,
      recordsFailed: result.errors.length,
      errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
      completedAt: new Date(),
    },
  });
  await prisma.integration.update({
    where: { id: row.id },
    data: {
      lastSyncAt: new Date(),
      status: result.success ? "connected" : "error",
      errorMessage: result.errors.length > 0 ? result.errors.join("; ") : null,
    },
  });

  return {
    success: result.success,
    recordsProcessed: result.recordsProcessed,
    recordsCreated,
    recordsUpdated: result.recordsProcessed - recordsCreated,
    stored,
    linked,
    paymentsRecorded: reconciliation.paymentsRecorded,
    invoicesMarked: reconciliation.invoicesMarked,
    errors: result.errors,
  };
}

/**
 * Records the settled amount of every FlexPoint invoice this application pushed.
 *
 * Only pushed invoices are considered, because those are the only ones with a local invoice to
 * credit. The reference `flexpoint:<invoiceId>` is what stops a deposit being recorded twice, so
 * this can run on every sync.
 */
async function recordSettledPayments(): Promise<{ paymentsRecorded: number; invoicesMarked: number }> {
  const row = await flexpointIntegration();
  if (!row) return { paymentsRecorded: 0, invoicesMarked: 0 };

  const pushed = await prisma.invoice.findMany({
    where: { flexpointInvoiceId: { not: null } },
    select: { id: true, invoiceNumber: true, total: true, status: true, paidAt: true, flexpointInvoiceId: true },
  });
  if (pushed.length === 0) return { paymentsRecorded: 0, invoicesMarked: 0 };

  const mirrored = await prisma.syncedEntity.findMany({
    where: { integrationId: row.id, entityType: "invoices", externalId: { in: pushed.map(invoice => invoice.flexpointInvoiceId!) } },
  });
  const byExternalId = new Map(mirrored.map(entity => [entity.externalId, (entity.data ?? {}) as Record<string, unknown>]));

  let paymentsRecorded = 0;
  let invoicesMarked = 0;
  for (const invoice of pushed) {
    const remote = byExternalId.get(invoice.flexpointInvoiceId!);
    if (!remote) continue;
    const received = money(num(remote, "paymentsReceivedAmount"));
    if (received <= 0) continue;
    const reference = `flexpoint:${invoice.flexpointInvoiceId}`;
    const existing = await prisma.payment.findFirst({ where: { invoiceId: invoice.id, reference } });
    if (!existing) {
      await prisma.payment.create({
        data: {
          invoiceId: invoice.id,
          amount: received,
          method: "flexpoint",
          reference,
          processedAt: new Date(String(remote.dtPosted ?? "") || Date.now()),
        },
      });
      paymentsRecorded++;
    }
    const settled = received >= invoice.total - 0.01;
    const nextStatus = settled ? "paid" : "partial";
    if (invoice.status !== nextStatus || (settled && !invoice.paidAt)) {
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: nextStatus, ...(settled && !invoice.paidAt ? { paidAt: new Date() } : {}) },
      });
      invoicesMarked++;
    }
  }
  return { paymentsRecorded, invoicesMarked };
}

// ── Pushing a local invoice ────────────────────────────────────────────────

export interface FlexpointPushOutcome {
  pushed: boolean;
  reason?: string;
  flexpointInvoiceId?: string;
  status?: FlexpointInvoiceStatus;
  created?: boolean;
}

/**
 * Creates (or updates) the client's invoice in FlexPoint through the merchant API.
 *
 * Two things have to exist first: a FlexPoint customer for the invoice's client — created here when
 * there is none, which needs an email address because FlexPoint requires one — and, for an update,
 * the id of the invoice this was pushed as. Line items are sent with FlexPoint's required
 * `partNum`, taken from the catalog product when the line came from one.
 */
export async function pushInvoiceToFlexpoint(invoiceId: string): Promise<FlexpointPushOutcome> {
  const { row, cfg, options, adapter } = await connected();
  if (!options.pushInvoices) return { pushed: false, reason: "Pushing invoices to FlexPoint is switched off in C7NC → FlexPoint." };

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: { lineItems: true, company: { select: { id: true, name: true, email: true, billingEmail: true, addressLine1: true, city: true, state: true, postalCode: true, country: true } } },
  });
  if (!invoice) throw new AppError("Unknown invoice", 404);
  if (invoice.quoteStatus) return { pushed: false, reason: "A quote is not pushed to FlexPoint. Convert it to an invoice first." };

  // Which FlexPoint customer is this client?
  const customerRow = await prisma.syncedEntity.findFirst({ where: { integrationId: row.id, entityType: "customers", linkedCompanyId: invoice.companyId } });
  let customerId = customerRow?.externalId ?? "";
  if (!customerId) {
    const email = invoice.company.billingEmail || invoice.company.email;
    if (!email) return { pushed: false, reason: `${invoice.company.name} has no email address, and FlexPoint requires one on a customer. Add a billing email to the client first.` };
    try {
      const created = await adapter.createCustomer(cfg, {
        name: invoice.company.name,
        email,
        externalUri: invoice.companyId,
        addr: invoice.company.addressLine1 ?? undefined,
        city: invoice.company.city ?? undefined,
        state: invoice.company.state ?? undefined,
        zip: invoice.company.postalCode ?? undefined,
        country: invoice.company.country ?? undefined,
      });
      customerId = created.id;
      await prisma.syncedEntity.upsert({
        where: { integrationId_entityType_externalId: { integrationId: row.id, entityType: "customers", externalId: created.id } },
        create: { integrationId: row.id, entityKind: "flexpoint", entityType: "customers", externalId: created.id, displayName: created.displayName, data: created as never, linkedCompanyId: invoice.companyId, lastSyncedAt: new Date() },
        update: { linkedCompanyId: invoice.companyId, data: created as never, lastSyncedAt: new Date() },
      });
    } catch (e) {
      return { pushed: false, reason: `FlexPoint would not create a customer for ${invoice.company.name}: ${(e as Error).message}` };
    }
  }
  const numericCustomerId = Number(customerId);
  if (!Number.isFinite(numericCustomerId)) return { pushed: false, reason: `The linked FlexPoint customer (${customerId}) is not a FlexPoint customer id.` };

  const status = options.pushStatus;
  const body = {
    status,
    externalUri: invoice.id,
    doc_num: invoice.invoiceNumber,
    companyName: invoice.company.name,
    dtInvoice: invoice.issueDate.toISOString(),
    dtDue: invoice.dueDate.toISOString(),
    ...(invoice.notes ? { customerMessage: invoice.notes.slice(0, 500) } : {}),
  };

  try {
    if (invoice.flexpointInvoiceId) {
      const updated = await adapter.updateInvoice(cfg, invoice.flexpointInvoiceId, body);
      await prisma.invoice.update({ where: { id: invoice.id }, data: { flexpointPushedAt: new Date() } });
      return { pushed: true, flexpointInvoiceId: updated.id, status, created: false };
    }
    const created = await adapter.createInvoice(cfg, {
      customerId: numericCustomerId,
      ...body,
      lineItems: invoice.lineItems.map((line, index) => ({
        partNum: line.productId ? `SKU-${line.productId.slice(0, 8)}` : `SVC-${index + 1}`,
        description: line.description.slice(0, 200),
        qty: line.quantity,
        unitPrice: line.unitPrice,
        discountAmount: 0,
      })),
    });
    if (!created.id) return { pushed: false, reason: "FlexPoint accepted the invoice but returned no id, so C7NTAX cannot track it." };
    await prisma.invoice.update({ where: { id: invoice.id }, data: { flexpointInvoiceId: created.id, flexpointPushedAt: new Date() } });
    await prisma.syncedEntity.upsert({
      where: { integrationId_entityType_externalId: { integrationId: row.id, entityType: "invoices", externalId: created.id } },
      create: { integrationId: row.id, entityKind: "flexpoint", entityType: "invoices", externalId: created.id, displayName: created.displayName, data: created as never, linkedCompanyId: invoice.companyId, lastSyncedAt: new Date() },
      update: { linkedCompanyId: invoice.companyId, data: created as never, lastSyncedAt: new Date() },
    });
    return { pushed: true, flexpointInvoiceId: created.id, status, created: true };
  } catch (e) {
    return { pushed: false, reason: `FlexPoint refused the invoice: ${(e as Error).message}` };
  }
}
