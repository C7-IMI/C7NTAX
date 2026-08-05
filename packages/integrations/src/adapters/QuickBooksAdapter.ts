import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * QuickBooks Online adapter.
 * Syncs invoices, payments, customers, and chart of accounts.
 * API: OAuth 2.0 REST JSON (Intuit QuickBooks API v3).
 */
export class QuickBooksAdapter implements IIntegrationAdapter {
  readonly kind = "quickbooks" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/v3/company/${cfg.credentials.realmId}/companyinfo/${cfg.credentials.realmId}`, {
        headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "quickbooks", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const entities = ["invoices", "payments", "customers", "accounts"];
      for (const entity of entities) {
        const res = await fetch(`${cfg.settings.baseUrl}/v3/company/${cfg.credentials.realmId}/query?query=SELECT * FROM ${entity} WHERE Metadata.LastUpdatedTime > '${cfg.lastSyncAt?.toISOString() || "2020-01-01"}'`, {
          headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { QueryResponse?: { maxResults?: number } };
          result.recordsProcessed += data.QueryResponse?.maxResults ?? 0;
        } else { result.errors.push(`${entity}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
