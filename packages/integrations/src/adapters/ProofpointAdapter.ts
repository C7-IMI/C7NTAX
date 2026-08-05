import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/** Proofpoint email security adapter — syncs threat data and quarantine events. */
export class ProofpointAdapter implements IIntegrationAdapter {
  readonly kind = "proofpoint" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/v2/siem/all?format=json&sinceSeconds=60`, {
        headers: { Authorization: `Basic ${Buffer.from(`${cfg.credentials.principal}:${cfg.credentials.secret}`).toString("base64")}` },
      });
      return res.ok || res.status === 404; // empty response is still valid
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "proofpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const types = ["messages/blocked", "messages/delivered", "clicks/permitted"];
      for (const t of types) {
        const res = await fetch(`${cfg.settings.baseUrl}/v2/siem/${t}?format=json&sinceSeconds=${cfg.lastSyncAt ? Math.floor((Date.now() - cfg.lastSyncAt.getTime()) / 1000) : 86400}`, {
          headers: { Authorization: `Basic ${Buffer.from(`${cfg.credentials.principal}:${cfg.credentials.secret}`).toString("base64")}` },
        });
        if (res.ok) {
          const data = (await res.json()) as { queryEndTime?: string; messages?: unknown[] };
          result.recordsProcessed += data.messages?.length ?? 0;
        } else { result.errors.push(`${t}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
