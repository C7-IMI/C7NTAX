import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Scoro adapter.
 * API key via apikey query parameter or OAuth 2.0 Bearer token.
 * API docs: https://api.scoro.com
 */
export class ScoroAdapter implements IIntegrationAdapter {
  readonly kind = "scoro" as const;

  private async apiPost(cfg: IntegrationConfig, method: string, params: Record<string, any> = {}): Promise<any> {
    const { apiKey, accessToken, companyAccountId } = cfg.credentials;
    const url = `https://${companyAccountId || "api"}.scoro.com/api/v2/${method}`;
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
    const urlWithKey = apiKey ? `${url}?apikey=${apiKey}` : url;

    const res = await fetch(urlWithKey, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...params, lang: "eng" }),
    });
    if (!res.ok) throw new Error(`Scoro ${method}: HTTP ${res.status}`);
    return res.json();
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { const r = await this.apiPost(cfg, "getContactList", { limit: 1 }); return !!r; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "scoro", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const resources: Array<{ method: string; params: Record<string, any> }> = [
        { method: "getContactList", params: { limit: 500 } },
        { method: "getProjectList", params: { limit: 500 } },
        { method: "getTaskList", params: { limit: 500 } },
        { method: "getInvoiceList", params: { limit: 500 } },
        { method: "getEventList", params: { limit: 500 } },
        { method: "getQuoteList", params: { limit: 500 } },
      ];
      for (const r of resources) {
        try {
          const data = await this.apiPost(cfg, r.method, r.params);
          const items = data?.data || data || [];
          result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        } catch (e: any) { result.errors.push(`${r.method}: ${e.message}`); }
      }
    } catch (e: any) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
