import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Microsoft 365 adapter.
 * Syncs users, groups, licensed services, and security alerts via Graph API.
 */
export class Microsoft365Adapter implements IIntegrationAdapter {
  readonly kind = "microsoft365" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch("https://graph.microsoft.com/v1.0/organization", {
        headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "microsoft365", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const resources = ["users", "groups", "subscribedSkus", "security/secureScores"];
      for (const resource of resources) {
        const res = await fetch(`https://graph.microsoft.com/v1.0/${resource}?$top=999`, {
          headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { value?: unknown[] };
          result.recordsProcessed += data.value?.length ?? 0;
        } else { result.errors.push(`${resource}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
