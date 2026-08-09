import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * IT Glue documentation platform adapter.
 * API: https://api.itglue.com/developer/
 * Auth: x-api-key header
 * Resources: configurations, flexible_assets, passwords, documents,
 *            contacts, organizations, domains, locations, attachments
 */
export class ITGlueAdapter implements IIntegrationAdapter {
  readonly kind = "itglue" as const;

  // ── Helpers ──────────────────────────────────────────────────────

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://api.itglue.com";
  }

  /** Fetch a single page. Returns { data, meta, links } */
  private async fetchPage(cfg: IntegrationConfig, path: string, params: URLSearchParams): Promise<any> {
    const url = `${this.baseUrl(cfg)}${path}?${params.toString()}`;
    const res = await fetch(url, {
      headers: {
        "x-api-key": cfg.credentials.apiKey as string,
        Accept: "application/json",
      },
    });
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`IT Glue ${path}: HTTP ${res.status} — ${body.slice(0, 200)}`);
    }
    return res.json();
  }

  /** Fetch all pages for a collection. */
  private async fetchAll(
    cfg: IntegrationConfig,
    resource: string,
    extraParams: Record<string, string> = {}
  ): Promise<{ items: unknown[]; pageCount: number }> {
    const items: unknown[] = [];
    const pageSize = 1000; // IT Glue max
    let pageNumber = 1;
    let totalPages = 1;

    while (pageNumber <= totalPages) {
      const params = new URLSearchParams({
        "page[size]": String(pageSize),
        "page[number]": String(pageNumber),
        ...extraParams,
      });

      const data = await this.fetchPage(cfg, `/${resource}`, params);

      if (Array.isArray(data?.data)) {
        items.push(...data.data);
      }

      totalPages = data?.meta?.["total-pages"] || data?.meta?.totalPages || 1;
      pageNumber++;
    }

    return { items, pageCount: totalPages };
  }

  // ── IIntegrationAdapter ───────────────────────────────────────────

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/api`, {
        headers: { "x-api-key": cfg.credentials.apiKey as string, Accept: "application/json" },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      kind: "itglue",
      recordsProcessed: 0,
      errors: [],
      syncedAt: new Date(),
    };

    // IT Glue resources in priority order
    const resources = [
      { path: "organizations", include: [] },
      { path: "configurations", include: ["organization"] },
      { path: "flexible_assets", include: ["organization"] },
      { path: "passwords", include: ["organization"] },
      { path: "documents", include: ["organization"] },
      { path: "contacts", include: ["organization"] },
      { path: "domains", include: [] },
      { path: "locations", include: ["organization"] },
    ];

    // Build filter params: only get records updated since last sync
    const filterParams: Record<string, string> = {};
    if (cfg.lastSyncAt) {
      filterParams["filter[updated_at]"] = cfg.lastSyncAt.toISOString();
    }

    for (const rsrc of resources) {
      try {
        const extra: Record<string, string> = { ...filterParams };
        if (rsrc.include.length > 0) {
          extra["include"] = rsrc.include.join(",");
        }

        const { items } = await this.fetchAll(cfg, rsrc.path, extra);
        result.recordsProcessed += items.length;

        // Attach raw data for DB persistence
        (result as any)[rsrc.path] = items;
      } catch (e: any) {
        result.errors.push(`${rsrc.path}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
