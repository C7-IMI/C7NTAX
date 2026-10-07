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
  evaluateExpression,
  type CatalogSource, type ExpressionContext, type ReportTemplateDocument, type SubreportElement, type TemplateIssue,
} from "@C7NTAX/shared";
import { prisma } from "../index";
import { runReportConfig, describeReportCatalog, type ReportConfig, type ReportSource } from "./reportRunner";

export interface TemplateValidation {
  issues: TemplateIssue[];
  errors: TemplateIssue[];
  document: ReportTemplateDocument;
}

/** What the validator and the designer's picker need to know about a saved designed report. */
export interface TemplateRef {
  id: string;
  name: string;
  parameters: Array<{ key: string; label: string; required: boolean }>;
}

/**
 * Reading every saved template on each keystroke would be wasteful, but a stale list would offer a
 * report that no longer exists, so the list is cached for a few seconds and dropped whenever a report
 * is written through this service's own route.
 */
const TEMPLATE_CACHE_MS = 10_000;
let templateCache: { at: number; refs: TemplateRef[] } | null = null;

export function invalidateTemplateCache(): void {
  templateCache = null;
}

export async function listTemplateRefs(): Promise<TemplateRef[]> {
  if (templateCache && Date.now() - templateCache.at < TEMPLATE_CACHE_MS) return templateCache.refs;
  const reports = await prisma.report.findMany({
    where: { type: "template" },
    select: { id: true, name: true, config: true },
    orderBy: { name: "asc" },
  });
  const refs: TemplateRef[] = reports.map(report => ({
    id: report.id,
    name: report.name,
    parameters: normaliseDocument((report.config as { document?: unknown } | null)?.document, report.name).parameters
      .map(parameter => ({ key: parameter.key, label: parameter.label, required: parameter.required })),
  }));
  templateCache = { at: Date.now(), refs };
  return refs;
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
export function validateDocument(raw: unknown, name = "Untitled report", templates?: TemplateRef[]): TemplateValidation {
  const document = normaliseDocument(raw, name);
  const issues = validateTemplate(document, { catalog: catalogForValidation(), templates });
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
  /** The sub-reports this document prints, keyed by the template id its elements point at. */
  subreports: Record<string, SubreportResolution>;
}

/** A sub-report, resolved for the run: what to print, from which rows, with which parameters. */
export interface SubreportResolution {
  document: unknown;
  rows: Array<Record<string, unknown>>;
  parameters: Record<string, unknown>;
  name?: string;
}

/** A sub-report prints inside its parent, so a chain of them is bounded rather than unbounded. */
export const MAX_SUBREPORT_DEPTH = 3;

/**
 * Works out the values a sub-report's parameters should take. Bindings are evaluated **once**, in the
 * parent's own parameter context, before the child's rows are fetched — which is why a binding cannot
 * read a row: the child's query has to happen before there is a row to read.
 */
export function bindParameters(
  document: ReportTemplateDocument,
  bindings: Record<string, string>,
  parentParameters: Record<string, unknown>,
): Record<string, unknown> {
  const context: ExpressionContext = { fields: {}, parameters: parentParameters, report: {}, page: {}, group: null };
  const bound: Record<string, unknown> = {};
  for (const parameter of document.parameters) {
    const expression = bindings[parameter.key];
    if (!expression || !expression.trim()) continue;
    try {
      bound[parameter.key] = evaluateExpression(expression, context);
    } catch {
      // A binding that cannot be worked out leaves the parameter to its own default, which the child's
      // own validation then reports if it is required.
    }
  }
  return bound;
}

/**
 * Resolves every sub-report a document prints, and every sub-report those print in turn. The child's
 * rows are fetched once, with the parameters its parent bound, so a sub-report is a query and not a
 * query per parent row.
 */
export async function resolveSubreports(
  document: ReportTemplateDocument,
  parameters: Record<string, unknown>,
  options: { clientId?: string | null; stack?: string[]; depth?: number } = {},
): Promise<{ subreports: Record<string, SubreportResolution>; notes: string[] }> {
  const stack = options.stack ?? [];
  const depth = options.depth ?? 0;
  const notes: string[] = [];
  const subreports: Record<string, SubreportResolution> = {};

  const wanted = new Map<string, SubreportElement>();
  for (const band of document.bands) {
    for (const element of band.elements) {
      if (element.type === "subreport" && element.templateId) wanted.set(element.templateId, element);
    }
  }
  if (!wanted.size) return { subreports, notes };

  const reports = await prisma.report.findMany({ where: { id: { in: [...wanted.keys()] } } });
  const byId = new Map(reports.map(report => [report.id, report]));

  for (const [id, element] of wanted) {
    const label = element.templateName || byId.get(id)?.name || id;
    const report = byId.get(id);
    if (!report || report.type !== "template") {
      notes.push(`The sub-report "${label}" was not printed because it is not a saved designed report any more.`);
      continue;
    }
    if (stack.includes(id)) {
      notes.push(`The sub-report "${report.name}" was not printed because it would print itself.`);
      continue;
    }
    if (depth >= MAX_SUBREPORT_DEPTH) {
      notes.push(`The sub-report "${report.name}" was not printed: sub-reports nest at most ${MAX_SUBREPORT_DEPTH} deep.`);
      continue;
    }

    const childDocument = normaliseDocument((report.config as { document?: unknown } | null)?.document, report.name);
    const childParameters = bindParameters(childDocument, element.parameterBindings, parameters);
    const child = await runTemplateDocument(childDocument, {
      name: report.name,
      parameters: childParameters,
      clientId: options.clientId,
      depth: depth + 1,
      stack: [...stack, id],
    });
    if (child.validation.errors.length) {
      notes.push(`The sub-report "${report.name}" was not printed because it has ${child.validation.errors.length} problem${child.validation.errors.length === 1 ? "" : "s"} of its own: ${child.validation.errors[0]!.message}`);
      continue;
    }

    subreports[id] = {
      document: child.validation.document,
      rows: child.rows,
      parameters: child.parameters,
      name: report.name,
    };
    // Anything the child prints in turn travels under the same lookup, because the engine reads one map.
    Object.assign(subreports, child.subreports);
    notes.push(...child.notes.filter(note => /sub-report/i.test(note)));
  }

  return { subreports, notes };
}

/** Validates, plans and runs a document's data source in one step. Errors stop it before any query. */
export async function runTemplateDocument(
  raw: unknown,
  options: {
    name?: string;
    parameters?: Record<string, unknown>;
    clientId?: string | null;
    /** Depth and ancestry of sub-reports, so a self-printing report is refused rather than looped. */
    depth?: number;
    stack?: string[];
    /** The report being run, so a sub-report pointing back at it is caught at the first level. */
    reportId?: string;
  } = {},
): Promise<TemplateRun> {
  const templates = await listTemplateRefs();
  const validation = validateDocument(raw, options.name, templates);
  const parameters = resolveParameters(validation.document, options.parameters);
  const empty = { rows: [], columns: [], truncated: false, limit: 0, notes: [], parameters, validation, subreports: {} };

  if (validation.errors.length) return empty;

  for (const parameter of validation.document.parameters) {
    if (parameter.required && (parameters[parameter.key] === "" || parameters[parameter.key] === undefined)) {
      validation.issues.push({
        severity: "error", code: "parameter.required", path: `parameters.${parameter.key}`,
        message: `This report needs "${parameter.label || parameter.key}" before it can be generated.`,
      });
    }
  }
  // The array taken before the parameter check would not know about these, and the caller reads it.
  validation.errors = errorsOf(validation.issues);
  if (validation.errors.length) return empty;

  const plan = planDataSource(validation.document, parameters);
  const source = (plan.config.source ?? "tickets") as ReportSource;
  const scope = scopeForSource(source, options.clientId);
  if (plan.config.filters?.some(filter => filter.field === "ticket") && "ticket" in scope) {
    plan.notes.push("The template's own filter on the ticket was replaced by your client restriction.");
  }

  const [result, resolved] = await Promise.all([
    runReportConfig(plan.config, scope),
    resolveSubreports(validation.document, parameters, {
      clientId: options.clientId,
      depth: options.depth,
      // The report being run is part of the ancestry, so "this report prints itself" is caught before any
      // query rather than one level down.
      stack: options.stack ?? (options.reportId ? [options.reportId] : []),
    }),
  ]);
  return {
    rows: result.rows,
    columns: result.columns,
    truncated: result.truncated,
    limit: result.limit ?? (Number(plan.config.limit) || 200),
    notes: [...plan.notes, ...result.notes, ...resolved.notes],
    parameters,
    validation,
    subreports: resolved.subreports,
  };
}

export { DOCUMENT_VERSION };
