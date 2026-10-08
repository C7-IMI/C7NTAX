import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * Proofpoint TAP adapter (Threat Protection — SIEM API).
 *
 * API: https://help.proofpoint.com/Threat_Insight_Dashboard/API_Documentation/SIEM_API
 *
 * Auth is HTTP Basic with the service principal and its password — the previous version sent those
 * as `x-api-key`/`x-api-secret`, which the SIEM API does not read, so it 401'd on every call.
 *
 * Two response details also matter. First, the SIEM endpoints answer with a **named array per
 * endpoint** (`messagesBlocked`, `messagesDelivered`, `clicksPermitted`, `clicksBlocked`, `issues`)
 * rather than a shared `data` key, so a generic reader finds nothing and syncs zero records even on a
 * 200. Second, `sinceSeconds` is capped at **one hour** by the API: a larger window is rejected
 * outright, so a day of history has to be taken in hourly slices.
 */
export class ProofpointAdapter implements IIntegrationAdapter {
  readonly kind = "proofpoint" as const;

  private readonly baseUrl = "https://tap-api-v2.proofpoint.com";

  /** The maximum window the SIEM API accepts, in seconds. */
  private readonly maxWindowSeconds = 3600;

  private readonly endpoints: Array<{ path: string; key: string; responseKey: string }> = [
    { path: "/v2/siem/messages/blocked", key: "blockedMessages", responseKey: "messagesBlocked" },
    { path: "/v2/siem/messages/delivered", key: "deliveredMessages", responseKey: "messagesDelivered" },
    { path: "/v2/siem/clicks/permitted", key: "permittedClicks", responseKey: "clicksPermitted" },
    { path: "/v2/siem/clicks/blocked", key: "blockedClicks", responseKey: "clicksBlocked" },
    { path: "/v2/siem/issues", key: "issues", responseKey: "issues" },
  ];

  private headers(cfg: IntegrationConfig): Record<string, string> {
    const principal = (cfg.credentials.principal || cfg.credentials.servicePrincipal || "").trim();
    const secret = (cfg.credentials.secret || cfg.credentials.password || "").trim();
    if (!principal || !secret) throw new Error("A Proofpoint TAP service principal and password are required.");
    return {
      authorization: `Basic ${Buffer.from(`${principal}:${secret}`).toString("base64")}`,
      accept: "application/json",
    };
  }

  private async call(cfg: IntegrationConfig, path: string, sinceSeconds: number): Promise<any> {
    const url = `${this.baseUrl}${path}?format=json&sinceSeconds=${sinceSeconds}`;
    const res = await fetch(url, { headers: this.headers(cfg) });
    const text = await res.text().catch(() => "");
    let parsed: any = {};
    try { parsed = JSON.parse(text); } catch { /* TAP answers with a plain-text reason on some failures */ }

    if (!res.ok) {
      const detail = parsed?.message ?? text.slice(0, 200);
      throw new Error(`Proofpoint ${path}: HTTP ${res.status}${detail ? ` — ${detail}` : ""}`);
    }
    return parsed;
  }

  /** Take the lookback window in hour-sized slices, because the API refuses anything longer. */
  private async fetchWindow(cfg: IntegrationConfig, path: string, responseKey: string, days: number): Promise<any[]> {
    const out: any[] = [];
    let remaining = Math.max(1, days) * 86_400;
    while (remaining > 0) {
      const window = Math.min(remaining, this.maxWindowSeconds);
      const parsed = await this.call(cfg, path, window);
      const items = Array.isArray(parsed?.[responseKey]) ? parsed[responseKey] : [];
      out.push(...items);
      remaining -= window;
    }
    return out;
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      // A one-second window is the cheapest valid request the SIEM API accepts.
      await this.call(cfg, "/v2/siem/issues", 1);
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "proofpoint", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const days = Math.min(Math.max(Number(cfg.settings?.lookbackDays ?? 1) || 1, 1), 7);

    for (const { path, key, responseKey } of this.endpoints) {
      try {
        const items = await this.fetchWindow(cfg, path, responseKey, days);
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
