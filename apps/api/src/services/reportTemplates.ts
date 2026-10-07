/**
 * Template documents (PLAN-020).
 *
 * A designed report is a `Report` whose type is `template` and whose config holds a **document**: page
 * setup, data sources, parameters, groups and bands. This service is the API's half of it — it turns a
 * document into the whitelisted query the runner already understands, and it is the place where a
 * document is validated **again on render**, because a stored document is not trusted just because it
 * was stored once.
 *
 * Nothing here evaluates an expression: the layout engine does that in the browser, from the same
 * `@C7NTAX/shared` code this validates with. The two cannot disagree about what an expression means
 * because there is only one implementation of the language.
 */
import {
  DOCUMENT_VERSION, errorsOf, normaliseDocument, validateTemplate,
  type CatalogSource, type ReportTemplateDocument, type TemplateIssue,
} from "@C7NTAX/shared";
import { runReportConfig, describeReportCatalog, type ReportConfig, type ReportSource } from "./reportRunner";

export interface TemplateValidation {
  issues: TemplateIssue[];
  errors: TemplateIssue[];
  document: ReportTemplateDocument;
}

/** The catalog in the shape the validator wants, taken from the runner's own whitelist. */
export function catalogForValidation(): { sources: CatalogSource[] } {
  const catalog = describeReportCatalog();
  return {
    sources: catalog.sources.map(source => ({
      key: source.key,
      label: source.label,
      fields: source.fields.map(field => ({ key: field.key, label: field.label, type: field.type })),
    })),
  };
}

/** Normalises then validates, so every caller gets the same document the validator saw. */
export function validateDocument(raw: unknown, name = "Untitled report"): TemplateValidation {
  const document = normaliseDocument(raw, name);
  const issues = validateTemplate(document, { catalog: catalogForValidation() });
  return { issues, errors: errorsOf(issues), document };
}

/** Parameter values: supplied first, then the declared default, typed as the document says. */
export function resolveParameters(document: ReportTemplateDocument, supplied: Record<string, unknown> = {}): Record<string, unknown> {
  const resolved: Record<string, unknown> = {};
  for (const parameter of document.parameters) {
    const provided = supplied[parameter.key];
    let value: unknown = provided !== undefined && provided !== "" ? provided : parameter.defaultValue ?? "";
    if (value !== "" && value !== undefined) {
      if (parameter.type === "number") value = Number(value);
      else if (parameter.type === "boolean") value = value === true || value === "true" || value === "1";
      else value = String(value);
    }
    resolved[parameter.key] = value;
  }
  return resolved;
}

export interface DataSourcePlan {
  config: ReportConfig;
  notes: string[];
}

/**
 * The document's first data source as a runner config. A filter whose parameter has no value is left
 * out rather than sent as an empty string, because "everything" is what an unfilled filter means in a
 * report and `status = ''` is what it would otherwise become.
 */
export function planDataSource(document: ReportTemplateDocument, parameters: Record<string, unknown>): DataSourcePlan {
  const notes: string[] = [];
  const dataSource = document.dataSources[0];
  if (!dataSource) return { config: { source: "tickets", columns: [], filters: [], limit: 200 }, notes: ["This template declares no data source."] };

  const filters = dataSource.filters.flatMap(filter => {
    if (filter.parameterKey) {
      const value = parameters[filter.parameterKey];
      if (value === undefined || value === null || value === "") {
        notes.push(`The filter on ${filter.field} was skipped because "${filter.parameterKey}" has no value.`);
        return [];
      }
      return [{ field: filter.field, op: filter.op, value }];
    }
    if (filter.op !== "isNull" && filter.op !== "isNotNull" && (filter.value === undefined || filter.value === null || filter.value === "")) {
      notes.push(`The filter on ${filter.field} was skipped because it has no value.`);
      return [];
    }
    return [{ field: filter.field, op: filter.op, value: filter.value }];
  });

  return {
    config: {
      source: dataSource.source,
      columns: [],
      filters,
      sortBy: dataSource.sortBy,
      sortDir: dataSource.sortDir,
      limit: dataSource.limit,
    },
    notes,
  };
}

/**
 * The client restriction a run is given. A template can narrow what it asks for but never widen it:
 * this is merged *after* the document's own filters, so a client-scoped account cannot be talked out
 * of its scope by a filter inside a template.
 */
export function scopeForSource(source: ReportSource, clientId?: string | null): Record<string, unknown> {
  if (!clientId) return {};
  return source === "time_entries" ? { ticket: { companyId: clientId } } : { companyId: clientId };
}

export interface TemplateRun {
  rows: Array<Record<string, unknown>>;
  columns: string[];
  truncated: boolean;
  limit: number;
  notes: string[];
  parameters: Record<string, unknown>;
  validation: TemplateValidation;
}

/** Validates, plans and runs a document's data source in one step. Errors stop it before any query. */
export async function runTemplateDocument(
  raw: unknown,
  options: { name?: string; parameters?: Record<string, unknown>; clientId?: string | null } = {},
): Promise<TemplateRun> {
  const validation = validateDocument(raw, options.name);
  const parameters = resolveParameters(validation.document, options.parameters);

  if (validation.errors.length) {
    return { rows: [], columns: [], truncated: false, limit: 0, notes: [], parameters, validation };
  }

  for (const parameter of validation.document.parameters) {
    if (parameter.required && (parameters[parameter.key] === "" || parameters[parameter.key] === undefined)) {
      validation.issues.push({
        severity: "error", code: "parameter.required", path: `parameters.${parameter.key}`,
        message: `This report needs "${parameter.label || parameter.key}" before it can be generated.`,
      });
    }
  }
  if (errorsOf(validation.issues).length) {
    return { rows: [], columns: [], truncated: false, limit: 0, notes: [], parameters, validation };
  }

  const plan = planDataSource(validation.document, parameters);
  const source = (plan.config.source ?? "tickets") as ReportSource;
  const scope = scopeForSource(source, options.clientId);
  if (plan.config.filters?.some(filter => filter.field === "ticket") && "ticket" in scope) {
    plan.notes.push("The template's own filter on the ticket was replaced by your client restriction.");
  }

  const result = await runReportConfig(plan.config, scope);
  return {
    rows: result.rows,
    columns: result.columns,
    truncated: result.truncated,
    limit: result.limit ?? (Number(plan.config.limit) || 200),
    notes: [...plan.notes, ...result.notes],
    parameters,
    validation,
  };
}

export { DOCUMENT_VERSION };
