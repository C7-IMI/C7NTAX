import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * FlexPoint adapter — billing and accounts-receivable automation for MSPs.
 *
 * Written against FlexPoint's own OpenAPI 3.1.1 document, which they serve openly at
 * `https://apps.getflexpoint.com/core-api/swagger/v1/swagger.json` ("FlexPoint API", version 1.0).
 * The host, the two path prefixes, the sign-in route and its body, the list filters, the paging
 * parameters, the `record-count` header and the write schemas are all taken from that document
 * rather than guessed.
 *
 * **Auth** is one merchant secret, exchanged for a short-lived bearer JWT. There is no API-key
 * header, no OAuth and no scope list: the secret *is* the tenant binding, so one connection reads
 * one merchant's data.
 *
 * **Reads** are Customers, Invoices and Deposits (settled payouts), offset-paged with `offset` +
 * `page_size` (default 50, newest first, bare JSON array), with the total row count in the
 * `record-count` response header. **Writes** are the two that matter to a PSA: create/update a
 * customer, and create/update an invoice. The API has no webhooks, no product catalogue and no
 * subscription resource.
 *
 * Every record this adapter returns is normalised with an `id` and a `displayName`, because the
 * vendor's id fields are per-resource (`customerId`, `invoiceId`, `payoutId`) and a caller that
 * does not know the resource cannot persist a stable key.
 */
const DEFAULT_BASE_URL = "https://apps.getflexpoint.com/core-api";
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
/** A ceiling on one sync, so a list that never reports a short page cannot loop forever. */
const MAX_PAGES = 40;
/** FlexPoint's tokens live about half an hour; refresh early rather than on the first 401. */
const TOKEN_TTL_MS = 25 * 60 * 1000;

/** Invoice statuses as FlexPoint's own enum defines them. */
export type FlexpointInvoiceStatus = "Draft" | "Posted" | "Paid" | "Processing" | "Void";

export const FLEXPOINT_RESOURCES = {
  customers: { path: "/api/merchant/v1/Customers", idField: "customerId", nameField: "name", setting: "syncCustomers" },
  invoices: { path: "/api/merchant/v1/Invoices", idField: "invoiceId", nameField: "docNum", setting: "syncInvoices" },
  deposits: { path: "/api/merchant/v1/Deposits", idField: "payoutId", nameField: "datePaid", setting: "syncDeposits" },
} as const;

export type FlexpointResourceKey = keyof typeof FLEXPOINT_RESOURCES;

export interface FlexpointRecord {
  id: string;
  displayName: string;
  [key: string]: unknown;
}

/** One line of a pushed invoice, as FlexPoint's `PostInvoiceItemRequest` requires it. */
export interface FlexpointInvoiceLine {
  partNum: string;
  description: string;
  qty: number;
  unitPrice: number;
  discountAmount: number;
}

export interface FlexpointInvoiceInput {
  customerId: number;
  status: FlexpointInvoiceStatus;
  externalUri?: string;
  doc_num?: string;
  poNumber?: string;
  companyName?: string;
  customerMessage?: string;
  dtInvoice?: string;
  dtDue?: string;
  lineItems?: FlexpointInvoiceLine[];
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

export class FlexpointAdapter implements IIntegrationAdapter {
  readonly kind = "flexpoint" as const;

  /** Tokens are held per connection, so two merchants configured side by side never share one. */
  private tokens = new Map<string, CachedToken>();

  private baseUrl(cfg: IntegrationConfig): string {
    const configured = (cfg.credentials?.baseUrl as string) || (cfg.settings?.baseUrl as string) || DEFAULT_BASE_URL;
    return configured.replace(/\/+$/, "");
  }

  /** `apiKey` is still read: connections saved before the dialog was corrected carry that name. */
  private secret(cfg: IntegrationConfig): string {
    return (cfg.credentials?.apiSecret as string) || (cfg.credentials?.apiKey as string) || "";
  }

  private pageSize(cfg: IntegrationConfig): number {
    const configured = Number(cfg.settings?.pageSize);
    if (!Number.isFinite(configured) || configured <= 0) return PAGE_SIZE_DEFAULT;
    return Math.min(Math.floor(configured), PAGE_SIZE_MAX);
  }

  private wants(cfg: IntegrationConfig, key: string): boolean {
    return cfg.settings?.[key] !== false;
  }

  private async login(cfg: IntegrationConfig): Promise<string> {
    const secret = this.secret(cfg);
    if (!secret) throw new Error("the merchant API secret is not set");
    const res = await fetch(`${this.baseUrl(cfg)}/api/v1/auth/login-merchant`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ secret }),
    });
    if (!res.ok) {
      throw new Error(res.status === 401 || res.status === 400
        ? "sign-in was refused — the merchant API secret was rejected"
        : `sign-in failed: HTTP ${res.status}`);
    }
    const body = (await res.json().catch(() => null)) as { token?: unknown } | null;
    const token = body?.token;
    if (typeof token !== "string" || token.length === 0) throw new Error("sign-in returned no token");
    this.tokens.set(cfg.id, { token, expiresAt: Date.now() + TOKEN_TTL_MS });
    return token;
  }

  private async token(cfg: IntegrationConfig, refresh = false): Promise<string> {
    const cached = this.tokens.get(cfg.id);
    if (!refresh && cached && cached.expiresAt > Date.now()) return cached.token;
    return this.login(cfg);
  }

  /**
   * One request. A 401 signs in again once and retries, which is what a 30-minute token needs.
   * The caller gets the parsed body and, for lists, the `record-count` header.
   */
  private async request(
    cfg: IntegrationConfig,
    method: "GET" | "POST" | "PUT",
    path: string,
    options: { query?: Record<string, string | number>; body?: unknown; pathLabel?: string } = {},
  ): Promise<{ data: unknown; total: number | null; status: number }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(options.query || {})) query.set(key, String(value));
    const url = `${this.baseUrl(cfg)}${path}${query.toString() ? `?${query.toString()}` : ""}`;
    const label = options.pathLabel || path;

    const send = async (bearer: string) => fetch(url, {
      method,
      headers: {
        Authorization: `Bearer ${bearer}`,
        Accept: "application/json",
        ...(options.body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    });

    let res = await send(await this.token(cfg));
    if (res.status === 401) res = await send(await this.token(cfg, true));

    const text = await res.text().catch(() => "");
    let parsed: unknown = null;
    try { parsed = text ? JSON.parse(text) : null; } catch { parsed = null; }

    if (!res.ok) {
      // FlexPoint answers a bad write with a short error body rather than a sentence, so the
      // status is the message; anything it does say is appended.
      const detail = typeof parsed === "object" && parsed && "message" in (parsed as Record<string, unknown>)
        ? ` — ${String((parsed as Record<string, unknown>).message).slice(0, 160)}`
        : (text && text.length < 160 && !text.trimStart().startsWith("<") ? ` — ${text.trim()}` : "");
      throw new Error(`${label}: HTTP ${res.status}${detail}`);
    }

    const header = res.headers.get("record-count");
    const total = header !== null && Number.isFinite(Number(header)) ? Number(header) : null;
    return { data: parsed, total, status: res.status };
  }

  /** Every page of a list, bounded by MAX_PAGES. */
  private async all(cfg: IntegrationConfig, resource: FlexpointResourceKey): Promise<FlexpointRecord[]> {
    const { path, idField, nameField } = FLEXPOINT_RESOURCES[resource];
    const pageSize = this.pageSize(cfg);
    const rows: FlexpointRecord[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { data, total } = await this.request(cfg, "GET", path, { query: { offset, page_size: pageSize } });
      const batch = Array.isArray(data) ? (data as Array<Record<string, unknown>>) : [];
      for (const item of batch) rows.push(normalise(resource, item, idField, nameField));
      offset += batch.length;
      if (batch.length < pageSize) break;
      if (total !== null && offset >= total) break;
    }
    return rows;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.login(cfg);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Proves the token is accepted by the resource API, not merely that the secret exchanged — a
   * credential can be valid and still not be entitled to read the merchant's customers.
   */
  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.request(cfg, "GET", FLEXPOINT_RESOURCES.customers.path, { query: { page_size: 1 } });
      return true;
    } catch {
      return false;
    }
  }

  // ── Reads, for callers that need one resource rather than a whole sync ──────

  listCustomers(cfg: IntegrationConfig): Promise<FlexpointRecord[]> { return this.all(cfg, "customers"); }
  listInvoices(cfg: IntegrationConfig): Promise<FlexpointRecord[]> { return this.all(cfg, "invoices"); }
  listDeposits(cfg: IntegrationConfig): Promise<FlexpointRecord[]> { return this.all(cfg, "deposits"); }

  async getInvoice(cfg: IntegrationConfig, invoiceId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.request(cfg, "GET", `${FLEXPOINT_RESOURCES.invoices.path}/${encodeURIComponent(invoiceId)}`);
    return (data as Record<string, unknown>) ?? null;
  }

  // ── Writes ──────────────────────────────────────────────────────────────────

  /**
   * Creates a customer. `email` and `name` are both required by FlexPoint's schema, and
   * `additionalProperties: false` means a field it does not know is a rejected request — so the
   * caller passes only what the API documents.
   */
  async createCustomer(
    cfg: IntegrationConfig,
    input: { name: string; email: string; externalUri?: string; tel?: string; addr?: string; city?: string; state?: string; zip?: string; country?: string; webSite?: string },
  ): Promise<FlexpointRecord> {
    const { data } = await this.request(cfg, "POST", FLEXPOINT_RESOURCES.customers.path, {
      body: clean(input),
      pathLabel: "creating the FlexPoint customer",
    });
    return normalise("customers", (data as Record<string, unknown>) ?? {}, "customerId", "name");
  }

  /** Updates a customer. FlexPoint requires `name` on every update, so the caller passes it. */
  async updateCustomer(cfg: IntegrationConfig, customerId: string, patch: { name: string } & Record<string, unknown>): Promise<FlexpointRecord> {
    const { data } = await this.request(cfg, "PUT", `${FLEXPOINT_RESOURCES.customers.path}/${encodeURIComponent(customerId)}`, {
      body: clean(patch),
      pathLabel: `updating FlexPoint customer ${customerId}`,
    });
    return normalise("customers", (data as Record<string, unknown>) ?? {}, "customerId", "name");
  }

  /** Creates an invoice. FlexPoint requires `customerId` and `status`. */
  async createInvoice(cfg: IntegrationConfig, input: FlexpointInvoiceInput): Promise<FlexpointRecord> {
    const { data } = await this.request(cfg, "POST", FLEXPOINT_RESOURCES.invoices.path, {
      body: clean(input as unknown as Record<string, unknown>),
      pathLabel: "creating the FlexPoint invoice",
    });
    return normalise("invoices", (data as Record<string, unknown>) ?? {}, "invoiceId", "docNum");
  }

  /** Updates an invoice. FlexPoint requires `status` on every update. */
  async updateInvoice(cfg: IntegrationConfig, invoiceId: string, patch: Record<string, unknown>): Promise<FlexpointRecord> {
    const { data } = await this.request(cfg, "PUT", `${FLEXPOINT_RESOURCES.invoices.path}/${encodeURIComponent(invoiceId)}`, {
      body: clean(patch),
      pathLabel: `updating FlexPoint invoice ${invoiceId}`,
    });
    return normalise("invoices", (data as Record<string, unknown>) ?? {}, "invoiceId", "docNum");
  }

  // ── Sync ────────────────────────────────────────────────────────────────────

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "flexpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    for (const resource of Object.keys(FLEXPOINT_RESOURCES) as FlexpointResourceKey[]) {
      if (!this.wants(cfg, FLEXPOINT_RESOURCES[resource].setting)) continue;
      try {
        const rows = await this.all(cfg, resource);
        result.recordsProcessed += rows.length;
        (result as unknown as Record<string, unknown>)[resource] = rows;
      } catch (e) {
        result.errors.push(`${FLEXPOINT_RESOURCES[resource].path}: ${(e as Error).message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(cfg: IntegrationConfig): Promise<void> {
    this.tokens.delete(cfg.id);
  }
}

/**
 * FlexPoint's id and name are per resource. `id` is what callers persist, so it is set here for
 * every record rather than left to a caller that would have to know the vendor's field names —
 * the generic sync persistence in the API reads `id`, and without this it invented a random one
 * and stored a new duplicate row on every sync.
 */
function normalise(resource: FlexpointResourceKey, item: Record<string, unknown>, idField: string, nameField: string): FlexpointRecord {
  const id = item[idField];
  const name = item[nameField];
  const fallbackName = resource === "deposits"
    ? `Payout ${id ?? "?"}${item.datePaid ? ` · ${String(item.datePaid).slice(0, 10)}` : ""}`
    : resource === "invoices"
      ? String(item.docNum || item.externalUri || `Invoice ${id ?? "?"}`)
      : String(item.name || `Customer ${id ?? "?"}`);
  return {
    ...item,
    id: String(id ?? ""),
    displayName: String(name || fallbackName).slice(0, 200),
  };
}

/** Drops undefined/null entries: FlexPoint rejects unknown properties outright. */
function clean(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined || value === null || value === "") continue;
    out[key] = value;
  }
  return out;
}
