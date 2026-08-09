import type { IIntegrationAdapter } from "../IAdapter";
import type { IntegrationConfig, SyncResult } from "../types";

/**
 * QuickBooks Online adapter.
 * API: https://developer.intuit.com
 * Auth: OAuth 2.0 Bearer token + realmId
 * Resources: invoices, payments, customers, accounts, vendors,
 *            items, purchaseOrders, bills, estimates
 */
export class QuickBooksAdapter implements IIntegrationAdapter {
  readonly kind = "quickbooks" as const;

  private baseUrl(cfg: IntegrationConfig): string {
    const realmId = cfg.credentials.realmId || "123";
    return `https://quickbooks.api.intuit.com/v3/company/${realmId}`;
  }

  private async query(cfg: IntegrationConfig, entity: string, lastSync?: Date): Promise<unknown[]> {
    const selectParts = this.entitySelects[entity] || ["*"];
    let query = `SELECT ${selectParts.join(", ")} FROM ${entity}`;
    if (lastSync) query += ` WHERE Metadata.LastUpdatedTime > '${lastSync.toISOString()}'`;
    query += " MAXRESULTS 200";

    const res = await fetch(`${this.baseUrl(cfg)}/query?query=${encodeURIComponent(query)}`, {
      headers: {
        Authorization: `Bearer ${cfg.credentials.accessToken}`,
        Accept: "application/json",
      },
    });
    if (!res.ok) throw new Error(`QuickBooks ${entity}: HTTP ${res.status}`);
    const data = (await res.json()) as any;
    const response = data?.QueryResponse || {};
    return response[entity] || [];
  }

  private entitySelects: Record<string, string[]> = {
    Invoice: ["Id", "DocNumber", "TxnDate", "DueDate", "TotalAmt", "Balance", "CustomerRef", "EmailStatus", "TxnStatus"],
    Payment: ["Id", "TxnDate", "TotalAmt", "CustomerRef", "UnappliedAmt"],
    Customer: ["Id", "DisplayName", "CompanyName", "PrimaryEmailAddr", "PrimaryPhone", "Balance", "Active"],
    Account: ["Id", "Name", "AccountType", "AcctNum", "CurrentBalance", "Active"],
    Vendor: ["Id", "DisplayName", "CompanyName", "PrimaryEmailAddr", "PrimaryPhone"],
    Item: ["Id", "Name", "Type", "UnitPrice", "QtyOnHand", "Active"],
    PurchaseOrder: ["Id", "DocNumber", "TxnDate", "TotalAmt", "VendorRef"],
    Bill: ["Id", "DocNumber", "TxnDate", "DueDate", "TotalAmt", "VendorRef", "Balance"],
    Estimate: ["Id", "DocNumber", "TxnDate", "TotalAmt", "CustomerRef", "TxnStatus"],
  };

  async validateCredentials(cfg: IntegrationConfig): Promise<boolean> {
    try {
      await this.query(cfg, "Account");
      return true;
    } catch { return false; }
  }

  async testConnection(cfg: IntegrationConfig): Promise<boolean> {
    return this.validateCredentials(cfg);
  }

  async sync(cfg: IntegrationConfig): Promise<SyncResult> {
    const result: SyncResult = { success: true, kind: "quickbooks", recordsProcessed: 0, errors: [], syncedAt: new Date() };
    const entities = ["Invoice", "Payment", "Customer", "Account", "Vendor", "Item", "PurchaseOrder", "Bill", "Estimate"];
    for (const entity of entities) {
      try {
        const items = await this.query(cfg, entity, cfg.lastSyncAt ?? undefined);
        result.recordsProcessed += items.length;
        (result as any)[entity.toLowerCase()] = items;
      } catch (e: any) { result.errors.push(`${entity}: ${e.message}`); }
    }
    result.success = result.errors.length === 0;
    return result;
  }

  async disconnect(_cfg: IntegrationConfig): Promise<void> {}
}
