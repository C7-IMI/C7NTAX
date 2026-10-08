import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * SentinelOne adapter (Singularity Data Lake / Management console API v2.1).
 *
 * API: https://<your-console>/api-doc/api-details?endpoint=system
 *
 * The console host is **yours**, not the vendor's: `usea1.sentinelone.net` is one tenant's address,
 * and a shared host answers for the wrong tenant (or 401s). The previous version hard-coded
 * `usea1`, so it could only ever have worked for the account that happens to live there — hence
 * `consoleUrl` as a required credential.
 *
 * Auth is the console API token in an `ApiToken` header (not `Bearer`). The connectivity test is
 * `/system/info`, which every token can read, so a failure there is a token or host problem rather
 * than a permissions one.
 *
 * List responses are `{ data: [...], pagination: { nextCursor } }` and paging is by cursor, so the
 * `limit`/`skip` style the previous version used would have silently returned only the first page.
 */
export class SentinelOneAdapter implements IIntegrationAdapter {
  readonly kind = "sentinelone" as const;

  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "/web/api/v2.1/threats", key: "threats" },
    { path: "/web/api/v2.1/agents", key: "agents" },
    { path: "/web/api/v2.1/activities", key: "activities" },
    { path: "/web/api/v2.1/groups", key: "groups" },
    { path: "/web/api/v2.1/sites", key: "sites" },
    { path: "/web/api/v2.1/application-management/risks", key: "appRisks" },
    { path: "/web/api/v2.1/ranger/gateways", key: "rangerGateways" },
  ];

  private baseUrl(cfg: IntegrationConfig): string {
    let host = (cfg.credentials.consoleUrl || "").trim().replace(/\/+$/, "");
    if (!host) throw new Error("A SentinelOne console URL is required (for example https://usea1-acme.sentinelone.net).");
    if (!/^https?:\/\//i.test(host)) host = `https://${host}`;
    return host;
  }

  private headers(cfg: IntegrationConfig): Record<string, string> {
    const token = (cfg.credentials.apiToken || "").trim();
    if (!token) throw new Error("A SentinelOne API token is required.");
    return { authorization: `ApiToken ${token}`, accept: "application/json" };
  }

  private async call(cfg: IntegrationConfig, path: string): Promise<any> {
    const res = await fetch(`${this.baseUrl(cfg)}${path}`, { headers: this.headers(cfg) });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* a wrong host answers with HTML */ }
    if (!res.ok) {
      const detail = parsed?.errors?.[0]?.detail ?? parsed?.error ?? text.slice(0, 200);
      throw new Error(`SentinelOne ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    return parsed;
  }

  private async fetchAll(cfg: IntegrationConfig, path: string): Promise<any[]> {
    const out: any[] = [];
    const limit = Math.min(Math.max(Number(cfg.settings?.pageSize ?? 100) || 100, 1), 1000);
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    let cursor: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const parsed = await this.call(cfg, `${path}?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      const items = Array.isArray(parsed?.data) ? parsed.data : [];
      out.push(...items);
      cursor = parsed?.pagination?.nextCursor ?? undefined;
      if (!cursor || items.length === 0) break;
    }
    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const parsed = await this.call(cfg, "/web/api/v2.1/system/info");
      return Boolean(parsed?.data?.version || parsed?.data);
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "sentinelone", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    const since = cfg.settings?.lookbackDays
      ? new Date(Date.now() - Math.min(Math.max(Number(cfg.settings.lookbackDays) || 30, 1), 365) * 86_400_000).toISOString()
      : null;

    for (const { path, key } of this.resources) {
      try {
        // Threats and activities are the two that grow without bound, so they get the window.
        const windowed = since && (key === "threats" || key === "activities")
          ? `${path}?createdAt__gte=${encodeURIComponent(since)}`
          : path;
        const items = await this.fetchAll(cfg, windowed);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        result.errors.push(`${key}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
