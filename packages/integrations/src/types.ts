// ─── Integration Base Types ──────────────────────────────────────────

export type IntegrationKind =
  | "flexpoint"
  | "quickbooks"
  | "pax8"
  | "avanan"
  | "proofpoint"
  | "sentinelone"
  | "itglue"
  | "microsoft365"
  | "azure"
  | "aws";

export interface IntegrationConfig {
  id: string;
  kind: IntegrationKind;
  name: string;
  enabled: boolean;
  credentials: Record<string, string>;
  settings: Record<string, unknown>;
  lastSyncAt: Date | null;
  status: "connected" | "error" | "disconnected";
  errorMessage?: string;
}

export interface SyncResult {
  success: boolean;
  kind: IntegrationKind;
  recordsProcessed: number;
  errors: string[];
  syncedAt: Date;
}
