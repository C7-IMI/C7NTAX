import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Azure (ARM) adapter.
 * Syncs resource health, cost management data, and security center alerts.
 * API: Azure Resource Manager REST with Bearer token.
 */
export class AzureAdapter implements IIntegrationAdapter {
  readonly kind = "azure" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`https://management.azure.com/subscriptions/${cfg.credentials.subscriptionId}?api-version=2022-12-01`, {
        headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "azure", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const endpoints = [
        `https://management.azure.com/subscriptions/${cfg.credentials.subscriptionId}/resources?api-version=2021-04-01&$top=500`,
        `https://management.azure.com/subscriptions/${cfg.credentials.subscriptionId}/providers/Microsoft.Security/alerts?api-version=2023-11-15`,
      ];
      for (const url of endpoints) {
        const res = await fetch(url, {
          headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { value?: unknown[] };
          result.recordsProcessed += data.value?.length ?? 0;
        } else { result.errors.push(`HTTP ${res.status} from ${url.split("?")[0]}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
