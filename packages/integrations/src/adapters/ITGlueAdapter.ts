import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * ITGlue documentation platform adapter.
 * Syncs configurations, flexible assets, passwords, and documents.
 * API: REST JSON with x-api-key header.
 */
export class ITGlueAdapter implements IIntegrationAdapter {
  readonly kind = "itglue" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/api`, {
        headers: { "x-api-key": cfg.credentials.apiKey, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "itglue", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const resources = ["configurations", "flexible_assets", "passwords", "documents", "contacts", "organizations"];
      for (const resource of resources) {
        const params = new URLSearchParams({ "page[size]": "100", ...(cfg.lastSyncAt && { "filter[updated_at]": cfg.lastSyncAt.toISOString() }) });
        const res = await fetch(`${cfg.settings.baseUrl}/api/${resource}?${params}`, {
          headers: { "x-api-key": cfg.credentials.apiKey, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { data?: unknown[] };
          result.recordsProcessed += data.data?.length ?? 0;
        } else { result.errors.push(`${resource}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
