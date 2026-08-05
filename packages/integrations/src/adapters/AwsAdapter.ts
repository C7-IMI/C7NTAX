import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * AWS adapter.
 * Syncs EC2 instances, CloudWatch alarms, Security Hub findings, and Cost Explorer data.
 * API: AWS SDK (stubbed with SigV4 REST calls).
 */
export class AwsAdapter implements IIntegrationAdapter {
  readonly kind = "aws" as const;

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      // Lightweight check — call STS GetCallerIdentity
      const res = await fetch("https://sts.amazonaws.com/?Action=GetCallerIdentity&Version=2011-06-15", {
        headers: {
          Authorization: `AWS4-HMAC-SHA256 Credential=${cfg.credentials.accessKeyId}/...`,
          "X-Amz-Date": new Date().toISOString().replace(/[-:]/g, "").split(".")[0] + "Z",
        },
      });
      return res.ok;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "aws", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    try {
      // In production this would use @aws-sdk/* packages.
      // Stub: log intent and return placeholder.
      console.log(`[AWS] Syncing resources for account ${cfg.credentials.accountId || "default"}`);
      result.recordsProcessed = 0; // Real impl uses SDK paginators
    } catch (e) { result.errors.push(String(e)); result.success = false; }
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
