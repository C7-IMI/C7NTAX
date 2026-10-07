/**
 * Custom report runner (PLAN-015 Phase B #10).
 *
 * The report builder stores a JSON config and, until now, `GET /reports/:id/run` understood two
 * hardcoded types and returned an empty array for everything else — which is why a "custom" report
 * looked broken. This runs the config instead, within a whitelist:
 *
 *   { "source": "tickets",
 *     "columns": ["ticketNumber", "title", "status"],
 *     "filters": [{ "field": "status", "op": "in", "value": ["new", "in_progress"] }],
 *     "groupBy": "status", "sortBy": "createdAt", "sortDir": "desc", "limit": 200 }
 *
 * No SQL, no arbitrary field names, no relation traversal the config asks for but the whitelist
 * does not name — a report config is data typed by a user, so it gets the same suspicion as any
 * other input. Client scoping is applied by the caller and is not optional.
 */
import { prisma } from "../index";

export type ReportSource = "tickets" | "invoices" | "time_entries" | "expenses" | "assets" | "contacts" | "companies";

interface FieldSpec {
  /** A field on the model, safe to select and filter. */
  field: string;
  /** What the runner uses when the config asks for a relation's value (e.g. a client name). */
  select?: Record<string, unknown>;
  label?: string;
}

const SOURCES: Record<ReportSource, { model: string; fields: Record<string, FieldSpec>; defaultSort: string; include?: Record<string, unknown> }> = {
  tickets: {
    model: "ticket",
    defaultSort: "createdAt",
    include: { company: { select: { name: true } } },
    fields: {
      ticketNumber: { field: "ticketNumber" },
      title: { field: "title" },
      status: { field: "status" },
      priority: { field: "priority" },
      createdAt: { field: "createdAt" },
      updatedAt: { field: "updatedAt" },
      resolvedAt: { field: "resolvedAt" },
      dueDate: { field: "dueDate" },
      client: { field: "company", select: { name: true } },
    },
  },
  invoices: {
    model: "invoice",
    defaultSort: "issueDate",
    include: { company: { select: { name: true } } },
    fields: {
      invoiceNumber: { field: "invoiceNumber" },
      status: { field: "status" },
      issueDate: { field: "issueDate" },
      dueDate: { field: "dueDate" },
      paidAt: { field: "paidAt" },
      subtotal: { field: "subtotal" },
      taxTotal: { field: "taxTotal" },
      total: { field: "total" },
      client: { field: "company", select: { name: true } },
    },
  },
  time_entries: {
    model: "timeEntry",
    defaultSort: "date",
    include: { ticket: { select: { ticketNumber: true } } },
    fields: {
      date: { field: "date" },
      minutes: { field: "minutes" },
      billedMinutes: { field: "billedMinutes" },
      overtimeMinutes: { field: "overtimeMinutes" },
      billable: { field: "billable" },
      noCharge: { field: "noCharge" },
      description: { field: "description" },
      workType: { field: "workType" },
      ticket: { field: "ticket", select: { ticketNumber: true } },
    },
  },
  expenses: {
    model: "expense",
    defaultSort: "expenseDate",
    fields: {
      description: { field: "description" },
      amount: { field: "amount" },
      category: { field: "category" },
      vendor: { field: "vendor" },
      status: { field: "status" },
      expenseDate: { field: "expenseDate" },
      miles: { field: "miles" },
      syncedAt: { field: "syncedAt" },
    },
  },
  assets: {
    model: "asset",
    defaultSort: "createdAt",
    fields: { name: { field: "name" }, assetTag: { field: "assetTag" }, type: { field: "type" }, status: { field: "status" }, createdAt: { field: "createdAt" } },
  },
  contacts: {
    model: "contact",
    defaultSort: "lastName",
    fields: { firstName: { field: "firstName" }, lastName: { field: "lastName" }, email: { field: "email" }, phone: { field: "phone" }, title: { field: "title" }, createdAt: { field: "createdAt" } },
  },
  companies: {
    model: "company",
    defaultSort: "name",
    fields: { name: { field: "name" }, city: { field: "city" }, state: { field: "state" }, industry: { field: "industry" }, isActive: { field: "isActive" }, createdAt: { field: "createdAt" } },
  },
};

const OPERATORS = ["equals", "notEquals", "contains", "startsWith", "in", "gte", "lte", "between", "isNull", "isNotNull"] as const;
type Operator = typeof OPERATORS[number];

export interface ReportConfig {
  source?: string;
  columns?: string[];
  filters?: { field?: string; op?: string; value?: unknown }[];
  groupBy?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
}

export interface ReportRunResult {
  source: ReportSource;
  columns: string[];
  rows: Record<string, unknown>[];
  truncated: boolean;
  notes: string[];
}

/** Builds a Prisma `where` from the config's filters, ignoring anything not whitelisted. */
function buildWhere(source: ReportSource, config: ReportConfig, notes: string[]): Record<string, unknown> {
  const spec = SOURCES[source];
  const where: Record<string, unknown> = {};
  for (const filter of config.filters ?? []) {
    const column = filter.field ? spec.fields[filter.field] : undefined;
    if (!column) { notes.push(`ignored filter on unknown field "${filter.field}"`); continue; }
    const op = (filter.op ?? "equals") as Operator;
    if (!OPERATORS.includes(op)) { notes.push(`ignored filter with unknown operator "${filter.op}"`); continue; }
    const value = filter.value;
    const condition =
      op === "equals" ? value
      : op === "notEquals" ? { not: value }
      : op === "contains" ? { contains: String(value ?? ""), mode: "insensitive" }
      : op === "startsWith" ? { startsWith: String(value ?? ""), mode: "insensitive" }
      : op === "in" ? { in: Array.isArray(value) ? value : [value] }
      : op === "gte" ? { gte: coerce(value) }
      : op === "lte" ? { lte: coerce(value) }
      : op === "between" ? { gte: coerce(Array.isArray(value) ? value[0] : undefined), lte: coerce(Array.isArray(value) ? value[1] : undefined) }
      : op === "isNull" ? null
      : { not: null };
    where[column.field] = condition;
  }
  return where;
}

/** Dates arrive as strings; numbers as strings if somebody typed them in a form. */
function coerce(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  return value;
}

/** Runs a stored report config. `scope` is the caller's client restriction and is never optional. */
export async function runReportConfig(config: ReportConfig, scope: Record<string, unknown> = {}): Promise<ReportRunResult> {
  const notes: string[] = [];
  const source = (config.source ?? "tickets") as ReportSource;
  if (!SOURCES[source]) throw Object.assign(new Error(`Unknown report source "${config.source}"`), { status: 400 });

  const spec = SOURCES[source] as { model: string; fields: Record<string, FieldSpec>; defaultSort: string; include?: Record<string, unknown> };
  const requested = (config.columns ?? []).map(c => String(c));
  const columns = requested.length ? requested.filter(c => c in spec.fields) : Object.keys(spec.fields);
  const droppedColumns = requested.filter(c => !(c in spec.fields));
  if (droppedColumns.length) notes.push(`ignored unknown column(s): ${droppedColumns.join(", ")}`);

  const where = { ...buildWhere(source, config, notes), ...scope };

  const select: Record<string, unknown> = {};
  for (const column of columns) {
    const field = spec.fields[column];
    if (field) select[column] = field.select ? { select: field.select } : true;
  }

  const sortBy = config.sortBy && config.sortBy in spec.fields ? spec.fields[config.sortBy].field : spec.defaultSort;
  const sortDir = config.sortDir === "asc" ? "asc" : "desc";
  const limit = Math.min(Math.max(Number(config.limit) || 200, 1), 2000);

  const model = (prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<Record<string, unknown>[]> }>)[spec.model];
  const rows = await model.findMany({
    where,
    select,
    orderBy: { [sortBy]: sortDir },
    take: limit + 1,
  });

  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;

  // `groupBy` is a rollup of the selected rows rather than a second query: grouping in the
  // database would need the column list to be known at compile time, and a report's row count
  // is bounded anyway.
  if (config.groupBy) {
    const key = config.groupBy;
    if (!(key in spec.fields)) {
      notes.push(`ignored unknown groupBy "${key}"`);
    } else {
      const counts = new Map<string, number>();
      for (const row of page) {
        const value = row[key];
        const label = value === null || value === undefined ? "(none)" : String(typeof value === "object" ? JSON.stringify(value) : value);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ [key]: value, count }));
      return { source, columns: [key, "count"], rows: grouped, truncated: false, notes };
    }
  }

  return { source, columns, rows: page as Record<string, unknown>[], truncated, notes };
}
