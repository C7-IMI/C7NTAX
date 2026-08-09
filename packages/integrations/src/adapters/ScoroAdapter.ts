import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Scoro adapter.
 * API: https://api.scoro.com
 * Auth: API key (apikey query param) or OAuth Bearer
 * Resources: contacts, projects, tasks, invoices, events,
 *            quotes, bills, time entries, products
 */
export class ScoroAdapter implements IIntegrationAdapter {
  readonly kind = "scoro" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    const account = cfg.credentials.companyAccountId || "api";
    return `https://${account}.scoro.com/api/v2`;
  }

  private async call(cfg: IntegrationConfig, method: string, params: Record<string, any> = {}): Promise<any> {
    const { apiKey, accessToken } = cfg.credentials;
    let url = `${this.baseUrl(cfg)}/${method}`;
    if (apiKey) url += `?apikey=${apiKey}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...params, lang: "eng" }),
    });
    if (!res.ok) throw new Error(`Scoro ${method}: HTTP ${res.status}`);
    return res.json();
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { await this.call(cfg, "getContactList", { limit: 1 }); return true; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "scoro", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const resources: Array<{ method: string; key: string; params: Record<string, any> }> = [
      { method: "getContactList", key: "contacts", params: { limit: 500 } },
      { method: "getProjectList", key: "projects", params: { limit: 500 } },
      { method: "getTaskList", key: "tasks", params: { limit: 500 } },
      { method: "getInvoiceList", key: "invoices", params: { limit: 500 } },
      { method: "getEventList", key: "events", params: { limit: 500 } },
      { method: "getQuoteList", key: "quotes", params: { limit: 500 } },
      { method: "getBillList", key: "bills", params: { limit: 500 } },
      { method: "getProductList", key: "products", params: { limit: 500 } },
    ];
    for (const r of resources) {
      try {
        const data = await this.call(cfg, r.method, r.params);
        const items = data?.data || [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.method}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
