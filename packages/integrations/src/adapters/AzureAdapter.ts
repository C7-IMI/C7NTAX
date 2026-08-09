import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Azure Resource Manager adapter.
 * API: https://learn.microsoft.com/en-us/rest/api/resources/
 * Auth: Bearer token
 * Resources: resources, resourceGroups, security alerts, policies
 */
export class AzureAdapter implements IIntegrationAdapter {
  readonly kind = "azure" as const;

  private baseUrl = "https://management.azure.com";

  private async apiGet(cfg: IntegrationConfig, path: string, apiVersion: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}${path}?api-version=${apiVersion}`, {
      headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Azure ${path}: HTTP ${res.status}`);
    return res.json();
  }

  private subId(cfg: IntegrationConfig): string {
    return (cfg.credentials.subscriptionId as string) || "";
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.apiGet(cfg, `/subscriptions/${this.subId(cfg)}`, "2022-12-01");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "azure", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const sub = this.subId(cfg);
    const resources: Array<{ path: string; key: string; version: string }> = [
      { path: `/subscriptions/${sub}/resources`, key: "resources", version: "2021-04-01" },
      { path: `/subscriptions/${sub}/resourceGroups`, key: "resourceGroups", version: "2021-04-01" },
      { path: `/subscriptions/${sub}/providers/Microsoft.Security/alerts`, key: "securityAlerts", version: "2022-01-01" },
      { path: `/subscriptions/${sub}/providers/Microsoft.Authorization/policyAssignments`, key: "policyAssignments", version: "2022-06-01" },
    ];
    for (const r of resources) {
      try {
        const data = await this.apiGet(cfg, r.path, r.version);
        const items = data?.value || [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
