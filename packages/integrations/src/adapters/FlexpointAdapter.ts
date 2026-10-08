import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * FlexPoint adapter — billing and accounts-receivable automation for MSPs.
 *
 * Written against FlexPoint's own OpenAPI 3.1.1 document, which they serve openly at
 * `https://apps.getflexpoint.com/core-api/swagger/v1/swagger.json` ("FlexPoint API", version 1.0).
 * Everything below — the host, the two path prefixes, the sign-in route and its body, the list
 * filters, the paging parameters and the `record-count` header — is taken from that document rather
 * than guessed. The previous version of this file assumed an `x-api-key` header and an
 * `https://api.flexpoint.com` host, neither of which exists.
 *
 * **Auth** is one merchant secret, exchanged for a short-lived bearer JWT. There is no API-key
 * header, no OAuth and no scope list: the secret *is* the tenant binding, so one connection reads
 * one merchant's data.
 *
 * **Resources** are Customers, Invoices and Deposits (settled payouts). The API has no webhook
 * support, no product catalogue and no subscription resource, so nothing here waits for one.
 *
 * **Lists** are offset-paged (`offset` + `page_size`, default 50, newest first) and return a bare
 * JSON array; the total row count arrives in the `record-count` response header.
 */
const DEFAULT_BASE_URL = "https://apps.getflexpoint.com/core-api";
const PAGE_SIZE_DEFAULT = 50;
const PAGE_SIZE_MAX = 200;
/** A ceiling on one sync, so a list that never reports a short page cannot loop forever. */
const MAX_PAGES = 40;
/** FlexPoint's tokens live about half an hour; refresh early rather than on the first 401. */
const TOKEN_TTL_MS = 25 * 60 * 1000;

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

  /** One list request. A 401 signs in again once, which is what a 30-minute token needs. */
  private async list(cfg: IntegrationConfig, path: string, params: Record<string, string | number>): Promise<{ rows: unknown[]; total: number | null }> {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) query.set(key, String(value));
    const url = `${this.baseUrl(cfg)}${path}?${query.toString()}`;

    const send = async (bearer: string) => fetch(url, { headers: { Authorization: `Bearer ${bearer}`, Accept: "application/json" } });
    let res = await send(await this.token(cfg));
    if (res.status === 401) res = await send(await this.token(cfg, true));
    if (!res.ok) throw new Error(`HTTP ${res.status}`);

    const body: unknown = await res.json().catch(() => []);
    const totalHeader = res.headers.get("record-count");
    const total = totalHeader !== null && Number.isFinite(Number(totalHeader)) ? Number(totalHeader) : null;
    return { rows: Array.isArray(body) ? body : [], total };
  }

  /** Every page of a list, bounded by MAX_PAGES. */
  private async all(cfg: IntegrationConfig, path: string): Promise<unknown[]> {
    const pageSize = this.pageSize(cfg);
    const rows: unknown[] = [];
    let offset = 0;
    for (let page = 0; page < MAX_PAGES; page++) {
      const { rows: batch, total } = await this.list(cfg, path, { offset, page_size: pageSize });
      rows.push(...batch);
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
      await this.list(cfg, "/api/merchant/v1/Customers", { page_size: 1 });
      return true;
    } catch {
      return false;
    }
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "flexpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    const resources: Array<{ key: string; path: string; setting: string }> = [
      { key: "customers", path: "/api/merchant/v1/Customers", setting: "syncCustomers" },
      { key: "invoices", path: "/api/merchant/v1/Invoices", setting: "syncInvoices" },
      { key: "deposits", path: "/api/merchant/v1/Deposits", setting: "syncDeposits" },
    ];

    for (const resource of resources) {
      if (!this.wants(cfg, resource.setting)) continue;
      try {
        const rows = await this.all(cfg, resource.path);
        result.recordsProcessed += rows.length;
        (result as unknown as Record<string, unknown>)[resource.key] = rows;
      } catch (e) {
        result.errors.push(`${resource.path}: ${(e as Error).message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(cfg: IntegrationConfig): Promise<void> {
    this.tokens.delete(cfg.id);
  }
}
