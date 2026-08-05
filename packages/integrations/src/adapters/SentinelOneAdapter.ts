import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * SentinelOne EDR adapter.
 * Syncs threats, agent status, and policy compliance events.
 * API: REST JSON with API token auth.
 */
export class SentinelOneAdapter implements IIntegrationAdapter {
  readonly kind = "sentinelone" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/web/api/v2.1/system/status`, {
        headers: { Authorization: `ApiToken ${cfg.credentials.apiToken}`, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "sentinelone", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const endpoints = ["threats", "agents", "activities"];
      for (const ep of endpoints) {
        const params = new URLSearchParams({ limit: "100", ...(cfg.lastSyncAt && { createdAt__gt: cfg.lastSyncAt.toISOString() }) });
        const res = await fetch(`${cfg.settings.baseUrl}/web/api/v2.1/${ep}?${params}`, {
          headers: { Authorization: `ApiToken ${cfg.credentials.apiToken}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { data?: unknown[] };
          result.recordsProcessed += data.data?.length ?? 0;
        } else { result.errors.push(`${ep}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
