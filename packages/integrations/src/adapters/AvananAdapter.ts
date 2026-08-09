import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Avanan / Check Point Email Security adapter.
 * API: REST JSON with X-API-Key
 * Resources: incidents, threats, policies, users
 */
export class AvananAdapter implements IIntegrationAdapter {
  readonly kind = "avanan" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://api.avanan.com";
  }

  private headers(cfg: IntegrationConfig): Record<string, string> {
    return { "X-API-Key": cfg.credentials.apiKey as string, Accept: "application/json" };
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/api/v1/health`, { headers: this.headers(cfg) });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "avanan", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const since = cfg.lastSyncAt ? `since=${cfg.lastSyncAt.toISOString()}` : "";
    const resources: Array<{ path: string; key: string }> = [
      { path: `/api/v1/incidents?${since}`, key: "incidents" },
      { path: "/api/v1/threats", key: "threats" },
      { path: "/api/v1/policies", key: "policies" },
      { path: "/api/v1/users", key: "users" },
    ];
    for (const r of resources) {
      try {
        const res = await fetch(`${this.baseUrl(cfg)}${r.path}`, { headers: this.headers(cfg) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as any;
        const items = data?.incidents || data?.threats || data?.policies || data?.users || data || [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
