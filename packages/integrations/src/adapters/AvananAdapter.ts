import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/** Avanan email security adapter — syncs threat events and security incidents. */
export class AvananAdapter implements IIntegrationAdapter {
  readonly kind = "avanan" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/api/v1/health`, {
        headers: { "X-API-Key": cfg.credentials.apiKey, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "avanan", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/api/v1/incidents?since=${cfg.lastSyncAt?.toISOString() || ""}`, {
        headers: { "X-API-Key": cfg.credentials.apiKey, Accept: "application/json" },
      });
      if (res.ok) {
        const data = (await res.json()) as { incidents?: unknown[] };
        result.recordsProcessed = data.incidents?.length ?? 0;
      } else { result.errors.push(`HTTP ${res.status}`); }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
