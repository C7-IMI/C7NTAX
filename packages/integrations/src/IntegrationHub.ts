import type { IIntegrationAdapter } from "./IAdapter";
import type { IntegrationConfig, SyncResult, IntegrationKind } from "./types";

// Adapter imports
import { FlexpointAdapter } from "./adapters/FlexpointAdapter";
import { QuickBooksAdapter } from "./adapters/QuickBooksAdapter";
import { Pax8Adapter } from "./adapters/Pax8Adapter";
import { AvananAdapter } from "./adapters/AvananAdapter";
import { ProofpointAdapter } from "./adapters/ProofpointAdapter";
import { SentinelOneAdapter } from "./adapters/SentinelOneAdapter";
import { ITGlueAdapter } from "./adapters/ITGlueAdapter";
import { Microsoft365Adapter } from "./adapters/Microsoft365Adapter";
import { AzureAdapter } from "./adapters/AzureAdapter";
import { AwsAdapter } from "./adapters/AwsAdapter";
import { ConnectWiseAdapter } from "./adapters/ConnectWiseAdapter";
import { HaloPSAAdapter } from "./adapters/HaloPSAAdapter";
import { KantataAdapter } from "./adapters/KantataAdapter";
import { ScoroAdapter } from "./adapters/ScoroAdapter";
import { AutoTaskAdapter } from "./adapters/AutoTaskAdapter";
import { AzureADSSOAdapter } from "./adapters/AzureADSSOAdapter";

/**
 * IntegrationHub — central registry for all third-party integrations.
 * Each integration is an adapter implementing IIntegrationAdapter.
 * Add new integrations by creating a new adapter and registering it here.
 */
export class IntegrationHub {
  private adapters: Map<string, IIntegrationAdapter> = new Map();
  private configs: Map<string, IntegrationConfig> = new Map();

  constructor() {
    // Register all built-in adapters
    this.registerAdapter(new FlexpointAdapter());
    this.registerAdapter(new QuickBooksAdapter());
    this.registerAdapter(new Pax8Adapter());
    this.registerAdapter(new AvananAdapter());
    this.registerAdapter(new ProofpointAdapter());
    this.registerAdapter(new SentinelOneAdapter());
    this.registerAdapter(new ITGlueAdapter());
    this.registerAdapter(new Microsoft365Adapter());
    this.registerAdapter(new AzureAdapter());
    this.registerAdapter(new AwsAdapter());
    this.registerAdapter(new ConnectWiseAdapter());
    this.registerAdapter(new HaloPSAAdapter());
    this.registerAdapter(new KantataAdapter());
    this.registerAdapter(new ScoroAdapter());
    this.registerAdapter(new AutoTaskAdapter());
    this.registerAdapter(new AzureADSSOAdapter());
  }

  /** Register a new adapter (built-in or plugin-provided) */
  registerAdapter(adapter: IIntegrationAdapter): void {
    this.adapters.set(adapter.kind, adapter);
  }

  /** Get a registered adapter by kind */
  getAdapter(kind: IntegrationKind): IIntegrationAdapter | undefined {
    return this.adapters.get(kind);
  }

  /** List all available integration kinds */
  listAvailableIntegrations(): string[] {
    return Array.from(this.adapters.keys());
  }

  /** Add or update an integration config */
  upsertConfig(config: IntegrationConfig): void {
    this.configs.set(config.id, config);
  }

  /** Get an integration config by id */
  getConfig(id: string): IntegrationConfig | undefined {
    return this.configs.get(id);
  }

  /** List all configs (without credential secrets) */
  listConfigs(): Omit<IntegrationConfig, "credentials">[] {
    return Array.from(this.configs.values()).map(
      ({ credentials: _c, ...rest }) => rest
    );
  }

  /** Test connection for a configured integration */
  async testConnection(configId: string): Promise<boolean> {
    const config = this.configs.get(configId);
    if (!config) return false;
    const adapter = this.adapters.get(config.kind);
    if (!adapter) return false;
    return adapter.testConnection(config);
  }

  /** Validate credentials for a configured integration */
  async validateCredentials(configId: string): Promise<boolean> {
    const config = this.configs.get(configId);
    if (!config) return false;
    const adapter = this.adapters.get(config.kind);
    if (!adapter) return false;
    return adapter.validateCredentials(config);
  }

  /** Run sync for a specific integration */
  async sync(configId: string): Promise<SyncResult> {
    const config = this.configs.get(configId);
    if (!config) {
      return {
        success: false, kind: "flexpoint" as IntegrationKind,
        recordsProcessed: 0, errors: ["Config not found"], syncedAt: new Date(),
      };
    }
    const adapter = this.adapters.get(config.kind);
    if (!adapter) {
      return {
        success: false, kind: config.kind,
        recordsProcessed: 0, errors: ["No adapter for kind"], syncedAt: new Date(),
      };
    }
    const result = await adapter.sync(config);
    // Update lastSyncAt on success
    if (result.success) {
      config.lastSyncAt = new Date();
      config.status = "connected";
      this.configs.set(config.id, config);
    } else {
      config.status = "error";
      config.errorMessage = result.errors.join("; ");
      this.configs.set(config.id, config);
    }
    return result;
  }

  /** Run sync for all enabled integrations */
  async syncAll(): Promise<SyncResult[]> {
    const results: SyncResult[] = [];
    for (const config of this.configs.values()) {
      if (config.enabled) {
        results.push(await this.sync(config.id));
      }
    }
    return results;
  }

  /** Disconnect an integration */
  async disconnect(configId: string): Promise<void> {
    const config = this.configs.get(configId);
    if (!config) return;
    const adapter = this.adapters.get(config.kind);
    if (adapter) await adapter.disconnect(config);
    config.status = "disconnected";
    this.configs.set(config.id, config);
  }
}

// Re-export types
export type { IntegrationConfig, SyncResult, IntegrationKind } from "./types";
export type { IIntegrationAdapter } from "./IAdapter";
