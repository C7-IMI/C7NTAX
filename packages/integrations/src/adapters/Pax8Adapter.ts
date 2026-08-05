import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/** Pax8 cloud marketplace adapter — syncs product catalog, subscriptions, and usage. */
export class Pax8Adapter implements IIntegrationAdapter {
  readonly kind = "pax8" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const res = await fetch(`${cfg.settings.baseUrl}/v1/identity`, {
        headers: { Authorization: `Bearer ${cfg.credentials.apiKey}`, Accept: "application/json" },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "pax8", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      const endpoints = ["products", "subscriptions", "invoices"];
      for (const ep of endpoints) {
        const res = await fetch(`${cfg.settings.baseUrl}/v1/${ep}`, {
          headers: { Authorization: `Bearer ${cfg.credentials.apiKey}`, Accept: "application/json" },
        });
        if (res.ok) {
          const data = (await res.json()) as { content?: unknown[] };
          result.recordsProcessed += data.content?.length ?? 0;
        } else { result.errors.push(`${ep}: HTTP ${res.status}`); }
      }
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
