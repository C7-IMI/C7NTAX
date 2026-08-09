import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Pax8 adapter.
 * API: https://api.pax8.com
 * Auth: Bearer token
 * Resources: products, subscriptions, invoices, customers
 */
export class Pax8Adapter implements IIntegrationAdapter {
  readonly kind = "pax8" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://api.pax8.com";
  }

  private headers(cfg: IntegrationConfig): Record<string, string> {
    return { Authorization: `Bearer ${cfg.credentials.apiKey}`, Accept: "application/json" };
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/v1/identity`, { headers: this.headers(cfg) });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "pax8", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const resources: Array<{ path: string; key: string; pageKey: string }> = [
      { path: "/v1/products", key: "products", pageKey: "content" },
      { path: "/v1/subscriptions", key: "subscriptions", pageKey: "content" },
      { path: "/v1/invoices", key: "invoices", pageKey: "content" },
      { path: "/v1/customers", key: "customers", pageKey: "content" },
    ];
    for (const r of resources) {
      try {
        const items: unknown[] = [];
        let page = 0;
        while (true) {
          const res = await fetch(`${this.baseUrl(cfg)}${r.path}?page=${page}&size=100`, { headers: this.headers(cfg) });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = (await res.json()) as any;
          const list = data?.[r.pageKey] || data?.content || [];
          items.push(...list);
          if (list.length < 100 || data?.last) break;
          page++;
        }
        result.recordsProcessed += items.length;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
