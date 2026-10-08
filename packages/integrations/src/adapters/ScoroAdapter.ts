import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Scoro adapter.
 *
 * API: https://api.scoro.com/api/v2 (module routes, `POST {module}/list`)
 *
 * Auth lives **in the request body**, and every call is addressed by module: each request posts
 *
 *   { "apiKey": …, "company_account_id": …, "lang": "eng", "per_page": 100, "page": 1, "request": {} }
 *
 * to `https://{site}.scoro.com/api/v2/{module}/list`. The previous version addressed the RPC method
 * itself (`/api/v2/getContactList`), passed the key as `?apikey=` and never sent
 * `company_account_id` — three independent reasons every call failed. `company_account_id` is not
 * optional: Scoro uses it to pick the account inside the site, so a request without it is
 * ambiguous even when the key is valid.
 *
 * The site subdomain is part of the address (`acme` → `acme.scoro.com`), so taking a bare "API base
 * URL" as the only credential could never have worked either — hence `site` here.
 *
 * Responses are `{ status, data: [...], messages: [...] }`. A `status` other than `ok` carries the
 * vendor's own explanation in `messages`, which is what gets reported.
 */
export class ScoroAdapter implements IIntegrationAdapter {
  readonly kind = "scoro" as const;

  /** Modules worth reading into C7NTAX. Action endpoints (create/update/delete) are not list routes. */
  private readonly modules: Array<{ module: string; key: string }> = [
    { module: "contacts", key: "contacts" },
    { module: "projects", key: "projects" },
    { module: "tasks", key: "tasks" },
    { module: "invoices", key: "invoices" },
    { module: "quotes", key: "quotes" },
    { module: "bills", key: "bills" },
    { module: "products", key: "products" },
    { module: "events", key: "events" },
  ];

  private baseUrl(cfg: IntegrationConfig): string {
    const site = (cfg.credentials.site || "").trim().replace(/^https?:\/\//, "").replace(/\.scoro\.com.*$/, "").replace(/\/+$/, "");
    if (!site) throw new Error("The Scoro site subdomain is required (the `acme` in acme.scoro.com).");
    if (/\./.test(site)) throw new Error(`"${site}" is not a Scoro site subdomain — enter just the subdomain, not a hostname.`);
    return `https://${site}.scoro.com/api/v2`;
  }

  private perPage(cfg: IntegrationConfig): number {
    const n = Number(cfg.settings?.perPage ?? 100);
    return Number.isFinite(n) && n > 0 ? Math.min(Math.floor(n), 500) : 100;
  }

  private async list(cfg: IntegrationConfig, module: string, page: number): Promise<any[]> {
    const res = await fetch(`${this.baseUrl(cfg)}/${module}/list`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({
        apiKey: cfg.credentials.apiKey || "",
        company_account_id: cfg.credentials.companyAccountId || "",
        lang: (cfg.credentials.lang as string) || "eng",
        per_page: this.perPage(cfg),
        page,
        request: {},
      }),
    });

    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* Scoro answers with HTML on a bad site subdomain */ }

    if (!res.ok) throw new Error(`Scoro ${module}: HTTP ${res.status}${parsed?.messages ? ` — ${this.messages(parsed)}` : ""}`);
    if (parsed?.status && parsed.status !== "ok") throw new Error(`Scoro ${module}: ${this.messages(parsed) || parsed.status}`);
    return Array.isArray(parsed?.data) ? parsed.data : [];
  }

  private messages(parsed: any): string {
    const messages = parsed?.messages;
    if (!messages) return "";
    if (Array.isArray(messages)) {
      return messages.map((m: any) => (typeof m === "string" ? m : m?.message ?? m?.error ?? JSON.stringify(m))).join("; ");
    }
    return typeof messages === "string" ? messages : JSON.stringify(messages);
  }

  /** Page through one module until a short page arrives. */
  private async listAll(cfg: IntegrationConfig, module: string): Promise<any[]> {
    const out: any[] = [];
    const perPage = this.perPage(cfg);
    const maxPages = Math.min(Number(cfg.settings?.maxPages ?? 20) || 20, 200);
    for (let page = 1; page <= maxPages; page++) {
      const items = await this.list(cfg, module, page);
      out.push(...items);
      if (items.length < perPage) break;
    }
    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.list(cfg, "contacts", 1);
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "scoro", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    for (const { module, key } of this.modules) {
      try {
        const items = await this.listAll(cfg, module);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        // One module the key cannot read (a plan without invoicing, say) should not sink the sync.
        result.errors.push(`${module}: ${e.message}`);
      }
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
