import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";
import { signRequest, sigV4Clock } from "../sigv4";

/**
 * AWS adapter.
 *
 * APIs: https://docs.aws.amazon.com/STS/latest/APIReference/API_GetCallerIdentity.html
 *       https://docs.aws.amazon.com/AWSEC2/latest/APIReference/API_DescribeInstances.html
 *       https://docs.aws.amazon.com/organizations/latest/APIReference/API_ListAccounts.html
 *
 * Auth: an access key id and secret, signed with **SigV4** on every request. There is no bearer-token
 * form of the AWS API, so the signature is the authentication — which is why the previous version,
 * which sent an `Authorization` header with no signature in it, could never have worked.
 *
 * The connectivity test is `sts:GetCallerIdentity`, which the docs state needs **no permissions at
 * all** — so a 200 proves the credentials and the signature, and *any* error (including 403) means
 * the request was wrong rather than the identity. Treating 403 as success, as the previous version
 * did, reported a broken signature as a healthy connection.
 *
 * `ec2:DescribeInstances` and `organizations:ListAccounts` need permissions the IAM user must be
 * granted; without them those sections report the refusal and the rest of the sync still returns.
 */
export class AwsAdapter implements IIntegrationAdapter {
  readonly kind = "aws" as const;

  private region(cfg: IntegrationConfig): string {
    return ((cfg.credentials.region as string) || "us-east-1").trim();
  }

  /** One signed call, to a service endpoint, with the AWS query protocol. */
  private async call(cfg: IntegrationConfig, service: string, host: string, action: string, version: string, extra: Record<string, string> = {}): Promise<any> {
    const body = new URLSearchParams({ Action: action, Version: version, ...extra }).toString();
    const url = `https://${host}/`;
    const signed = signRequest({
      method: "POST",
      url,
      service,
      region: this.region(cfg),
      accessKeyId: cfg.credentials.accessKeyId || "",
      secretAccessKey: cfg.credentials.secretAccessKey || "",
      sessionToken: cfg.credentials.sessionToken || undefined,
      body,
      clock: sigV4Clock(),
    });

    const res = await fetch(url, { method: "POST", headers: signed.headers, body });
    const text = await res.text().catch(() => "");
    if (!res.ok) {
      // The error body is XML and says which of permission, signature or region is wrong.
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? "";
      const message = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] ?? text.slice(0, 160);
      throw new Error(`AWS ${action}: HTTP ${res.status}${code ? ` ${code}` : ""}${message ? ` — ${message}` : ""}`);
    }
    return text;
  }

  /** The query protocol answers XML; this pulls the handful of elements worth keeping. */
  private elements(xml: string, tag: string): Record<string, string>[] {
    const blocks = xml.match(new RegExp(`<${tag}>(.*?)</${tag}>`, "gs")) ?? [];
    return blocks.map(block => {
      const fields: Record<string, string> = {};
      for (const match of block.matchAll(/<([A-Za-z0-9_]+)>([^<]*)<\/\1>/g)) fields[match[1]!] = match[2]!;
      return fields;
    });
  }

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      const xml = await this.call(cfg, "sts", `sts.${this.region(cfg)}.amazonaws.com`, "GetCallerIdentity", "2011-06-15");
      return xml.includes("<Account>");
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "aws", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const region = this.region(cfg);

    // ── Accounts, when this key belongs to an organisation ────────────────────
    try {
      const xml = await this.call(cfg, "organizations", "organizations.us-east-1.amazonaws.com", "ListAccounts", "2020-08-10");
      const accounts = this.elements(xml, "Account");
      (result as any).accounts = accounts;
      result.recordsProcessed += accounts.length;
    } catch (e: any) {
      // Not being an organisation's management account is the normal answer here, not a failure.
      if (!/AWSOrganizationsNotInUseException|AccessDenied|SubscriptionRequiredException/.test(e.message)) {
        result.errors.push(`organizations:ListAccounts: ${e.message}`);
      }
    }

    // ── Instances, in this region ─────────────────────────────────────────────
    try {
      const xml = await this.call(cfg, "ec2", `ec2.${region}.amazonaws.com`, "DescribeInstances", "2016-11-15");
      const instances = this.elements(xml, "item")
        .filter(item => item.instanceId)
        .map(item => ({ id: item.instanceId, name: item.instanceId, state: item.instanceState ?? item.name ?? "", type: item.instanceType ?? "" }));
      (result as any).instances = instances;
      result.recordsProcessed += instances.length;
    } catch (e: any) {
      result.errors.push(`ec2:DescribeInstances: ${e.message}`);
    }

    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
