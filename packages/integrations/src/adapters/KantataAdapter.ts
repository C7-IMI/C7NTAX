import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Kantata (formerly Mavenlink) adapter.
 *
 * API: https://api.mavenlink.com/api/v1
 *
 * Three things about this API are easy to get wrong, and the previous version got all three:
 *
 * 1. The host is `api.mavenlink.com`, not `api.kantata.com`.
 * 2. Every path needs a `.json` extension — `/workspaces.json`, not `/workspaces`; without it the
 *    API answers with a redirect to the HTML documentation rather than data.
 * 3. The payload is *not* an array of records. It is `{ results: [{ key, id }], <key>: { [id]: record } }`,
 *    so a record is `data[ref.key][ref.id]`. Since the previous version looked for a top-level array
 *    it synced zero records even on a successful response.
 *
 * Pagination is `?page=N` with `meta.page_count` telling you when to stop. `per_page` caps at 200.
 */
export class KantataAdapter implements IIntegrationAdapter {
  private readonly baseUrl = "https://api.mavenlink.com/api/v1";

  readonly kind = "kantata" as const;

  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "workspaces", key: "workspaces" },
    { path: "users", key: "users" },
    { path: "tasks", key: "tasks" },
    { path: "time_entries", key: "timeEntries" },
    { path: "expenses", key: "expenses" },
    { path: "invoices", key: "invoices" },
    { path: "stories", key: "stories" },
    { path: "project_templates", key: "projectTemplates" },
    { path: "roles", key: "roles" },
  ];

  private headers(cfg: IntegrationConfig): Record<string, string> {
    const token = (cfg.credentials.accessToken || "").trim();
    if (!token) throw new Error("A Kantata OAuth access token is required.");
    return { authorization: `Bearer ${token}`, accept: "application/json" };
  }

  /** One page of one resource, with `{key,id}` references resolved into flat records. */
  private async page(cfg: IntegrationConfig, path: string, page: number): Promise<{ records: any[]; pageCount: number }> {
    const url = `${this.baseUrl}/${path}.json?page=${page}&per_page=200`;
    const res = await fetch(url, { headers: this.headers(cfg) });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* the docs redirect is HTML, not JSON */ }

    if (!res.ok) {
      const detail = parsed?.errors ? JSON.stringify(parsed.errors).slice(0, 200) : text.slice(0, 160);
      throw new Error(`Kantata ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }

    const refs: Array<{ key: string; id: string }> = Array.isArray(parsed?.results) ? parsed.results : [];
    const records = refs
      .map(ref => {
        const record = parsed?.[ref.key]?.[String(ref.id)];
        // A reference the response did not expand is not a record; keeping the id keeps it traceable.
        return record ? { id: String(ref.id), ...record } : { id: String(ref.id) };
      })
      .filter(record => record.id);

    return { records, pageCount: Number(parsed?.meta?.page_count ?? 1) || 1 };
  }

  private async fetchAll(cfg: IntegrationConfig, path: string): Promise<any[]> {
    const out: any[] = [];
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    for (let page = 1; page <= maxPages; page++) {
      const { records, pageCount } = await this.page(cfg, path, page);
      out.push(...records);
      if (page >= pageCount) break;
    }
    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.page(cfg, "workspaces", 1);
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "kantata", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    for (const { path, key } of this.resources) {
      try {
        const items = await this.fetchAll(cfg, path);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        // A 403 here usually means the token's role cannot see that resource; the rest still syncs.
        result.errors.push(`${key}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
