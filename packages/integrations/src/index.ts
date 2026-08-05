export { IntegrationHub } from "./IntegrationHub";
export type { IntegrationConfig, SyncResult, IntegrationKind } from "./types";
export type { IIntegrationAdapter } from "./IAdapter";

// Re-export individual adapters for direct use or extension
export { FlexpointAdapter } from "./adapters/FlexpointAdapter";
export { QuickBooksAdapter } from "./adapters/QuickBooksAdapter";
export { Pax8Adapter } from "./adapters/Pax8Adapter";
export { AvananAdapter } from "./adapters/AvananAdapter";
export { ProofpointAdapter } from "./adapters/ProofpointAdapter";
export { SentinelOneAdapter } from "./adapters/SentinelOneAdapter";
export { ITGlueAdapter } from "./adapters/ITGlueAdapter";
export { Microsoft365Adapter } from "./adapters/Microsoft365Adapter";
export { AzureAdapter } from "./adapters/AzureAdapter";
export { AwsAdapter } from "./adapters/AwsAdapter";
