import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Proofpoint Email Security adapter.
 * API: https://help.proofpoint.com
 * Auth: Basic (principal:secret)
 * Resources: siem messages (blocked, delivered), clicks (permitted, blocked)
 */
export class ProofpointAdapter implements IIntegrationAdapter {
  readonly kind = "proofpoint" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    return (cfg.settings?.baseUrl as string) || "https://tap-api-v2.proofpoint.com";
  }

  private authHeader(cfg: IntegrationConfig): string {
    return `Basic ${btoa(`${cfg.credentials.principal}:${cfg.credentials.secret}`)}`;
  }

  private sinceSeconds(cfg: IntegrationConfig): number {
    if (cfg.lastSyncAt) return Math.floor((Date.now() - cfg.lastSyncAt.getTime()) / 1000);
    return 86400; // default 24h
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${this.baseUrl(cfg)}/v2/siem/all?format=json&sinceSeconds=60`, {
        headers: { Authorization: this.authHeader(cfg) },
      });
      return res.ok || res.status === 404;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "proofpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const secs = this.sinceSeconds(cfg);
    const siemTypes: Array<{ path: string; key: string }> = [
      { path: `/v2/siem/messages/blocked?format=json&sinceSeconds=${secs}`, key: "blockedMessages" },
      { path: `/v2/siem/messages/delivered?format=json&sinceSeconds=${secs}`, key: "deliveredMessages" },
      { path: `/v2/siem/clicks/permitted?format=json&sinceSeconds=${secs}`, key: "permittedClicks" },
      { path: `/v2/siem/clicks/blocked?format=json&sinceSeconds=${secs}`, key: "blockedClicks" },
      { path: `/v2/siem/issues?format=json&sinceSeconds=${secs}`, key: "issues" },
    ];
    for (const r of siemTypes) {
      try {
        const res = await fetch(`${this.baseUrl(cfg)}${r.path}`, {
          headers: { Authorization: this.authHeader(cfg) },
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as any;
        const items = data?.messages || data?.clicks || data?.queryEndTime ? [data] : [];
        result.recordsProcessed += Array.isArray(items) ? items.length : 0;
        (result as any)[r.key] = items;
      } catch (e: any) { result.errors.push(`${r.path}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
