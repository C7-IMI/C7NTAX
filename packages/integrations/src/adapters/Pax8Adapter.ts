import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";
import { clientCredentialsToken } from "../oauth";

/**
 * Pax8 adapter.
 *
 * API: https://docs.pax8.com/api-docs (v1)
 *
 * Two corrections against the previous version, both of which made it fail on the first call:
 *
 * 1. **The token.** Pax8 mints an OAuth client-credentials token at `https://api.pax8.com/v1/token`
 *    with `audience: "https://api.pax8.com"` in the body. The previous version posted to
 *    `/v1/identity`, which is not a token endpoint at all.
 * 2. **The collection names.** There is no `/v1/customers` — a Pax8 "customer" is a **company**, so
 *    the route is `/v1/companies`, and the connectivity test is a one-item page of companies rather
 *    than a call that cannot answer.
 *
 * Paged routes answer `{ content: [...], page: { number, size, totalPages } }`, capped at 200 per
 * page, so paging is by `page`/`size` rather than by offset.
 */
export class Pax8Adapter implements IIntegrationAdapter {
  readonly kind = "pax8" as const;

  private readonly tokenUrl = "https://api.pax8.com/v1/token";
  private readonly baseUrl = "https://api.pax8.com";

  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "/v1/companies", key: "companies" },
    { path: "/v1/subscriptions", key: "subscriptions" },
    { path: "/v1/products", key: "products" },
    { path: "/v1/invoices", key: "invoices" },
    { path: "/v1/contacts", key: "contacts" },
  ];

  private pageSize(cfg: IntegrationConfig): number {
    const n = Number(cfg.settings?.pageSize ?? 200);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 200) : 200;
  }

  private async token(cfg: IntegrationConfig): Promise<string> {
    const clientId = (cfg.credentials.clientId || "").trim();
    const clientSecret = (cfg.credentials.clientSecret || "").trim();
    if (!clientId || !clientSecret) throw new Error("A Pax8 API client id and secret are required.");
    return clientCredentialsToken({
      tokenUrl: this.tokenUrl,
      clientId,
      clientSecret,
      // Pax8 follows Auth0's conventions: the desired API is named as an audience, and the body is JSON.
      extra: { audience: "https://api.pax8.com" },
      format: "json",
    });
  }

  private async call(cfg: IntegrationConfig, token: string, path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}`, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      let detail = text.slice(0, 200);
      try { detail = JSON.stringify(JSON.parse(text)).slice(0, 200); } catch { /* plain text */ }
      throw new Error(`Pax8 ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    try { return JSON.parse(text); } catch { return {}; }
  }

  private async fetchAll(cfg: IntegrationConfig, token: string, path: string): Promise<any[]> {
    const out: any[] = [];
    const size = this.pageSize(cfg);
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    for (let page = 0; page < maxPages; page++) {
      const parsed = await this.call(cfg, token, `${path}${path.includes("?") ? "&" : "?"}page=${page}&size=${size}`);
      const items = Array.isArray(parsed?.content) ? parsed.content : [];
      out.push(...items);
      const totalPages = Number(parsed?.page?.totalPages ?? 0);
      if (items.length < size || (totalPages && page + 1 >= totalPages)) break;
    }
    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const token = await this.token(cfg);
      await this.call(cfg, token, "/v1/companies?page=0&size=1");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "pax8", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    let token: string;
    try {
      token = await this.token(cfg);
    } catch (e: any) {
      result.success = false;
      result.errors.push(e.message);
      return result;
    }

    for (const { path, key } of this.resources) {
      try {
        const items = await this.fetchAll(cfg, token, path);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        result.errors.push(`${key}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
