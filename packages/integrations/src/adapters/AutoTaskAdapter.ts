import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * AutoTask PSA adapter (Autotask REST API v1.0).
 *
 * API: https://ww1.autotask.net/help/developerhelp/Content/APIs/REST/REST_API_Home.htm
 *
 * Three defects made the previous version unusable against a real tenant:
 *
 * 1. **The zone is part of the host.** An Autotask tenant lives on `webservices{N}.autotask.net` —
 *    `webservices3` is America East, and so on — and there is no `webservices.autotask.net` without
 *    a number. The endpoint documented for exactly this is
 *    `GET /atservicesrest/v1.0/zoneInformation?user=<full username>`, which is unauthenticated and
 *    answers with the tenant's own URL, so this adapter resolves the zone (or accepts one, or a full
 *    base URL) instead of guessing.
 * 2. **An account is a *company*.** The entity is `Companies`; `Accounts` is not an AutoTask entity,
 *    so that read could only ever 404.
 * 3. **Paging is not "stop when a short page arrives".** The response carries
 *    `pageDetails.nextPageUrl`, and the documented rule is to keep following that URL until it is
 *    null — re-posting the same body re-fetches page one forever.
 *
 * Authentication itself was right and is unchanged: three headers (`UserName`, `Secret`,
 * `ApiIntegrationCode`), no token exchange.
 */
export class AutoTaskAdapter implements IIntegrationAdapter {
  readonly kind = "autotask" as const;

  /** Documented zones. Autotask's own zone page lists these hosts. */
  private readonly zoneHosts = [1, 2, 3, 4, 5, 6, 7, 8].map(n => `https://webservices${n}.autotask.net`);

  /** Resolved base URLs, keyed by user name: the zone probe is 8 requests, and it only takes one answer. */
  private static readonly zoneCache = new Map<string, string>();

  private readonly entities: Array<{ entity: string; key: string }> = [
    { entity: "Companies", key: "companies" },
    { entity: "Contacts", key: "contacts" },
    { entity: "Tickets", key: "tickets" },
    { entity: "Projects", key: "projects" },
    { entity: "Tasks", key: "tasks" },
    { entity: "Resources", key: "resources" },
    { entity: "Opportunities", key: "opportunities" },
    { entity: "Contracts", key: "contracts" },
    { entity: "Products", key: "products" },
  ];

  private headers(cfg: IntegrationConfig): Record<string, string> {
    const username = (cfg.credentials.username || "").trim();
    const secret = (cfg.credentials.password || "").trim();
    const integrationCode = (cfg.credentials.integrationCode || "").trim();
    if (!username || !secret || !integrationCode) {
      throw new Error("An AutoTask API user name, password and integration code are required.");
    }
    return {
      UserName: username,
      Secret: secret,
      ApiIntegrationCode: integrationCode,
      "content-type": "application/json",
      accept: "application/json",
    };
  }

  /** A configured zone or URL, when the operator already knows it. */
  private configuredBase(cfg: IntegrationConfig): string | null {
    const raw = String(cfg.credentials.zone || cfg.settings?.zoneUrl || cfg.credentials.baseUrl || "").trim();
    if (!raw) return null;
    if (/^https?:\/\//i.test(raw)) return raw.replace(/\/+$/, "").replace(/\/atservicesrest.*$/i, "") + "/atservicesrest/v1.0";
    const digits = raw.match(/(\d+)/)?.[1];
    if (digits) return `https://webservices${digits}.autotask.net/atservicesrest/v1.0`;
    throw new Error(`"${raw}" is not an AutoTask zone — give the zone number (3) or a full host.`);
  }

  /** Ask each zone host who owns this user; the one that answers wins. */
  private async discoverBase(cfg: IntegrationConfig): Promise<string> {
    const username = (cfg.credentials.username || "").trim();
    const cached = AutoTaskAdapter.zoneCache.get(username);
    if (cached) return cached;

    const attempts = this.zoneHosts.map(async host => {
      const res = await fetch(`${host}/atservicesrest/v1.0/zoneInformation?user=${encodeURIComponent(username)}`);
      if (!res.ok) throw new Error(`HTTP ${res.status} from ${host}`);
      const parsed = (await res.json().catch(() => null)) as { url?: string } | null;
      if (!parsed?.url) throw new Error(`${host} answered without a zone URL`);
      return parsed.url.replace(/\/+$/, "") + (parsed.url.includes("/v1.0") ? "" : "/v1.0");
    });

    try {
      return await Promise.any(attempts);
    } catch {
      throw new Error(
        "Could not work out which AutoTask zone this API user belongs to. Enter the zone number (for example 3) or the full webservices host."
      );
    }
  }

  private async baseUrl(cfg: IntegrationConfig): Promise<string> {
    const configured = this.configuredBase(cfg);
    if (configured) return configured;
    const resolved = await this.discoverBase(cfg);
    AutoTaskAdapter.zoneCache.set((cfg.credentials.username || "").trim(), resolved);
    return resolved;
  }

  private async query(cfg: IntegrationConfig, entity: string, maxRecords: number): Promise<any[]> {
    const base = await this.baseUrl(cfg);
    const res = await fetch(`${base}/${entity}/query`, {
      method: "POST",
      headers: this.headers(cfg),
      body: JSON.stringify({ MaxRecords: maxRecords }),
    });

    if (res.status === 429) throw new Error("AutoTask rate limit reached — retry in a moment.");
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`AutoTask ${entity}: HTTP ${res.status}${text ? ` — ${text.slice(0, 200)}` : ""}`);
    }

    const out: any[] = [];
    let parsed: any = await res.json().catch(() => null);
    let pages = 0;
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);

    while (parsed && pages < maxPages) {
      if (Array.isArray(parsed.items)) out.push(...parsed.items);
      const next: string | null | undefined = parsed.pageDetails?.nextPageUrl;
      if (!next) break;
      const nextRes = await fetch(next, { headers: this.headers(cfg) });
      if (!nextRes.ok) throw new Error(`AutoTask ${entity} page ${pages + 2}: HTTP ${nextRes.status}`);
      parsed = await nextRes.json().catch(() => null);
      pages++;
    }

    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      // A one-record company query proves the zone, the three headers and the entity name at once.
      await this.query(cfg, "Companies", 1);
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "autotask", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const maxRecords = Math.min(Math.max(Number(cfg.settings?.maxRecords ?? 500) || 500, 1), 500);

    for (const { entity, key } of this.entities) {
      try {
        const items = await this.query(cfg, entity, maxRecords);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        // An entity the API user's security level cannot read reports itself; the rest still sync.
        result.errors.push(`${entity}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
