import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * ConnectWise PSA / Manage adapter.
 * REST API with clientId + public/private key pair authentication.
 * API docs: https://developer.connectwise.com
 */
export class ConnectWiseAdapter implements IIntegrationAdapter {
  readonly kind = "connectwise" as const;

  private authHeaders(cfg: IntegrationConfig): Record<string, string> {
    const { companyId, publicKey, privateKey, clientId } = cfg.credentials;
    const auth = Buffer.from(`${companyId}+${publicKey}:${privateKey}`).toString("base64");
    return {
      Authorization: `Basic ${auth}`,
      clientId: clientId || "",
      "Content-Type": "application/json",
    };
  }

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.credentials.baseUrl as string) || cfg.settings?.siteUrl as string || "https://api-na.myconnectwise.net/v4_6_release/apis/3.0";
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/system/members?pageSize=1`, { headers: this.authHeaders(cfg) });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "connectwise", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const base = this.baseUrl(cfg);
      const resources: Array<{ path: string; key: string }> = [
        { path: "/company/contacts?pageSize=200", key: "contacts" },
        { path: "/company/companies?pageSize=200", key: "companies" },
        { path: "/service/tickets?pageSize=200", key: "tickets" },
        { path: "/sales/opportunities?pageSize=200", key: "opportunities" },
        { path: "/project/projects?pageSize=200", key: "projects" },
        { path: "/procurement/products?pageSize=200", key: "products" },
      ];
      for (const r of resources) {
        const res = await fetch(`${base}${r.path}`, { headers: this.authHeaders(cfg) });
        if (res.ok) {
          const data = await res.json() as any;
          const items = data?.[r.key] || data || [];
          result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        } else {
          result.errors.push(`${r.path}: HTTP ${res.status}`);
        }
      }
    } catch (e: any) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
