import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * HaloPSA adapter.
 * OAuth 2.0 client credentials or API key via x-api-key header.
 * API docs: https://haloservicedesk.com/apidoc
 */
export class HaloPSAAdapter implements IIntegrationAdapter {
  readonly kind = "halopsa" as const;

  private async getToken(cfg: IntegrationConfig): Promise<string> {
    if (cfg.credentials.accessToken) {
      const exp = cfg.credentials.expiresAt ? new Date(cfg.credentials.expiresAt).getTime() : 0;
      if (Date.now() < exp - 60000) return cfg.credentials.accessToken;
    }
    const { tenantUrl, clientId, clientSecret } = cfg.credentials;
    const res = await fetch(`${tenantUrl}/auth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: clientId, client_secret: clientSecret }),
    });
    if (!res.ok) throw new Error(`HaloPSA auth failed: ${res.status}`);
    const data = await res.json() as any;
    cfg.credentials.accessToken = data.access_token;
    cfg.credentials.expiresAt = new Date(Date.now() + (data.expires_in || 3600) * 1000).toISOString();
    return data.access_token;
  }

  private async apiGet(cfg: IntegrationConfig, path: string): Promise<any> {
    const token = await this.getToken(cfg);
    const res = await fetch(`${cfg.credentials.tenantUrl}/api${path}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`HaloPSA ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { await this.getToken(cfg); return true; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "halopsa", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const resources = ["/users", "/clients", "/tickets", "/sites", "/agents", "/assets", "/contracts"];
      for (const r of resources) {
        try {
          const data = await this.apiGet(cfg, r);
          const items = data?.records || data || [];
          result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        } catch (e: any) { result.errors.push(`${r}: ${e.message}`); }
      }
    } catch (e: any) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(cfg: IntegrationConfig): Promise<void> {
    delete cfg.credentials.accessToken;
    delete cfg.credentials.expiresAt;
  }
}
