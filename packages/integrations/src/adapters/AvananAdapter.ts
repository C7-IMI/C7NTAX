import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Check Point Harmony Email & Collaboration (Avanan) adapter.
 *
 * API: https://app-swagger.avanan.com (v1.0)
 *
 * This connector previously could not have worked at all: it called `/api/v1/incidents` with an
 * `apikey` header. Harmony Email does not authenticate with a key — it authenticates with an
 * **application id and secret signed into a JWT**:
 *
 *   1. `POST {base}/v1.0/auth` with `x-av-app-id` and `x-av-app-secret` returns a JWT.
 *   2. Every later call carries that JWT in `x-av-token`, plus the app id.
 *
 * Two further differences matter: the hosts are **region-specific** (an EU tenant's data is not on
 * the US host), and the payload is wrapped — records are under `responseData`, with `responseEnvelope`
 * holding the status. Pagination is not `page`/`offset` but a `scrollId` the response hands back.
 *
 * The app credentials also need the tenant's own "Infinity Portal" app registration to be granted the
 * API scopes; without that, the token is issued but every query comes back empty, so an empty sync is
 * reported as empty rather than as an error.
 */
export class AvananAdapter implements IIntegrationAdapter {
  readonly kind = "avanan" as const;

  /** All documented regions. A tenant lives on exactly one, which is why the host is configured. */
  private readonly regions: Record<string, string> = {
    us: "https://api.avanan.com",
    eu: "https://eu.api.avanan.com",
    au: "https://au.api.avanan.com",
    in: "https://in.api.avanan.com",
  };

  private baseUrl(cfg: IntegrationConfig): string {
    const configured = (cfg.credentials.baseUrl || "").trim().replace(/\/+$/, "");
    if (configured) return configured;
    const region = ((cfg.credentials.region as string) || "us").trim().toLowerCase();
    const host = this.regions[region];
    if (!host) throw new Error(`Unknown Harmony Email region "${region}" — use ${Object.keys(this.regions).join(", ")}, or give a full base URL.`);
    return host;
  }

  /** The JWT is minted per sync rather than cached: its lifetime is short and a stale one reads as a permissions problem. */
  private async authenticate(cfg: IntegrationConfig): Promise<string> {
    const appId = (cfg.credentials.appId || "").trim();
    const appSecret = (cfg.credentials.appSecret || "").trim();
    if (!appId || !appSecret) throw new Error("A Harmony Email application id and secret are required.");

    const res = await fetch(`${this.baseUrl(cfg)}/v1.0/auth`, {
      method: "POST",
      headers: { "x-av-app-id": appId, "x-av-app-secret": appSecret, accept: "application/json" },
    });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* errors come back as HTML on a wrong host */ }

    const jwt = parsed?.responseData?.jwt ?? parsed?.responseData?.token ?? parsed?.jwt;
    if (!res.ok || !jwt) {
      const detail = parsed?.responseEnvelope?.message ?? parsed?.message ?? (text.slice(0, 200) || `HTTP ${res.status}`);
      throw new Error(`Harmony Email refused the application credentials: ${detail}`);
    }
    return jwt;
  }

  /** A page of a list endpoint, unwrapped from `responseEnvelope`/`responseData`. */
  private async query(cfg: IntegrationConfig, jwt: string, path: string, scrollId?: string): Promise<{ records: any[]; scrollId: string | null }> {
    const url = new URL(`${this.baseUrl(cfg)}${path}`);
    if (scrollId) url.searchParams.set("scrollId", scrollId);

    const res = await fetch(url.toString(), {
      headers: { "x-av-app-id": (cfg.credentials.appId || "").trim(), "x-av-token": jwt, accept: "application/json" },
    });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* see above */ }

    if (!res.ok) {
      const detail = parsed?.responseEnvelope?.message ?? parsed?.message ?? text.slice(0, 200);
      throw new Error(`Harmony Email ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }

    // The envelope holds status; the data holds the records. Both spellings appear across versions.
    const data = parsed?.responseData ?? parsed?.responseEnvelope?.responseData ?? parsed;
    const records = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : Array.isArray(data?.objects) ? data.objects : [];
    const next = parsed?.responseEnvelope?.scrollId ?? parsed?.scrollId ?? null;
    return { records, scrollId: typeof next === "string" && next ? next : null };
  }

  private async queryAll(cfg: IntegrationConfig, jwt: string, path: string): Promise<any[]> {
    const out: any[] = [];
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    let scrollId: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const { records, scrollId: next } = await this.query(cfg, jwt, path, scrollId);
      out.push(...records);
      if (!next || records.length === 0) break;
      scrollId = next;
    }
    return out;
  }

  /**
   * List endpoints worth reading. Harmony Email's other v1.0 routes are *actions* (engage, quarantine,
   * restore) rather than lists, so they are deliberately not synced.
   */
  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "/v1.0/incidents", key: "incidents" },
    { path: "/v1.0/events", key: "events" },
  ];

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const jwt = await this.authenticate(cfg);
      await this.query(cfg, jwt, "/v1.0/incidents");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "avanan", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    let jwt: string;
    try {
      jwt = await this.authenticate(cfg);
    } catch (e: any) {
      // Without a token there is nothing to try: report it once rather than once per resource.
      result.success = false;
      result.errors.push(e.message);
      return result;
    }

    const days = Math.min(Math.max(Number(cfg.settings?.lookbackDays ?? 7) || 7, 1), 90);
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    for (const { path, key } of this.resources) {
      try {
        const records = await this.queryAll(cfg, jwt, `${path}?startDate=${encodeURIComponent(since)}`);
        (result as any)[key] = records;
        result.recordsProcessed += records.length;
      } catch (e: any) {
        result.errors.push(`${key}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
