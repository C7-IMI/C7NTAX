import type { IntegrationConfig, SyncResult } from "./types";

/**
 * Each integration adapter implements this interface.
 * The IntegrationHub calls these methods uniformly regardless of backend.
 */
export interface IIntegrationAdapter {
  readonly kind: IntegrationConfig["kind"];
  validateCredentials(config: IntegrationConfig): Promise<boolean>;
  sync(config: IntegrationConfig): Promise<SyncResult>;
  testConnection(config: IntegrationConfig): Promise<boolean>;
  disconnect(config: IntegrationConfig): Promise<void>;
}
