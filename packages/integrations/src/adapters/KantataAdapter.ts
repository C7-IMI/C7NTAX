import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Kantata (formerly Mavenlink) adapter.
 * API: https://developer.kantata.com
 * Auth: OAuth 2.0 Bearer token
 * Resources: workspaces, users, tasks, time_entries, expenses,
 *            invoices, stories, project_templates, roles
 */
export class KantataAdapter implements IIntegrationAdapter {
  readonly kind = "kantata" as const;

  private baseUrl = "https://api.kantata.com/v1";

  private async fetchAll(cfg: IntegrationConfig, path: string, pageSize: number = 200): Promise<unknown[]> {
    const items: unknown[] = [];
    let page = 1;
    while (true) {
      const res = await fetch(`${this.baseUrl}${path}?per_page=${pageSize}&page=${page}`, {
        headers: { Authorization: `Bearer ${cfg.credentials.accessToken}`, "Content-Type": "application/json" },
      });
      if (!res.ok) throw new Error(`Kantata ${path}: HTTP ${res.status}`);
      const data = (await res.json()) as any;
      const list = data?.results || data?.workspaces || data?.users || data?.tasks || data || [];
      items.push(...list);
      if (!Array.isArray(list) || list.length < pageSize) break;
      page++;
    }
    return items;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try { await this.fetchAll(cfg, "/workspaces", 1); return true; } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "kantata", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const resources: Array<{ path: string; key: string }> = [
      { path: "/workspaces", key: "workspaces" },
      { path: "/users", key: "users" },
      { path: "/tasks", key: "tasks" },
      { path: "/time_entries", key: "timeEntries" },
      { path: "/expenses", key: "expenses" },
      { path: "/invoices", key: "invoices" },
      { path: "/stories", key: "stories" },
      { path: "/project_templates", key: "projectTemplates" },
      { path: "/roles", key: "roles" },
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
