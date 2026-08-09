import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Kantata (formerly Mavenlink) adapter.
 * OAuth 2.0 via Bearer token.
 * API docs: https://developer.kantata.com
 */
export class KantataAdapter implements IIntegrationAdapter {
  readonly kind = "kantata" as const;

  private async apiGet(cfg: IntegrationConfig, path: string): Promise<any> {
    const res = await fetch(`https://api.kantata.com/v1${path}`, {
      headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, "Content-Type": "application/json" },
    });
    if (!res.ok) throw new Error(`Kantata ${path}: HTTP ${res.status}`);
    return res.json();
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { const r = await this.apiGet(cfg, "/workspaces"); return r?.workspaces !== undefined; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "kantata", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const resources: Array<{ path: string; key: string }> = [
        { path: "/workspaces", key: "workspaces" },
        { path: "/users", key: "users" },
        { path: "/tasks", key: "tasks" },
        { path: "/time_entries", key: "time_entries" },
        { path: "/expenses", key: "expenses" },
        { path: "/invoices", key: "invoices" },
        { path: "/stories", key: "stories" },
      ];
      for (const r of resources) {
        try {
          const data = await this.apiGet(cfg, r.path);
          const items = data?.[r.key] || data?.results || [];
          result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
      }
    } catch (e: any) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
