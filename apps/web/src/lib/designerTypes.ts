/**
 * The designer's view of the API catalog (PLAN-020).
 *
 * The API publishes its whitelist — the sources it will query, the fields it will select, the operators
 * it will filter with, the functions the expression language implements, the bands and page sizes the
 * engine understands. The designer reads this rather than keeping its own list, so a field cannot be
 * offered unless a report can actually read it.
 */
import type { BandKind } from "@C7NTAX/shared";

export interface CatalogField { key: string; label: string; type: string; filterable: boolean }

export interface CatalogSource { key: string; label: string; defaultSort: string; fields: CatalogField[] }

export interface CatalogOperator { key: string; label: string; valueKind: "none" | "text" | "number" | "date" | "list" | "pair" }

export interface CatalogFunction {
  name: string;
  category: "Aggregate" | "Math" | "Text" | "Date" | "Logical" | "Format" | "Value";
  signature: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  pathArg?: boolean;
  scopeArg?: boolean;
}

export interface CatalogBandKind {
  kind: BandKind;
  label: string;
  help: string;
  singleton: boolean;
  needsGroup: boolean;
  repeats: boolean;
}

export interface DesignerCatalog {
  documentVersion: number;
  sources: CatalogSource[];
  operators: CatalogOperator[];
  functions: CatalogFunction[];
  bandKinds: CatalogBandKind[];
  elementTypes: Array<{ type: string; label: string; help: string }>;
  pageSizes: Array<{ key: string; label: string; width: number; height: number }>;
  formats: Array<{ key: string; label: string }>;
  aggregateScopes: string[];
  starters: Array<{ kind: string; label: string; help: string }>;
  branding: Array<{ key: string; label: string; path: string }>;
}

/** The run a preview produced: the rows the document's data source returned, and how they were got. */
export interface DesignerRun {
  document: unknown;
  columns: string[];
  rows: Array<Record<string, unknown>>;
  parameters: Record<string, unknown>;
  notes: string[];
  truncated: boolean;
  limit: number;
  period?: { label?: string };
}
