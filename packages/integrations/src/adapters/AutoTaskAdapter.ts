import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * AutoTask / Datto PSA adapter.
 * API: https://ww1.autotask.net/help/Content/AdminSetup/2ExtensionsIntegrations/APIs/APIs.htm
 * Auth: API credentials (UserName + Secret + ApiIntegrationCode headers)
 * Resources: contacts, accounts, tickets, projects, tasks,
 *            resources, opportunities, contracts, products
 */
export class AutoTaskAdapter implements IIntegrationAdapter {
  readonly kind = "autotask" as const;

  private authHeaders(cfg: IntegrationConfig): Record<string, string> {
    const { username, password, integrationCode } = cfg.credentials;
    return {
      "Content-Type": "application/json",
      UserName: username as string,
      Secret: password as string,
      ApiIntegrationCode: (integrationCode as string) || "",
    };
  }

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.zoneUrl as string) || "https://webservices.autotask.net/ATServicesRest/V1.0";
  }

  /** Query an AutoTask entity with pagination. */
  private async query(cfg: IntegrationConfig, entity: string, maxRecords: number = 200): Promise<unknown[]> {
    const items: unknown[] = [];
    const headers = this.authHeaders(cfg);
    while (true) {
      const res = await fetch(`${this.baseUrl(cfg)}/${entity}/query`, {
        method: "POST",
        headers,
        body: JSON.stringify({ MaxRecords: maxRecords }),
      });
      if (!res.ok) throw new Error(`AutoTask ${entity}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const list = data?.items || [];
      items.push(...list);
      if (list.length < maxRecords) break;
    }
    return items;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/CompanyWebservices.asmx/getZoneInfo`, {
        method: "POST",
        headers: this.authHeaders(cfg),
        body: JSON.stringify({ UserName: cfg.credentials.username }),
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "autotask", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const entities = [
      "Contacts", "Accounts", "Tickets", "Projects", "Tasks",
      "Resources", "Opportunities", "Contracts", "Products",
    ];
    for (const entity of entities) {
      try {
        const items = await this.query(cfg, entity);
        result.recordsProcessed += items.length;
        (result as any)[entity.toLowerCase()] = items;
      } catch (e: any) { result.errors.push(`${entity}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
