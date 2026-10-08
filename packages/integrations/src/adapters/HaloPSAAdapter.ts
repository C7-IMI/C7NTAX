import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * HaloPSA adapter.
 *
 * API: https://halopsa.com/apidoc (client-credentials collection at https://s3.haloitsm.com/halo_api_collection.json)
 *
 * Four corrections against the previous version:
 *
 * 1. **The token request needs a `scope`.** Halo's API application is granted permissions on its own
 *    permissions tab, and the token request asks for them (`scope=all` for everything). Without it
 *    the token is issued but carries no rights, which reads as an empty tenant rather than an error.
 * 2. **Hosted tenants authenticate at a different host.** Halo's hosted service issues tokens from
 *    `auth.<domain>/token?tenant=<tenant>`; only on-premise installs use `<tenant>/auth/token`. Both
 *    are tried, because which one applies depends on where the tenant is hosted — and a wrong guess
 *    here looks exactly like a wrong secret.
 * 3. **Paging is `page_size`/`page_no`** (with Halo's own spelling, `pageinate=true`). `$top`/`$skip`
 *    are ignored, so the previous version re-read page one until its short-page check fired.
 * 4. **`/software` is not a resource.** "Software" exists only as a search field on tickets and
 *    opportunities, so that read 404'd on every sync.
 *
 * Resource paths are the documented lowercase ones (`/api/tickets`, `/api/clients`, …); Halo's docs
 * publish only the generic `/api` rule and one example, so anything a tenant does not have licensed
 * reports its own refusal instead of failing the sync.
 */
export class HaloPSAAdapter implements IIntegrationAdapter {
  readonly kind = "halopsa" as const;

  /** Documented resources. Software is deliberately absent: it is a field, not a resource. */
  private readonly resources: Array<{ path: string; key: string }> = [
    { path: "/tickets", key: "tickets" },
    { path: "/clients", key: "clients" },
    { path: "/users", key: "users" },
    { path: "/agents", key: "agents" },
    { path: "/sites", key: "sites" },
    { path: "/assets", key: "assets" },
    { path: "/contracts", key: "contracts" },
    { path: "/suppliers", key: "suppliers" },
    { path: "/actions", key: "actions" },
    { path: "/appointments", key: "appointments" },
    { path: "/projects", key: "projects" },
    { path: "/items", key: "items" },
    { path: "/invoices", key: "invoices" },
  ];

  private tenantUrl(cfg: IntegrationConfig): string {
    const raw = (cfg.credentials.tenantUrl || "").trim().replace(/\/+$/, "");
    if (!raw) throw new Error("A HaloPSA tenant URL is required, for example https://company.halopsa.com");
    return /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  }

  /** Every URL worth trying for a token: the configured one, the hosted auth host, then the tenant itself. */
  private tokenUrls(cfg: IntegrationConfig): string[] {
    const tenant = this.tenantUrl(cfg);
    const explicit = (cfg.credentials.tokenUrl || "").trim();
    if (explicit) return [explicit];

    const host = new URL(tenant).host;
    const labels = host.split(".");
    const isHosted = /(^|\.)halopsa\.com$|(^|\.)haloservicedesk\.com$/i.test(host);
    const urls: string[] = [];
    if (isHosted && labels.length > 2) {
      const tenantName = labels[0];
      urls.push(`https://auth.${labels.slice(1).join(".")}/token?tenant=${encodeURIComponent(tenantName!)}`);
    }
    urls.push(`${tenant}/auth/token`);
    return urls;
  }

  /** A token from the first endpoint that will issue one. */
  private async token(cfg: IntegrationConfig): Promise<string> {
    const clientId = (cfg.credentials.clientId || "").trim();
    const clientSecret = (cfg.credentials.clientSecret || "").trim();
    if (!clientId || !clientSecret) throw new Error("A HaloPSA API application client id and secret are required.");

    const failures: string[] = [];
    for (const url of this.tokenUrls(cfg)) {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId,
          client_secret: clientSecret,
          scope: String(cfg.credentials.scope || cfg.settings?.scope || "all"),
        }).toString(),
      }).catch((e: any) => ({ ok: false, status: 0, text: async () => e.message } as unknown as Response));

      const text = await res.text().catch(() => "");
      if (res.ok) {
        try {
          const parsed = JSON.parse(text) as { access_token?: string };
          if (parsed.access_token) return parsed.access_token;
        } catch { /* fall through to the next endpoint */ }
      }
      failures.push(`${url}: HTTP ${res.status}${text ? ` ${text.slice(0, 120)}` : ""}`);
    }

    throw new Error(`HaloPSA would not issue a token — ${failures.join("; ")}`);
  }

  /** Halo answers with either a bare array or an object whose first array is the records. */
  private records(parsed: any): any[] {
    if (Array.isArray(parsed)) return parsed;
    if (!parsed || typeof parsed !== "object") return [];
    const arrayValue = Object.values(parsed).find(Array.isArray);
    return (arrayValue as any[]) ?? [];
  }

  private async fetchAll(cfg: IntegrationConfig, token: string, path: string): Promise<any[]> {
    const out: any[] = [];
    const pageSize = Math.min(Math.max(Number(cfg.settings?.pageSize ?? 100) || 100, 1), 1000);
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);

    for (let page = 1; page <= maxPages; page++) {
      const url = `${this.tenantUrl(cfg)}/api${path}?pageinate=true&page_size=${pageSize}&page_no=${page}`;
      const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
      const text = await res.text().catch(() => "");
      if (!res.ok) throw new Error(`HaloPSA ${path}: HTTP ${res.status}${text ? ` — ${text.slice(0, 160)}` : ""}`);

      let parsed: any = null;
      try { parsed = JSON.parse(text); } catch { /* an HTML sign-in page means the token was not accepted */ }
      const items = this.records(parsed);
      out.push(...items);
      // A short page, or no page count to compare against, ends the walk.
      const reported = Number(parsed?.record_count ?? parsed?.count ?? NaN);
      if (items.length < pageSize) break;
      if (!Number.isNaN(reported) && out.length >= reported) break;
    }

    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const token = await this.token(cfg);
      await this.fetchAll(cfg, token, "/tickets");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "halopsa", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    let token: string;
    try {
      token = await this.token(cfg);
    } catch (e: any) {
      result.success = false;
      result.errors.push(e.message);
      return result;
    }

    for (const { path, key } of this.resources) {
      try {
        const items = await this.fetchAll(cfg, token, path);
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
