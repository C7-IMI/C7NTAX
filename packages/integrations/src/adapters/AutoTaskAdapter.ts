import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * AutoTask / Datto PSA adapter.
 * REST API with API user credentials (username + password) and tracking identifier.
 * API docs: https://ww1.autotask.net/help/Content/AdminSetup/2ExtensionsIntegrations/APIs/APIs.htm
 */
export class AutoTaskAdapter implements IIntegrationAdapter {
  readonly kind = "autotask" as const;

  private authHeaders(cfg: IntegrationConfig): Record<string, string> {
    const { username, password, integrationCode } = cfg.credentials;
    return {
      "Content-Type": "application/json",
      UserName: username,
      Secret: password,
      ApiIntegrationCode: integrationCode || "",
    };
  }

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.zoneUrl as string) || "https://webservices.autotask.net/ATServicesRest/V1.0";
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/CompanyWebservices.asmx/getZoneInfo`, {
        method: "POST", headers: this.authHeaders(cfg), body: JSON.stringify({ UserName: cfg.credentials.username }),
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "autotask", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const base = this.baseUrl(cfg);
      const resources: Array<{ path: string }> = [
        { path: "/Contacts/query" },
        { path: "/Accounts/query" },
        { path: "/Tickets/query" },
        { path: "/Projects/query" },
        { path: "/Tasks/query" },
        { path: "/Resources/query" },
        { path: "/Opportunities/query" },
        { path: "/Contracts/query" },
      ];
      for (const r of resources) {
        try {
          const res = await fetch(`${base}${r.path}`, {
            method: "POST",
            headers: this.authHeaders(cfg),
            body: JSON.stringify({ MaxRecords: 200 }),
          });
          if (res.ok) {
            const data = await res.json() as any;
            const items = data?.items || data || [];
            result.recordsProcessed += Array.isArray(items) ? items.length : 0;
          } else {
            result.errors.push(`${r.path}: HTTP ${res.status}`);
          }
        } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
      }
    } catch (e: any) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
