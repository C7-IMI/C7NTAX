import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";
import { clientCredentialsToken } from "../oauth";

/**
 * Azure Resource Manager adapter.
 *
 * API:  https://learn.microsoft.com/en-us/rest/api/resources/
 * Auth: an app registration, a token from the client-credentials grant, and the **Reader** role on
 *       the subscription. Scope: `https://management.azure.com/.default`.
 *
 * The credential set used to be `accessToken` + `subscriptionId`, and that could not work: an ARM
 * bearer token is good for about an hour and the client-credentials grant issues no refresh token,
 * so a pasted one is dead by the time anybody syncs twice. It is now the same shape as the Microsoft
 * 365 connector — tenant, client id, client secret — with the subscription as the scope to read.
 *
 * ARM requires an `api-version` on every call, and a version that does not exist is answered by
 * *falling back* to the service's default — which looks like a working call and is not the API that
 * was asked for. The versions here are documented ones.
 */
export class AzureAdapter implements IIntegrationAdapter {
  readonly kind = "azure" as const;

  private baseUrl = "https://management.azure.com";

  private token(cfg: IntegrationConfig): Promise<string> {
    const tenant = (cfg.credentials.tenantId || "").trim();
    return clientCredentialsToken({
      tokenUrl: `https://login.microsoftonline.com/${encodeURIComponent(tenant || "common")}/oauth2/v2.0/token`,
      clientId: cfg.credentials.clientId || "",
      clientSecret: cfg.credentials.clientSecret || "",
      scope: "https://management.azure.com/.default",
      cacheKey: `azure|${tenant}|${cfg.credentials.clientId || ""}`,
    });
  }

  private async apiGet(cfg: IntegrationConfig, path: string, apiVersion: string): Promise<any> {
    const token = await this.token(cfg);
    const res = await fetch(`${this.baseUrl}${path}?api-version=${apiVersion}`, {
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `Azure ${path}: HTTP ${res.status}` +
          (res.status === 403 ? " — the app needs the Reader role on this subscription" : detail ? ` — ${detail.slice(0, 200)}` : ""),
      );
    }
    return res.json();
  }

  private subId(cfg: IntegrationConfig): string {
    return (cfg.credentials.subscriptionId as string) || "";
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      // The subscription itself: proves a token was issued *and* that the app may read this scope.
      await this.apiGet(cfg, `/subscriptions/${this.subId(cfg)}`, "2022-12-01");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "azure", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const sub = this.subId(cfg);
    const resources: Array<{ path: string; key: string; version: string }> = [
      { path: `/subscriptions/${sub}/resources`, key: "resources", version: "2021-04-01" },
      { path: `/subscriptions/${sub}/resourcegroups`, key: "resourceGroups", version: "2021-04-01" },
      { path: `/subscriptions/${sub}/providers/Microsoft.Security/alerts`, key: "securityAlerts", version: "2022-01-01" },
      { path: `/subscriptions/${sub}/providers/Microsoft.Authorization/policyAssignments`, key: "policyAssignments", version: "2023-04-01" },
    ];
    for (const r of resources) {
      try {
        const data = await this.apiGet(cfg, r.path, r.version);
        const items = data?.value || [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
