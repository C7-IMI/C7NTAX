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
 *
 * The same whitelist is what the custom report **designer** (PLAN-020) reads: `describeReportCatalog`
 * publishes the sources, their fields and their operators, so a template is written against exactly
 * the fields this runner will accept — not against a second list that could drift from it.
 */
import { prisma } from "../index";
import { labelFor } from "@C7NTAX/shared";

export type ReportSource = "tickets" | "invoices" | "time_entries" | "expenses" | "assets" | "contacts" | "companies";

/** The kind of value a column holds, so the designer can pick a format and an alignment for it. */
export type ReportFieldType = "text" | "number" | "money" | "minutes" | "date" | "boolean";

interface FieldSpec {
  /** A field on the model, safe to select and filter. */
  field: string;
  /** What the runner uses when the config asks for a relation's value (e.g. a client name). */
  select?: Record<string, unknown>;
  label?: string;
  type?: ReportFieldType;
  /**
   * The column can hold no value. Only `isNull` and `isNotNull` care, and Prisma refuses a null filter
   * on a column that cannot be null — so this decides which of those two operators is sent, and a
   * column left unmarked is treated as required. Marking it wrongly the safe way round (required when
   * it is not) costs an empty result and a note; the other way round is a 500.
   */
  nullable?: boolean;
  /** The column is a relation, which null-filters as `is: null` rather than `= null`. */
  relation?: boolean;
  /**
   * Turns a selected relation into the single value a report wants to print. A user is
   * `{ firstName, lastName }`, which has no one obvious value, so a column that presents a person
   * flattens it here rather than making every expression do it.
   */
  flatten?: (value: unknown) => unknown;
}

const personName = (value: unknown): unknown => {
  if (!value || typeof value !== "object") return value;
  const person = value as { firstName?: unknown; lastName?: unknown };
  const name = [person.firstName, person.lastName].filter(part => typeof part === "string" && part).join(" ");
  return name || null;
};

const SOURCES: Record<ReportSource, { model: string; label: string; fields: Record<string, FieldSpec>; defaultSort: string; include?: Record<string, unknown> }> = {
  tickets: {
    model: "ticket",
    label: "Tickets",
    defaultSort: "createdAt",
    include: { company: { select: { name: true } } },
    fields: {
      ticketNumber: { field: "ticketNumber", type: "text" },
      title: { field: "title", type: "text" },
      status: { field: "status", type: "text" },
      priority: { field: "priority", type: "text" },
      source: { field: "source", type: "text" },
      createdAt: { field: "createdAt", type: "date" },
      updatedAt: { field: "updatedAt", type: "date" },
      dueDate: { field: "dueDate", type: "date", nullable: true },
      firstResponseAt: { field: "firstResponseAt", type: "date", nullable: true },
      resolvedAt: { field: "resolvedAt", type: "date", nullable: true },
      closedAt: { field: "closedAt", type: "date", nullable: true },
      isOverdue: { field: "isOverdue", type: "boolean" },
      client: { field: "company", select: { name: true }, type: "text", relation: true },
      board: { field: "board", select: { name: true }, type: "text", relation: true },
      category: { field: "category", select: { name: true }, type: "text", nullable: true, relation: true },
      assignee: { field: "assignedTo", select: { firstName: true, lastName: true }, flatten: personName, type: "text", nullable: true, relation: true },
      contact: { field: "contact", select: { firstName: true, lastName: true }, flatten: personName, type: "text", nullable: true, relation: true },
    },
  },
  invoices: {
    model: "invoice",
    label: "Invoices",
    defaultSort: "issueDate",
    include: { company: { select: { name: true } } },
    fields: {
      invoiceNumber: { field: "invoiceNumber", type: "text" },
      status: { field: "status", type: "text" },
      currency: { field: "currency", type: "text" },
      issueDate: { field: "issueDate", type: "date" },
      dueDate: { field: "dueDate", type: "date" },
      paidAt: { field: "paidAt", type: "date", nullable: true },
      subtotal: { field: "subtotal", type: "money" },
      taxTotal: { field: "taxTotal", type: "money" },
      total: { field: "total", type: "money" },
      client: { field: "company", select: { name: true }, type: "text", relation: true },
    },
  },
  time_entries: {
    model: "timeEntry",
    label: "Time entries",
    defaultSort: "date",
    include: { ticket: { select: { ticketNumber: true } } },
    fields: {
      date: { field: "date", type: "date" },
      minutes: { field: "minutes", type: "minutes" },
      billedMinutes: { field: "billedMinutes", type: "minutes", nullable: true },
      overtimeMinutes: { field: "overtimeMinutes", type: "minutes" },
      billable: { field: "billable", type: "boolean" },
      noCharge: { field: "noCharge", type: "boolean" },
      rate: { field: "rate", type: "money", nullable: true },
      description: { field: "description", type: "text", nullable: true },
      workType: { field: "workType", type: "text", nullable: true },
      technician: { field: "user", select: { firstName: true, lastName: true }, flatten: personName, type: "text", relation: true },
      ticket: { field: "ticket", select: { ticketNumber: true }, type: "text", relation: true },
      invoice: { field: "invoice", select: { invoiceNumber: true }, type: "text", nullable: true, relation: true },
    },
  },
  expenses: {
    model: "expense",
    label: "Expenses",
    defaultSort: "expenseDate",
    fields: {
      description: { field: "description", type: "text" },
      amount: { field: "amount", type: "money" },
      category: { field: "category", type: "text" },
      vendor: { field: "vendor", type: "text", nullable: true },
      status: { field: "status", type: "text" },
      expenseDate: { field: "expenseDate", type: "date" },
      miles: { field: "miles", type: "number", nullable: true },
      syncedAt: { field: "syncedAt", type: "date", nullable: true },
    },
  },
  assets: {
    model: "asset",
    label: "Assets",
    defaultSort: "createdAt",
    fields: {
      name: { field: "name", type: "text" },
      assetTag: { field: "assetTag", type: "text" },
      type: { field: "type", type: "text" },
      status: { field: "status", type: "text" },
      createdAt: { field: "createdAt", type: "date" },
    },
  },
  contacts: {
    model: "contact",
    label: "Contacts",
    defaultSort: "lastName",
    fields: {
      firstName: { field: "firstName", type: "text" },
      lastName: { field: "lastName", type: "text" },
      email: { field: "email", type: "text", nullable: true },
      phone: { field: "phone", type: "text", nullable: true },
      title: { field: "title", type: "text", nullable: true },
      createdAt: { field: "createdAt", type: "date" },
    },
  },
  companies: {
    model: "company",
    label: "Clients",
    defaultSort: "name",
    fields: {
      name: { field: "name", type: "text" },
      city: { field: "city", type: "text", nullable: true },
      state: { field: "state", type: "text", nullable: true },
      industry: { field: "industry", type: "text", nullable: true },
      isActive: { field: "isActive", type: "boolean" },
      createdAt: { field: "createdAt", type: "date" },
    },
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
  /** The row ceiling the run was given, so the caller can say what it stopped at. */
  limit?: number;
}

/**
 * Builds a Prisma `where` from the config's filters, ignoring anything not whitelisted.
 *
 * The two null operators need care that the rest do not. Prisma refuses a null filter on a column that
 * cannot be null (`Argument must not be null`) and refuses `not` on a relation, so `isNull` and
 * `isNotNull` are translated per field rather than emitted as a value — a report that asks "which
 * tickets have no resolution date" must not become a 500 because the column it named is required.
 */
function buildWhere(source: ReportSource, config: ReportConfig, notes: string[]): { where: Record<string, unknown>; empty: boolean } {
  const spec = SOURCES[source];
  const where: Record<string, unknown> = {};
  let empty = false;
  for (const filter of config.filters ?? []) {
    const column = filter.field ? spec.fields[filter.field] : undefined;
    if (!column) { notes.push(`ignored filter on unknown field "${filter.field}"`); continue; }
    const op = (filter.op ?? "equals") as Operator;
    if (!OPERATORS.includes(op)) { notes.push(`ignored filter with unknown operator "${filter.op}"`); continue; }
    const value = filter.value;

    if (op === "isNull" || op === "isNotNull") {
      if (!column.nullable) {
        // Every row already satisfies "is not null", and none satisfies "is null":
        notes.push(`${filter.field} cannot be empty, so the "${op === "isNull" ? "is empty" : "is not empty"}" filter was simplified`);
        if (op === "isNull") empty = true;
        continue;
      }
      where[column.field] = column.relation
        ? (op === "isNull" ? { is: null } : { isNot: null })
        : (op === "isNull" ? null : { not: null });
      continue;
    }

    const condition =
      op === "equals" ? coerce(value)
      : op === "notEquals" ? { not: coerce(value) }
      : op === "contains" ? { contains: String(value ?? ""), mode: "insensitive" }
      : op === "startsWith" ? { startsWith: String(value ?? ""), mode: "insensitive" }
      : op === "in" ? { in: Array.isArray(value) ? value.map(coerce) : [coerce(value)] }
      : op === "gte" ? { gte: coerce(value) }
      : op === "lte" ? { lte: coerce(value) }
      : { gte: coerce(Array.isArray(value) ? value[0] : undefined), lte: coerce(Array.isArray(value) ? value[1] : undefined) };
    where[column.field] = condition;
  }
  return { where, empty };
}

/** Dates arrive as strings; numbers as strings if somebody typed them in a form. */
function coerce(value: unknown): unknown {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return new Date(value);
  return value;
}

export interface CatalogField { key: string; label: string; type: ReportFieldType; nullable: boolean; relation: boolean; filterable: boolean }
export interface ReportCatalog {
  sources: Array<{ key: ReportSource; label: string; defaultSort: string; fields: CatalogField[] }>;
  operators: Array<{ key: Operator; label: string; valueKind: "none" | "text" | "number" | "date" | "list" | "pair" }>;
}

const OPERATOR_LABELS: Record<Operator, { label: string; valueKind: "none" | "text" | "number" | "date" | "list" | "pair" }> = {
  equals: { label: "is", valueKind: "text" },
  notEquals: { label: "is not", valueKind: "text" },
  contains: { label: "contains", valueKind: "text" },
  startsWith: { label: "starts with", valueKind: "text" },
  in: { label: "is one of", valueKind: "list" },
  gte: { label: "on or after", valueKind: "date" },
  lte: { label: "on or before", valueKind: "date" },
  between: { label: "between", valueKind: "pair" },
  isNull: { label: "is empty", valueKind: "none" },
  isNotNull: { label: "is not empty", valueKind: "none" },
};

/**
 * Everything the designer is allowed to know about the data it can report on: this list is the
 * whitelist itself rather than a copy of it, so a template cannot name a field this runner would
 * refuse, and adding a field here makes it available to every designer without a second change.
 */
export function describeReportCatalog(): ReportCatalog {
  return {
    sources: (Object.keys(SOURCES) as ReportSource[]).map(key => {
      const spec = SOURCES[key];
      return {
        key,
        label: spec.label,
        defaultSort: spec.defaultSort,
        fields: Object.entries(spec.fields).map(([fieldKey, field]) => ({
          key: fieldKey,
          label: field.label ?? labelFor(fieldKey),
          type: field.type ?? "text",
          // Whether a column can be empty decides whether "is empty" is even a question worth asking.
          nullable: field.nullable ?? false,
          relation: field.relation ?? false,
          filterable: true,
        })),
      };
    }),
    operators: OPERATORS.map(key => ({ key, ...OPERATOR_LABELS[key] })),
  };
}

/** The source keys, for validating a document's data source before it is run. */
export function reportSourceKeys(): ReportSource[] {
  return Object.keys(SOURCES) as ReportSource[];
}

/** Runs a stored report config. `scope` is the caller's client restriction and is never optional. */
export async function runReportConfig(config: ReportConfig, scope: Record<string, unknown> = {}): Promise<ReportRunResult> {
  const notes: string[] = [];
  const source = (config.source ?? "tickets") as ReportSource;
  const spec = SOURCES[source];
  if (!spec) throw Object.assign(new Error(`Unknown report source "${config.source}"`), { status: 400 });

  const requested = (config.columns ?? []).map(c => String(c));
  const columns = requested.length ? requested.filter(c => c in spec.fields) : Object.keys(spec.fields);
  const droppedColumns = requested.filter(c => !(c in spec.fields));
  if (droppedColumns.length) notes.push(`ignored unknown column(s): ${droppedColumns.join(", ")}`);

  const built = buildWhere(source, config, notes);
  const where = { ...built.where, ...scope };
  if (built.empty) {
    // A filter that nothing can satisfy — "the resolution date is empty" on a required column — is
    // answered without a query, which is both correct and cheaper than a query that returns nothing.
    return { source, columns, rows: [], truncated: false, notes, limit: Math.min(Math.max(Number(config.limit) || 200, 1), 2000) };
  }

  // Prisma's `select` is keyed by the real field or relation name, so a column that presents
  // itself as "client" is selected as `company` and renamed back on the way out.
  const select: Record<string, unknown> = {};
  const keyToColumn = new Map<string, string>();
  const flatteners = new Map<string, (value: unknown) => unknown>();
  for (const column of columns) {
    const field = spec.fields[column];
    if (!field) continue;
    select[field.field] = field.select ? { select: field.select } : true;
    keyToColumn.set(field.field, column);
    if (field.flatten) flatteners.set(column, field.flatten);
  }

  const sortField = config.sortBy ? spec.fields[config.sortBy] : undefined;
  const sortBy = sortField ? sortField.field : spec.defaultSort;
  const sortDir = config.sortDir === "asc" ? "asc" : "desc";
  const limit = Math.min(Math.max(Number(config.limit) || 200, 1), 2000);

  const model = (prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<Record<string, unknown>[]> } | undefined>)[spec.model];
  if (!model) throw Object.assign(new Error(`Report source "${source}" is not runnable`), { status: 400 });
  const rows = await model.findMany({
    where,
    select,
    orderBy: { [sortBy]: sortDir },
    take: limit + 1,
  });

  const truncated = rows.length > limit;
  const page = truncated ? rows.slice(0, limit) : rows;
  const renamed = page.map(row =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => {
      const column = keyToColumn.get(key) ?? key;
      const flatten = flatteners.get(column);
      return [column, flatten ? flatten(value) : value];
    })),
  );

  // `groupBy` is a rollup of the selected rows rather than a second query: grouping in the
  // database would need the column list to be known at compile time, and a report's row count
  // is bounded anyway.
  if (config.groupBy) {
    const key = config.groupBy;
    const field = key in spec.fields ? spec.fields[key] : undefined;
    if (!field) {
      notes.push(`ignored unknown groupBy "${key}"`);
    } else {
      const counts = new Map<string, number>();
      for (const row of renamed) {
        const value = row[key];
        const label = value === null || value === undefined ? "(none)" : String(typeof value === "object" ? JSON.stringify(value) : value);
        counts.set(label, (counts.get(label) ?? 0) + 1);
      }
      const grouped = [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ [key]: value, count }));
      return { source, columns: [key, "count"], rows: grouped, truncated: false, notes, limit };
    }
  }

  return { source, columns, rows: renamed, truncated, notes, limit };
}
