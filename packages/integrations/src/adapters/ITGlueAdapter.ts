import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * IT Glue adapter.
 *
 * API: https://api.itglue.com/developer (JSON:API)
 *
 * Auth is a single `x-api-key` header — correct in the previous version — but three other things
 * were not:
 *
 * 1. **`include=organization` is not a supported include** on these resources, so every request came
 *    back 400. The organisation is linked by `organization-id` instead.
 * 2. **Pagination is `page[number]`/`page[size]`**, not `page`/`per_page`, and the response's
 *    `meta.totalPages` says when to stop rather than a page size comparison.
 * 3. **Documents hang off an organisation**, at `/organizations/{id}/relationships/documents`. There
 *    is no top-level document list, so they are gathered per organisation, which is also why the
 *    organisations page has to be read first.
 *
 * After the first sync only changed records are pulled, using the documented
 * `filter[updated_at]=<iso>,*` range.
 */
export class ITGlueAdapter implements IIntegrationAdapter {
  readonly kind = "itglue" as const;

  private readonly baseUrl = "https://api.itglue.com";

  /** Resources with a top-level list route. `include` is intentionally empty — IT Glue rejects unknowns. */
  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "/organizations", key: "organizations" },
    { path: "/configurations", key: "configurations" },
    { path: "/flexible_assets", key: "flexibleAssets" },
    { path: "/passwords", key: "passwords" },
    { path: "/contacts", key: "contacts" },
    { path: "/domains", key: "domains" },
    { path: "/locations", key: "locations" },
  ];

  private headers(cfg: IntegrationConfig): Record<string, string> {
    const apiKey = (cfg.credentials.apiKey || "").trim();
    if (!apiKey) throw new Error("An IT Glue API key is required.");
    return { "x-api-key": apiKey, accept: "application/vnd.api+json" };
  }

  /** Flatten a JSON:API resource: `{ id, type, attributes }` becomes `{ id, type, ...attributes }`. */
  private flatten(record: any): any {
    if (!record || typeof record !== "object") return record;
    const { id, type, attributes, ...rest } = record;
    return { id: id != null ? String(id) : undefined, type, ...(attributes ?? {}), ...rest };
  }

  private async fetchPage(cfg: IntegrationConfig, path: string, params: URLSearchParams): Promise<{ records: any[]; totalPages: number }> {
    const res = await fetch(`${this.baseUrl}${path}?${params.toString()}`, { headers: this.headers(cfg) });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* IT Glue answers with HTML on a bad key */ }

    if (!res.ok) {
      const detail = Array.isArray(parsed?.errors)
        ? parsed.errors.map((e: any) => e?.detail ?? e?.title ?? "").filter(Boolean).join("; ")
        : text.slice(0, 200);
      throw new Error(`IT Glue ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }

    const records = (Array.isArray(parsed?.data) ? parsed.data : []).map((r: any) => this.flatten(r));
    return { records, totalPages: Number(parsed?.meta?.totalPages ?? 1) || 1 };
  }

  private async fetchAll(cfg: IntegrationConfig, path: string, extraParams: Record<string, string> = {}): Promise<any[]> {
    const out: any[] = [];
    const size = Math.min(Math.max(Number(cfg.settings?.pageSize ?? 1000) || 1000, 1), 1000);
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    for (let page = 1; page <= maxPages; page++) {
      const params = new URLSearchParams({ "page[size]": String(size), "page[number]": String(page), ...extraParams });
      const { records, totalPages } = await this.fetchPage(cfg, path, params);
      out.push(...records);
      if (page >= totalPages || records.length === 0) break;
    }
    return out;
  }

  /** `filter[updated_at]` takes a range; only the lower bound is set, so everything newer is included. */
  private updatedSince(cfg: IntegrationConfig): Record<string, string> {
    if (String(cfg.settings?.incremental ?? "").toLowerCase() !== "true") return {};
    if (!cfg.lastSyncAt) return {};
    return { "filter[updated_at]": `${new Date(cfg.lastSyncAt).toISOString()},*` };
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const params = new URLSearchParams({ "page[size]": "1", "page[number]": "1" });
      await this.fetchPage(cfg, "/organizations", params);
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "itglue", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const updated = this.updatedSince(cfg);

    for (const { path, key } of this.resources) {
      try {
        const items = await this.fetchAll(cfg, path, updated);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        result.errors.push(`${key}: ${e.message}`);
      }
    }

    // Documents are only reachable through an organisation, so they follow the organisations pass.
    const organizations: any[] = (result as any).organizations ?? [];
    if (organizations.length) {
      const maxOrganizations = Math.min(Math.max(Number(cfg.settings?.maxOrganizations ?? 50) || 50, 1), 500);
      const documents: any[] = [];
      for (const organization of organizations.slice(0, maxOrganizations)) {
        try {
          const items = await this.fetchAll(cfg, `/organizations/${organization.id}/relationships/documents`, updated);
          documents.push(...items.map((doc: any) => ({ ...doc, organizationId: String(organization.id) })));
        } catch (e: any) {
          result.errors.push(`documents (organisation ${organization.id}): ${e.message}`);
        }
      }
      (result as any).documents = documents;
      result.recordsProcessed += documents.length;
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
