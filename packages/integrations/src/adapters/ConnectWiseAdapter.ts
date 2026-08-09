import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * ConnectWise PSA / Manage adapter.
 * API: https://developer.connectwise.com
 * Auth: Basic (companyId+publicKey:privateKey) + clientId header
 * Resources: contacts, companies, tickets, opportunities, projects,
 *            agreements, products, configurations, service boards
 */
export class ConnectWiseAdapter implements IIntegrationAdapter {
  readonly kind = "connectwise" as const;

  private authHeaders(cfg: IntegrationConfig): Record<string, string> {
    const { companyId, publicKey, privateKey, clientId } = cfg.credentials;
    const auth = btoa(`${companyId}+${publicKey}:${privateKey}`);
    return {
      Authorization: `Basic ${auth}`,
      clientId: (clientId as string) || "",
      "Content-Type": "application/json",
    };
  }

  private baseUrl(cfg: IntegrationConfig): string {
    return ((cfg.credentials.baseUrl || cfg.settings?.siteUrl) as string) ||
      "https://api-na.myconnectwise.net/v4_6_release/apis/3.0";
  }

  /** Fetch paginated results from a ConnectWise collection. */
  private async fetchAll(
    cfg: IntegrationConfig,
    path: string,
    pageSize: number = 200
  ): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(
        `${this.baseUrl(cfg)}${path}?pageSize=${pageSize}&page=${page}`,
        { headers: this.authHeaders(cfg) }
      );
      if (!res.ok) throw new Error(`ConnectWise ${path}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const list = Array.isArray(data) ? data : data?.value || data?.items || [];
      items.push(...list);
      if (list.length < pageSize) break;
      page++;
    }
    return items;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/system/members?pageSize=1`, {
        headers: this.authHeaders(cfg),
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "connectwise", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const resources: Array<{ path: string; key: string }> = [
      { path: "/company/contacts", key: "contacts" },
      { path: "/company/companies", key: "companies" },
      { path: "/company/configurations", key: "configurations" },
      { path: "/service/tickets", key: "tickets" },
      { path: "/service/boards", key: "boards" },
      { path: "/sales/opportunities", key: "opportunities" },
      { path: "/project/projects", key: "projects" },
      { path: "/finance/agreements", key: "agreements" },
      { path: "/procurement/products", key: "products" },
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
