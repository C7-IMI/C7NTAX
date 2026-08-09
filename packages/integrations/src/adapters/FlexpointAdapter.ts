import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Flexpoint Payments adapter.
 * API: REST JSON with Bearer token
 * Resources: transactions, customers, settlements, reports
 */
export class FlexpointAdapter implements IIntegrationAdapter {
  readonly kind = "flexpoint" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://api.flexpoint.com";
  }

  private async apiGet(cfg: IntegrationConfig, path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl(cfg)}${path}`, {
      headers: { Authorization: `Bearer ${cfg.credentials.apiKey}`, Accept: "application/json" },
    });
    if (!res.ok) throw new Error(`Flexpoint ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { const r = await this.apiGet(cfg, "/api/v1/ping"); return !!r; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "flexpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const since = cfg.lastSyncAt ? `?since=${cfg.lastSyncAt.toISOString()}` : "";
    const resources: Array<{ path: string; key: string }> = [
      { path: `/api/v1/transactions${since}`, key: "transactions" },
      { path: "/api/v1/customers", key: "customers" },
      { path: "/api/v1/settlements", key: "settlements" },
    ];
    for (const r of resources) {
      try {
        const data = await this.apiGet(cfg, r.path);
        const items = data?.transactions || data?.customers || data?.settlements || data || [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
