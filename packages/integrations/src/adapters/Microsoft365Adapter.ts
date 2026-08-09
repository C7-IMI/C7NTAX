import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Microsoft 365 / Azure AD integration adapter.
 * 
 * Handles OAuth 2.0 client credentials or authorization code flow,
 * syncs users → Contacts, groups, and subscription/license data
 * via the Microsoft Graph v1.0 API.
 * 
 * For SAML/OIDC single sign-on, see the separate "Azure AD SSO"
 * integration (azure_ad_sso adapter) which handles federation,
 * JIT user provisioning, and group-claim-to-role mapping.
 * 
 * Required credentials object:
 *   tenantId, clientId, clientSecret, accessToken (optional if using refresh)
 * 
 * Required settings:
 *   syncUsers, syncContacts, fieldMapping, syncIntervalMinutes
 */
export class Microsoft365Adapter implements IIntegrationAdapter {
  readonly kind = "microsoft365" as const;

  // ── OAuth Helpers ────────────────────────────────────────────────

  /**
   * Build the base Graph API URL for the tenant.
   */
  private graphUrl(path: string = ""): string {
    return `https://graph.microsoft.com/v1.0${path}`;
  }

  /**
   * Get an access token using client credentials (app-only) or
   * use an existing token from config.
   */
  private async getAccessToken(cfg: IntegrationConfig): Promise<string> {
    // If an accessToken is already stored and not expired, use it
    if (cfg.credentials.accessToken && cfg.credentials.expiresAt) {
      const expires = new Date(cfg.credentials.expiresAt as string).getTime();
      if (Date.now() < expires - 60000) {
        return cfg.credentials.accessToken as string;
      }
    }

    // If a refresh token is available, use it
    if (cfg.credentials.refreshToken) {
      return this.refreshAccessToken(cfg);
    }

    // Otherwise obtain a new app-only token via client credentials
    const { tenantId, clientId, clientSecret } = cfg.credentials;
    if (!tenantId || !clientId || !clientSecret) {
      throw new Error("Missing tenantId, clientId, or clientSecret");
    }

    const res = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "client_credentials",
          client_id: clientId as string,
          client_secret: clientSecret as string,
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`OAuth token request failed: ${res.status} ${err}`);
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    // Update credentials in-place for reuse
    cfg.credentials.accessToken = data.access_token;
    cfg.credentials.expiresAt = new Date(
      Date.now() + data.expires_in * 1000
    ).toISOString();
    if (data.refresh_token) {
      cfg.credentials.refreshToken = data.refresh_token;
    }

    return data.access_token;
  }

  private async refreshAccessToken(cfg: IntegrationConfig): Promise<string> {
    const { tenantId, clientId, clientSecret, refreshToken } = cfg.credentials;
    const res = await fetch(
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: clientId as string,
          client_secret: clientSecret as string,
          refresh_token: refreshToken as string,
          scope: "https://graph.microsoft.com/.default",
        }),
      }
    );

    if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`);

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
      refresh_token?: string;
    };

    cfg.credentials.accessToken = data.access_token;
    cfg.credentials.expiresAt = new Date(
      Date.now() + data.expires_in * 1000
    ).toISOString();
    if (data.refresh_token) {
      cfg.credentials.refreshToken = data.refresh_token;
    }

    return data.access_token;
  }

  /**
   * Fetch a paginated Graph API collection.
   */
  private async fetchAll(
    token: string,
    path: string,
    select?: string,
    top: number = 999
  ): Promise<unknown[]> {
    const results: unknown[] = [];
    let url = this.graphUrl(`${path}?$top=${top}`);
    if (select) url += `&$select=${select}`;

    while (url) {
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      });
      if (!res.ok) {
        throw new Error(`Graph API ${path}: HTTP ${res.status}`);
      }
      const data = (await res.json()) as {
        value?: unknown[];
        "@odata.nextLink"?: string;
      };
      if (data.value) results.push(...data.value);
      url = data["@odata.nextLink"] || "";
    }

    return results;
  }

  // ── IIntegrationAdapter Implementation ────────────────────────────

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const token = await this.getAccessToken(cfg);
      const res = await fetch(this.graphUrl("/organization"), {
        headers: { Authorization: `Bearer ${token}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  /**
   * Full sync: users → M365User + Contact, groups, subscriptions.
   * The caller (API route) handles Prisma writes using returned data.
   */
  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = {
      success: true,
      kind: "microsoft365",
      recordsProcessed: 0,
      errors: [],
      syncedAt: new Date(),
    };

    try {
      const token = await this.getAccessToken(cfg);

      // ── Sync Users ──
      try {
        const userSelect =
          "id,userPrincipalName,displayName,givenName,surname,mail,jobTitle,department,officeLocation,mobilePhone,businessPhones,usageLocation,accountEnabled";
        const users = (await this.fetchAll(
          token,
          "/users",
          userSelect
        )) as Array<Record<string, unknown>>;

        result.recordsProcessed += users.length;
        (result as any).users = users;
        (result as any).userSelect = userSelect;
      } catch (e: any) {
        result.errors.push(`users: ${e.message}`);
      }

      // ── Sync Groups ──
      try {
        const groups = (await this.fetchAll(
          token,
          "/groups",
          "id,displayName,description,mail,visibility"
        )) as Array<Record<string, unknown>>;

        result.recordsProcessed += groups.length;
        (result as any).groups = groups;
      } catch (e: any) {
        result.errors.push(`groups: ${e.message}`);
      }

      // ── Sync Subscriptions (Licenses) ──
      try {
        const subs = (await this.fetchAll(
          token,
          "/subscribedSkus"
        )) as Array<Record<string, unknown>>;

        result.recordsProcessed += subs.length;
        (result as any).subscriptions = subs;
      } catch (e: any) {
        result.errors.push(`subscriptions: ${e.message}`);
      }

      result.success = result.errors.length === 0;
    } catch (e: any) {
      result.success = false;
      result.errors.push(String(e));
    }

    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {
    // Clear stored tokens
    delete _cfg.credentials.accessToken;
    delete _cfg.credentials.refreshToken;
    delete _cfg.credentials.expiresAt;
  }
}
