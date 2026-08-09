import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * SentinelOne adapter.
 * API: https://usea1.sentinelone.net/api-doc/overview
 * Auth: ApiToken header
 * Resources: threats, agents, activities, groups, sites,
 *            applications, device-control, ranger, deep-visibility
 */
export class SentinelOneAdapter implements IIntegrationAdapter {
  readonly kind = "sentinelone" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://usea1.sentinelone.net";
  }

  private headers(cfg: IntegrationConfig): Record<string, string> {
    return { Authorization: `ApiToken ${cfg.credentials.apiToken}`, "Content-Type": "application/json" };
  }

  /** Fetch paginated collection. SentinelOne uses cursor-based pagination. */
  private async fetchAll(cfg: IntegrationConfig, path: string, limit: number = 100): Promise<unknown[]> {
    const items: unknown[] = [];
    let cursor: string | null = null;
    const params = new URLSearchParams({ limit: String(limit) });
    if (cfg.lastSyncAt) params.set("createdAt__gt", cfg.lastSyncAt.toISOString());

    while (true) {
      if (cursor) params.set("cursor", cursor);
      const res = await fetch(`${this.baseUrl(cfg)}${path}?${params}`, {
        headers: this.headers(cfg),
      });
      if (!res.ok) throw new Error(`SentinelOne ${path}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const list = data?.data || [];
      items.push(...list);
      cursor = data?.pagination?.nextCursor || null;
      if (!cursor || list.length === 0) break;
    }
    return items;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/web/api/v2.1/system/status`, { headers: this.headers(cfg) });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "sentinelone", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const resources: Array<{ path: string; key: string }> = [
      { path: "/web/api/v2.1/threats", key: "threats" },
      { path: "/web/api/v2.1/agents", key: "agents" },
      { path: "/web/api/v2.1/activities", key: "activities" },
      { path: "/web/api/v2.1/groups", key: "groups" },
      { path: "/web/api/v2.1/sites", key: "sites" },
      { path: "/web/api/v2.1/application-management/risks", key: "appRisks" },
      { path: "/web/api/v2.1/ranger/gateways", key: "rangerGateways" },
    ];
    for (const r of resources) {
      try {
        const items = await this.fetchAll(cfg, r.path);
        result.recordsProcessed += items.length;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
