import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Flexpoint Payment Solutions adapter.
 * Handles payment processing, tokenized card storage, and ACH transfers.
 * API: REST JSON over HTTPS.
 */
export class FlexpointAdapter implements IIntegrationAdapter {
  readonly kind = "flexpoint" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/api/v1/ping`, {
        headers: { Authorization: `Bearer ${cfg.credentials.apiKey}` },
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = {
      success: true, kind: "flexpoint", recordsProcessed: 0, errors: [], syncedAt: new Date(),
    };
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/api/v1/transactions?since=${cfg.lastSyncAt?.toISOString() || ""}`, {
        headers: { Authorization: `Bearer ${cfg.credentials.apiKey}` },
      });
      if (!res.ok) { result.errors.push(`HTTP ${res.status}`); result.success = false; return result; }
      const data = (await res.json()) as { transactions?: unknown[] };
      result.recordsProcessed = data.transactions?.length ?? 0;
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> { /* no-op */ }
}
