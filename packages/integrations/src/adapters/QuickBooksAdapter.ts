import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * QuickBooks Online adapter.
 *
 * API: https://developer.intuit.com/app/developer/qbo/docs/api/accounting/all-entities/invoice
 *
 * QuickBooks does not issue long-lived tokens, and this is the whole reason the previous version
 * could not stay connected: an access token lasts **one hour**, and it is obtained by exchanging a
 * **refresh token** at a separate host from the API itself:
 *
 *   POST https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer
 *   Authorization: Basic base64(clientId:clientSecret)
 *   grant_type=refresh_token&refresh_token=…
 *
 * So a connector that stores only an access token works for an hour and then reports itself broken.
 * This adapter stores the refresh token and mints an access token per sync, caching it for its
 * lifetime.
 *
 * Intuit may also **rotate the refresh token** on each exchange (apps opt into rotation). The new
 * value only exists in this response, so it is kept in memory for the process and the caller is told
 * about it in `errors` — losing it silently would break the connection at the next restart, and a
 * warning is better than a mystery.
 *
 * Every query goes through `/v3/company/{realmId}/query` with SQL-ish syntax, and the sandbox lives
 * on a different host than production, which is why the environment is a setting rather than hard-coded.
 */
const tokenCache = new Map<string, { accessToken: string; expiresAt: number }>();

export class QuickBooksAdapter implements IIntegrationAdapter {
  readonly kind = "quickbooks" as const;

  /** Entities worth reading, as QuickBooks' own query names. */
  private readonly entities: Array<{ entity: string; key: string; orderBy?: string }> = [
    { entity: "Customer", key: "customers", orderBy: "DisplayName" },
    { entity: "Invoice", key: "invoices", orderBy: "TxnDate" },
    { entity: "Payment", key: "payments", orderBy: "TxnDate" },
    { entity: "Item", key: "items" },
    { entity: "Vendor", key: "vendors", orderBy: "DisplayName" },
    { entity: "Bill", key: "bills", orderBy: "TxnDate" },
    { entity: "Estimate", key: "estimates", orderBy: "TxnDate" },
    { entity: "Purchase", key: "purchases", orderBy: "TxnDate" },
    { entity: "TimeActivity", key: "timeActivities" },
  ];

  private apiBase(cfg: IntegrationConfig): string {
    const sandbox = String(cfg.settings?.environment ?? "").toLowerCase() === "sandbox";
    return sandbox ? "https://sandbox-quickbooks.api.intuit.com" : "https://quickbooks.api.intuit.com";
  }

  private realmId(cfg: IntegrationConfig): string {
    const realmId = (cfg.credentials.realmId || "").trim();
    if (!realmId) throw new Error("The QuickBooks company id (realm id) is required.");
    return realmId;
  }

  /** Exchange the refresh token for an access token, honouring the one-hour lifetime. */
  private async accessToken(cfg: IntegrationConfig): Promise<string> {
    const clientId = (cfg.credentials.clientId || "").trim();
    const clientSecret = (cfg.credentials.clientSecret || "").trim();
    const refreshToken = (cfg.credentials.refreshToken || "").trim();
    if (!clientId || !clientSecret) throw new Error("A QuickBooks client id and secret are required.");
    if (!refreshToken) throw new Error("A QuickBooks refresh token is required — an access token expires after an hour.");

    const key = `${clientId}|${refreshToken}`;
    const cached = tokenCache.get(key);
    if (cached && cached.expiresAt > Date.now() + 120_000) return cached.accessToken;

    const res = await fetch("https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer", {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
        accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken }).toString(),
    });

    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* Intuit answers plain text on some failures */ }

    if (!res.ok || !parsed.access_token) {
      const detail = parsed.error_description || parsed.error || text.slice(0, 200) || `HTTP ${res.status}`;
      throw new Error(`QuickBooks refused the refresh token: ${detail}`);
    }

    const lifetime = Math.max(60, Number(parsed.expires_in ?? 3600)) * 1000;
    tokenCache.set(key, { accessToken: parsed.access_token, expiresAt: Date.now() + lifetime });
    if (parsed.refresh_token && parsed.refresh_token !== refreshToken) tokenCache.set(`${key}|rotated`, { accessToken: parsed.refresh_token, expiresAt: Date.now() + lifetime });
    return parsed.access_token;
  }

  /** The refresh token the vendor handed back during this process, when it rotated one. */
  private rotatedRefreshToken(cfg: IntegrationConfig): string | null {
    const key = `${(cfg.credentials.clientId || "").trim()}|${(cfg.credentials.refreshToken || "").trim()}`;
    return tokenCache.get(`${key}|rotated`)?.accessToken ?? null;
  }

  private async query(cfg: IntegrationConfig, token: string, statement: string): Promise<any[]> {
    const url = `${this.apiBase(cfg)}/v3/company/${encodeURIComponent(this.realmId(cfg))}/query?query=${encodeURIComponent(statement)}&minorversion=70`;
    const res = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* see above */ }

    if (!res.ok) {
      // QuickBooks puts the useful sentence in Fault.Error[0].Message.
      const fault = parsed?.Fault?.Error?.[0];
      const detail = fault ? `${fault.Code ?? ""} ${fault.Message ?? ""}`.trim() : text.slice(0, 200);
      throw new Error(`QuickBooks query: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }

    const response = parsed?.QueryResponse ?? {};
    const key = Object.keys(response).find(k => Array.isArray(response[k]));
    return key ? response[key] : [];
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const token = await this.accessToken(cfg);
      await this.query(cfg, token, "select * from CompanyInfo");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "quickbooks", recordsProcessed: 0, errors: [], syncedAt: new Date() };

    let token: string;
    try {
      token = await this.accessToken(cfg);
    } catch (e: any) {
      result.success = false;
      result.errors.push(e.message);
      return result;
    }

    const limit = Math.min(Math.max(Number(cfg.settings?.recordLimit ?? 1000) || 1000, 1), 5000);

    for (const { entity, key, orderBy } of this.entities) {
      try {
        const items = await this.query(cfg, token, `select * from ${entity}${orderBy ? ` orderby ${orderBy} desc` : ""} maxresults ${limit}`);
        (result as any)[key] = items;
        result.recordsProcessed += items.length;
      } catch (e: any) {
        result.errors.push(`${entity}: ${e.message}`);
      }
    }

    const rotated = this.rotatedRefreshToken(cfg);
    if (rotated) {
      result.errors.push("QuickBooks rotated the refresh token during this sync — update the stored refresh token with the new value or the connection will fail after a restart.");
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
