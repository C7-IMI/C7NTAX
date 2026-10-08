/**
 * The console's catalogue: which commands exist, what each one costs, and which route it runs.
 *
 * **This is data, not code, and that is the point.** The in-app console parses and completes from
 * this module in the browser; the API serves the same module to the CLI so there is one list and not
 * two (PLAN-028 §6). Nothing here imports a client, a database or a React hook, because the API
 * imports it too.
 *
 * **Where the catalogue comes from, today.** PLAN-028 §7 says the catalogue is a projection of
 * PLAN-026's action manifest, and that *writes* must wait for it — a hand-written write command is
 * the one thing that section refuses, because it becomes a second, drifting authorization list. The
 * manifest does not exist yet, so this file contains **the read commands only** (`kind: "read"`, one
 * `GET` each), which §7 explicitly blesses as buildable now. Every command's path and permission were
 * taken from the routes themselves, and `scripts/check-console-catalog.mjs` (`pnpm guard:console`)
 * fails the build if a path stops resolving to a real route, a permission stops existing, or a flag
 * stops being read by the route that would have to honour it. When PLAN-026 Phase 1 lands, the write
 * commands arrive from the manifest and this file keeps the reads.
 */
import { InvoiceStatus, Permission, TicketPriority, TicketStatus } from "../enums";

export type ConsoleGroupId =
  | "basics"
  | "session"
  | "tickets"
  | "boards"
  | "work"
  | "clients"
  | "billing"
  | "stock"
  | "kumo"
  | "knowledge"
  | "reporting"
  | "monitoring"
  | "ai"
  | "integrations"
  | "administration"
  | "system";

/**
 * Groups in the order an MSP's day runs, and every command belongs to exactly one — `guard:console`
 * fails on a command whose group is not in this list, so a section of `help` cannot silently vanish.
 */
export const CONSOLE_GROUPS: readonly { id: ConsoleGroupId; label: string; summary: string }[] = [
  { id: "basics", label: "Console basics", summary: "The console's own verbs — help, history, aliases, context." },
  { id: "session", label: "Session", summary: "Who you are signed in as, and what you may do." },
  { id: "tickets", label: "Tickets", summary: "The service desk: the queue, one ticket, its contacts and its costs." },
  { id: "boards", label: "Boards", summary: "Service boards, their metrics, layout and connected sources." },
  { id: "work", label: "Work", summary: "Projects, the schedule, checklists and leave." },
  { id: "clients", label: "Clients", summary: "Clients, their contacts, agreements and the pipeline." },
  { id: "billing", label: "Billing", summary: "Invoices, agreements, payments, time, expenses, quotes and contracts." },
  { id: "stock", label: "Stock", summary: "Assets and inventory, products, vendors and purchase orders." },
  { id: "kumo", label: "Documentation", summary: "Kumo: organizations, assets, passwords and documents." },
  { id: "knowledge", label: "Knowledge", summary: "The knowledge base, chat sessions and surveys." },
  { id: "reporting", label: "Reporting", summary: "Saved reports, the standard series and their options." },
  { id: "monitoring", label: "Monitoring", summary: "Alerts, their rules, service health and webhooks." },
  { id: "ai", label: "AI", summary: "Inference connections, the model catalogue, tools and AI actions." },
  { id: "integrations", label: "Integrations", summary: "Connections, their sync state, mail connectors and FlexPoint." },
  { id: "administration", label: "Administration", summary: "Users, roles and API keys." },
  { id: "system", label: "System", summary: "Audit trail, configuration, the poller, versions and workflows." },
];

/** A live source of record values, for completing `--client`, `--assignee` and their relatives. */
export type ConsoleValueSourceId =
  | "clients"
  | "contacts"
  | "users"
  | "boards"
  | "tickets"
  | "assets"
  | "connections";

export interface ConsoleValueSource {
  /** The route that lists these records. */
  path: string;
  /** Query parameter that filters it server-side, when the route has one. */
  searchParam?: string;
  /** Field holding the value a flag needs — usually an id, sometimes a name. */
  valueField: string;
  /** Fields shown beside each candidate, in order. */
  displayFields: readonly string[];
  /** What one of these is called, for the completion menu. */
  label: string;
}

/**
 * Where completion gets real records. Each entry names a route the caller can already read, so
 * completion cannot reveal anything the console itself could not: the list it completes from is the
 * list `ticket list` would print.
 */
export const CONSOLE_VALUE_SOURCES: Record<ConsoleValueSourceId, ConsoleValueSource> = {
  clients: { path: "/clients", searchParam: "search", valueField: "id", displayFields: ["name", "shortName"], label: "client" },
  contacts: { path: "/clients/contacts", searchParam: "search", valueField: "id", displayFields: ["firstName", "lastName", "email"], label: "contact" },
  users: { path: "/users", searchParam: "search", valueField: "id", displayFields: ["firstName", "lastName", "email"], label: "user" },
  boards: { path: "/boards", valueField: "id", displayFields: ["name", "type"], label: "board" },
  tickets: { path: "/tickets", searchParam: "search", valueField: "id", displayFields: ["ticketNumber", "title"], label: "ticket" },
  assets: { path: "/inventory/assets", searchParam: "search", valueField: "id", displayFields: ["name", "assetTag"], label: "asset" },
  connections: { path: "/cloudconnect", valueField: "id", displayFields: ["name", "type"], label: "connection" },
};

export interface ConsoleFlagSpec {
  /** Without the leading dashes. */
  name: string;
  help: string;
  type: "string" | "number" | "boolean";
  /** The closed set of values, when it is closed — completed locally, instantly. */
  values?: readonly string[];
  /** Or the live list to complete from. */
  from?: ConsoleValueSourceId;
  /** Query parameter, when it differs from the flag's own name. */
  query?: string;
  /** `me` is accepted and resolved to the signed-in user's id. */
  acceptsMe?: boolean;
}

/**
 * How a subject becomes a record.
 *
 * Without `lookup` the subject is passed to the route as-is — right for a slug (`kb show kb-1`) and
 * for an id. With `lookup` the console asks a list route what matches, and §5's rule applies: **one
 * match proceeds, several are an error with the candidates, none suggests the closest**. A console
 * that silently picks the first match is a console that writes to the wrong client, which is why this
 * is resolution rather than a convenience.
 */
export interface ConsoleSubjectSpec {
  /** Column heading in help: "TICKET", "CLIENT", "REPORT". */
  label: string;
  /** A subject is required unless the verb lists records. */
  required?: boolean;
  /** The closed set of subjects, when there is one (`report run ticket-aging`). */
  values?: readonly string[];
  lookup?: {
    path: string;
    searchParam?: string;
    /** Fields a typed subject is matched against; every word must appear. */
    match: readonly string[];
    /** Fields printed when a subject is ambiguous. */
    display: readonly string[];
    /** Field carrying the record's id once matched. */
    idField?: string;
  };
}

export interface ConsoleColumnSpec {
  header: string;
  /** Dotted path into a row. A missing value prints as empty rather than `undefined`. */
  path: string;
}

export interface ConsoleCommandSpec {
  /** `noun verb` — unique in the catalogue, and the name the CLI and the model will use. */
  name: string;
  noun: string;
  verb: string;
  group: ConsoleGroupId;
  /**
   * The permission the *route* requires, or `null` for a route that carries none (the caller's own
   * record, the changelog). The console checks nothing itself: it shows this in `help`, and the route
   * enforces it on the request.
   */
  permission: Permission | null;
  /** One line, shown by `help` and in the completion menu. */
  description: string;
  /** The API path, with `{subject}` replaced by the resolved subject. */
  path: string;
  /** Flags forwarded as query parameters, in the order they read best. */
  query?: readonly string[];
  subject?: ConsoleSubjectSpec;
  flags?: readonly ConsoleFlagSpec[];
  /** Columns for the default table, in order. Omitted means "show what the route returned". */
  columns?: readonly ConsoleColumnSpec[];
  /** Where the rows live in the response body. Default: the body, or its `data`. */
  rows?: string;
}

/**
 * The universal flags every command accepts (PLAN-028 §9).
 *
 * Two kinds, and the difference matters: `json`, `quiet` and `verbose` are the console's own and are
 * offered everywhere, while `limit` and `offset` are *route* parameters wearing a common name — so
 * they are offered only by a command whose route actually reads them. A universal flag that a route
 * silently ignores is exactly the failure mode a console must not have.
 */
export const CONSOLE_UNIVERSAL_FLAGS: readonly (ConsoleFlagSpec & { scope: "console" | "route" })[] = [
  { name: "limit", help: "Rows to return, where the route takes a limit.", type: "number", scope: "route" },
  { name: "offset", help: "Rows to skip, where the route takes an offset.", type: "number", scope: "route" },
  { name: "json", help: "Print the route's own response, unformatted.", type: "boolean", scope: "console" },
  { name: "quiet", help: "Print identifiers only, one per line.", type: "boolean", scope: "console" },
  { name: "verbose", help: "Show the method, path, permission and elapsed time.", type: "boolean", scope: "console" },
];

/** The console's own verbs: they run in the client and have no route behind them. */
export interface ConsoleOwnVerb {
  name: string;
  summary: string;
  usage?: string;
}

export const CONSOLE_OWN_VERBS: readonly ConsoleOwnVerb[] = [
  { name: "help", summary: "Every command you may run, or one of them: help ticket create", usage: "help [noun [verb]]" },
  { name: "context", summary: "Instance, who you are, how many commands you may run, and the build." },
  { name: "history", summary: "Lines you have run this session, or all of them with --all.", usage: "history [--all]" },
  { name: "alias", summary: "Shorten a noun or a whole command: alias t=ticket, alias oi=\"ticket list --status open\"", usage: "alias [word=expansion]" },
  { name: "unalias", summary: "Remove one: unalias t", usage: "unalias <word>" },
  { name: "clear", summary: "Clear the scrollback (Ctrl+L)." },
  { name: "version", summary: "The console's grammar version and the application's build." },
  { name: "exit", summary: "Close the console (Esc)." },
];

/** The verbs that exist in PLAN-028's vocabulary but need a manifest before they can be offered. */
export const CONSOLE_WRITE_VERBS: readonly string[] = [
  "create", "update", "delete", "archive", "restore", "assign", "status", "note", "comment",
  "time", "attach", "send", "approve", "reject", "sync", "test", "enable", "disable", "link", "reveal",
];

/** The report series the API can run by name — the subjects of `report run`. */
export const CONSOLE_REPORT_KEYS: readonly string[] = [
  "client-value", "contract-profitability", "csat", "m365-inactive-accounts", "monthly-business-review",
  "options", "quarterly-business-review", "revenue-summary", "sla-compliance", "technician-utilization",
  "ticket-aging", "ticket-volume", "time-tracking", "weekly-business-review",
];

const TICKET_STATUSES = Object.values(TicketStatus) as readonly string[];
const TICKET_PRIORITIES = Object.values(TicketPriority) as readonly string[];
const INVOICE_STATUSES = Object.values(InvoiceStatus) as readonly string[];

/**
 * Every command the console offers. Read commands only, in group order; the order within a group is
 * the order `help` prints, so it is written for reading rather than alphabetically.
 */
export const CONSOLE_COMMANDS: readonly ConsoleCommandSpec[] = [
  // ── Session ────────────────────────────────────────────────────────
  {
    name: "me show",
    noun: "me",
    verb: "show",
    group: "session",
    permission: null,
    description: "Who you are signed in as, with your permissions and preferences.",
    path: "/users/me",
    columns: [
      { header: "NAME", path: "firstName" }, { header: "LAST", path: "lastName" },
      { header: "EMAIL", path: "email" }, { header: "ROLE", path: "systemRole" },
    ],
  },

  // ── Tickets ────────────────────────────────────────────────────────
  {
    name: "ticket list",
    noun: "ticket",
    verb: "list",
    group: "tickets",
    permission: Permission.TicketView,
    description: "The ticket queue, filtered the way the Tickets screen filters it.",
    path: "/tickets",
    query: ["status", "priority", "boardId", "companyId", "assignedToId", "search", "limit", "offset"],
    flags: [
      { name: "status", help: "Ticket status.", type: "string", values: TICKET_STATUSES },
      { name: "priority", help: "Priority.", type: "string", values: TICKET_PRIORITIES },
      { name: "board", help: "Service board.", type: "string", from: "boards", query: "boardId" },
      { name: "client", help: "Client the ticket belongs to.", type: "string", from: "clients", query: "companyId" },
      { name: "assignee", help: "Assigned technician; `me` is you.", type: "string", from: "users", query: "assignedToId", acceptsMe: true },
      { name: "search", help: "Free text: number, title or client.", type: "string" },
    ],
    columns: [
      { header: "NUMBER", path: "ticketNumber" }, { header: "SUBJECT", path: "title" },
      { header: "STATUS", path: "status" }, { header: "PRIORITY", path: "priority" },
      { header: "CLIENT", path: "company.name" }, { header: "ASSIGNEE", path: "assignedTo.email" },
    ],
  },
  {
    name: "ticket show",
    noun: "ticket",
    verb: "show",
    group: "tickets",
    permission: Permission.TicketView,
    description: "One ticket in full, by number, id or a search.",
    path: "/tickets/{subject}",
    subject: {
      label: "TICKET", required: true,
      lookup: { path: "/tickets", searchParam: "search", match: ["ticketNumber", "id", "title"], display: ["ticketNumber", "title", "status"] },
    },
    columns: [
      { header: "NUMBER", path: "ticketNumber" }, { header: "SUBJECT", path: "title" },
      { header: "STATUS", path: "status" }, { header: "PRIORITY", path: "priority" },
      { header: "CLIENT", path: "company.name" }, { header: "ASSIGNEE", path: "assignedTo.email" },
      { header: "CREATED", path: "createdAt" }, { header: "UPDATED", path: "updatedAt" },
    ],
  },
  {
    name: "ticket contacts",
    noun: "ticket",
    verb: "contacts",
    group: "tickets",
    permission: Permission.TicketView,
    description: "The contacts attached to a ticket.",
    path: "/tickets/{subject}/contacts",
    subject: { label: "TICKET", required: true, lookup: { path: "/tickets", searchParam: "search", match: ["ticketNumber", "id", "title"], display: ["ticketNumber", "title"] } },
    columns: [
      { header: "NAME", path: "firstName" }, { header: "LAST", path: "lastName" },
      { header: "EMAIL", path: "email" }, { header: "PHONE", path: "phone" },
    ],
  },
  {
    name: "ticket expenses",
    noun: "ticket",
    verb: "expenses",
    group: "tickets",
    permission: Permission.TicketView,
    description: "Costs recorded against a ticket.",
    path: "/tickets/{subject}/expenses",
    subject: { label: "TICKET", required: true, lookup: { path: "/tickets", searchParam: "search", match: ["ticketNumber", "id", "title"], display: ["ticketNumber", "title"] } },
    columns: [
      { header: "DATE", path: "expenseDate" }, { header: "DESCRIPTION", path: "description" },
      { header: "AMOUNT", path: "amount" }, { header: "BILLABLE", path: "billable" },
    ],
  },

  // ── Boards ─────────────────────────────────────────────────────────
  {
    name: "board list",
    noun: "board",
    verb: "list",
    group: "boards",
    permission: Permission.BoardView,
    description: "Every service board.",
    path: "/boards",
    columns: [{ header: "NAME", path: "name" }, { header: "TYPE", path: "type" }, { header: "ACTIVE", path: "isActive" }],
  },
  {
    name: "board show",
    noun: "board",
    verb: "show",
    group: "boards",
    permission: Permission.BoardView,
    description: "One board, with its settings.",
    path: "/boards/{subject}",
    subject: { label: "BOARD", required: true, lookup: { path: "/boards", match: ["name", "id"], display: ["name", "type"] } },
    columns: [{ header: "NAME", path: "name" }, { header: "TYPE", path: "type" }, { header: "DESCRIPTION", path: "description" }],
  },
  {
    name: "board layout",
    noun: "board",
    verb: "layout",
    group: "boards",
    permission: Permission.BoardView,
    description: "How a board is laid out for the people who use it.",
    path: "/boards/{subject}/layout",
    subject: { label: "BOARD", required: true, lookup: { path: "/boards", match: ["name", "id"], display: ["name", "type"] } },
  },
  {
    name: "board metrics",
    noun: "board",
    verb: "metrics",
    group: "boards",
    permission: Permission.BoardView,
    description: "Board counts — open, overdue, by priority.",
    path: "/boards/metrics",
  },
  {
    name: "board connectors",
    noun: "board",
    verb: "connectors",
    group: "boards",
    permission: Permission.BoardView,
    description: "The connectors feeding a board, with their last sync.",
    path: "/boards/{subject}/connectors",
    subject: { label: "BOARD", required: true, lookup: { path: "/boards", match: ["name", "id"], display: ["name", "type"] } },
  },

  // ── Work ───────────────────────────────────────────────────────────
  {
    name: "project list",
    noun: "project",
    verb: "list",
    group: "work",
    permission: Permission.TicketView,
    description: "Projects, filtered by status or client.",
    path: "/projects",
    query: ["status", "companyId", "limit", "offset"],
    flags: [
      { name: "status", help: "Project status.", type: "string" },
      { name: "client", help: "Client the project belongs to.", type: "string", from: "clients", query: "companyId" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "STATUS", path: "status" },
      { header: "CLIENT", path: "company.name" }, { header: "DUE", path: "endDate" },
    ],
  },
  {
    name: "project show",
    noun: "project",
    verb: "show",
    group: "work",
    permission: Permission.TicketView,
    description: "One project, with its tickets and tasks.",
    path: "/projects/{subject}",
    subject: { label: "PROJECT", required: true, lookup: { path: "/projects", match: ["name", "id"], display: ["name", "status"] } },
  },
  {
    name: "schedule list",
    noun: "schedule",
    verb: "list",
    group: "work",
    permission: Permission.TicketView,
    description: "Scheduled work in a window.",
    path: "/schedule",
    query: ["userId", "from", "to", "limit"],
    flags: [
      { name: "user", help: "Technician; `me` is you.", type: "string", from: "users", query: "userId", acceptsMe: true },
      { name: "from", help: "Start of the window (ISO date).", type: "string" },
      { name: "to", help: "End of the window (ISO date).", type: "string" },
    ],
  },
  {
    name: "checklist list",
    noun: "checklist",
    verb: "list",
    group: "work",
    permission: Permission.TicketView,
    description: "Checklists, on tickets and standalone.",
    path: "/checklists",
  },
  {
    name: "checklist mine",
    noun: "checklist",
    verb: "mine",
    group: "work",
    permission: Permission.TicketView,
    description: "Checklist tasks assigned to you.",
    path: "/checklists/my-tasks",
  },
  {
    name: "pto list",
    noun: "pto",
    verb: "list",
    group: "work",
    permission: Permission.PTOView,
    description: "Your leave requests.",
    path: "/pto",
    query: ["status", "userId"],
    flags: [{ name: "status", help: "Request status.", type: "string" }],
  },
  {
    name: "pto all",
    noun: "pto",
    verb: "all",
    group: "work",
    permission: Permission.PTOApprove,
    description: "Every leave request, for approving.",
    path: "/pto/all",
  },
  {
    name: "pto holidays",
    noun: "pto",
    verb: "holidays",
    group: "work",
    permission: Permission.PTOView,
    description: "The holiday calendar.",
    path: "/pto/holidays",
    columns: [{ header: "DATE", path: "date" }, { header: "NAME", path: "name" }, { header: "REGION", path: "region" }],
  },

  // ── Clients ────────────────────────────────────────────────────────
  {
    name: "client list",
    noun: "client",
    verb: "list",
    group: "clients",
    permission: Permission.ClientView,
    description: "Clients, searchable by name, status and type.",
    path: "/clients",
    query: ["search", "status", "type", "industry", "territory", "sort", "limit", "offset"],
    flags: [
      { name: "search", help: "Free text: name, short name, domain.", type: "string" },
      { name: "status", help: "Client status, e.g. active.", type: "string" },
      { name: "type", help: "Client type, e.g. managed.", type: "string" },
      { name: "industry", help: "Industry.", type: "string" },
      { name: "sort", help: "Field to sort by.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "SHORT", path: "shortName" },
      { header: "STATUS", path: "status" }, { header: "TYPE", path: "type" },
    ],
  },
  {
    name: "client show",
    noun: "client",
    verb: "show",
    group: "clients",
    permission: Permission.ClientView,
    description: "One client, by name, short name or id.",
    path: "/clients/{subject}",
    subject: {
      label: "CLIENT", required: true,
      lookup: { path: "/clients", searchParam: "search", match: ["name", "shortName", "id"], display: ["name", "shortName", "status"] },
    },
    columns: [
      { header: "NAME", path: "name" }, { header: "SHORT", path: "shortName" },
      { header: "STATUS", path: "status" }, { header: "TYPE", path: "type" },
      { header: "PHONE", path: "phone" }, { header: "WEBSITE", path: "website" },
    ],
  },
  {
    name: "client contacts",
    noun: "client",
    verb: "contacts",
    group: "clients",
    permission: Permission.ContactView,
    description: "A client's contacts.",
    path: "/clients/{subject}/contacts",
    subject: {
      label: "CLIENT", required: true,
      lookup: { path: "/clients", searchParam: "search", match: ["name", "shortName", "id"], display: ["name", "shortName"] },
    },
    columns: [
      { header: "NAME", path: "firstName" }, { header: "LAST", path: "lastName" },
      { header: "EMAIL", path: "email" }, { header: "PHONE", path: "phone" },
    ],
  },
  {
    name: "client agreements",
    noun: "client",
    verb: "agreements",
    group: "clients",
    permission: Permission.ServiceAgreementView,
    description: "A client's service agreements.",
    path: "/clients/{subject}/agreements",
    subject: {
      label: "CLIENT", required: true,
      lookup: { path: "/clients", searchParam: "search", match: ["name", "shortName", "id"], display: ["name", "shortName"] },
    },
  },
  {
    name: "contact list",
    noun: "contact",
    verb: "list",
    group: "clients",
    permission: Permission.ContactView,
    description: "Contacts across every client, or one client's.",
    path: "/clients/contacts",
    query: ["search", "companyId", "limit", "offset"],
    flags: [
      { name: "search", help: "Free text: name or email.", type: "string" },
      { name: "client", help: "Limit to one client.", type: "string", from: "clients", query: "companyId" },
    ],
    columns: [
      { header: "NAME", path: "firstName" }, { header: "LAST", path: "lastName" },
      { header: "EMAIL", path: "email" }, { header: "CLIENT", path: "company.name" },
    ],
  },
  {
    name: "contact lookup",
    noun: "contact",
    verb: "lookup",
    group: "clients",
    permission: Permission.ContactView,
    description: "Find the contact behind an email address.",
    path: "/clients/contacts/lookup",
    query: ["email"],
    flags: [{ name: "email", help: "The address to look up.", type: "string" }],
  },
  {
    name: "opportunity list",
    noun: "opportunity",
    verb: "list",
    group: "clients",
    permission: Permission.TicketView,
    description: "The sales pipeline.",
    path: "/crm/opportunities",
    query: ["stage", "companyId", "limit", "offset"],
    flags: [
      { name: "stage", help: "Pipeline stage.", type: "string" },
      { name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "STAGE", path: "stage" },
      { header: "VALUE", path: "value" }, { header: "CLIENT", path: "company.name" },
    ],
  },

  // ── Billing ────────────────────────────────────────────────────────
  {
    name: "invoice list",
    noun: "invoice",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Invoices, filtered by client and status.",
    path: "/billing/invoices",
    query: ["companyId", "status", "limit", "offset"],
    flags: [
      { name: "client", help: "Client billed.", type: "string", from: "clients", query: "companyId" },
      { name: "status", help: "Invoice status.", type: "string", values: INVOICE_STATUSES },
    ],
    columns: [
      { header: "NUMBER", path: "invoiceNumber" }, { header: "CLIENT", path: "company.name" },
      { header: "STATUS", path: "status" }, { header: "TOTAL", path: "total" }, { header: "DUE", path: "dueDate" },
    ],
  },
  {
    name: "agreement list",
    noun: "agreement",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Service agreements.",
    path: "/billing/agreements",
    query: ["companyId", "status", "limit", "offset"],
    flags: [
      { name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" },
      { name: "status", help: "Agreement status.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "CLIENT", path: "company.name" },
      { header: "STATUS", path: "status" }, { header: "PERIOD", path: "billingPeriod" },
    ],
  },
  {
    name: "payment list",
    noun: "payment",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Payments received, newest first.",
    path: "/billing/payments",
    query: ["companyId", "limit", "offset"],
    flags: [{ name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" }],
    columns: [
      { header: "DATE", path: "paymentDate" }, { header: "AMOUNT", path: "amount" },
      { header: "METHOD", path: "method" }, { header: "CLIENT", path: "company.name" },
    ],
  },
  {
    name: "time list",
    noun: "time",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Time entries, billable and not.",
    path: "/billing/time-entries",
    query: ["companyId"],
    flags: [{ name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" }],
    columns: [
      { header: "DATE", path: "date" }, { header: "HOURS", path: "hours" },
      { header: "BILLABLE", path: "billable" }, { header: "TICKET", path: "ticket.ticketNumber" },
      { header: "USER", path: "user.email" },
    ],
  },
  {
    name: "expense list",
    noun: "expense",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Expenses, with their receipt state.",
    path: "/billing/expenses",
    query: ["companyId", "limit", "offset"],
    flags: [{ name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" }],
    columns: [
      { header: "DATE", path: "expenseDate" }, { header: "DESCRIPTION", path: "description" },
      { header: "AMOUNT", path: "amount" }, { header: "BILLABLE", path: "billable" },
    ],
  },
  {
    name: "billing revenue",
    noun: "billing",
    verb: "revenue",
    group: "billing",
    permission: Permission.BillingView,
    description: "Revenue by period.",
    path: "/billing/reports/revenue",
  },
  {
    name: "quote list",
    noun: "quote",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Quotes sent and pending.",
    path: "/quotes",
    query: ["companyId", "status"],
    flags: [
      { name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" },
      { name: "status", help: "Quote status.", type: "string" },
    ],
    columns: [
      { header: "NUMBER", path: "quoteNumber" }, { header: "CLIENT", path: "company.name" },
      { header: "STATUS", path: "status" }, { header: "TOTAL", path: "total" },
    ],
  },
  {
    name: "contract list",
    noun: "contract",
    verb: "list",
    group: "billing",
    permission: Permission.BillingView,
    description: "Contracts, filtered by status, client and type.",
    path: "/contracts",
    query: ["status", "companyId", "type", "limit", "offset"],
    flags: [
      { name: "status", help: "Contract status.", type: "string" },
      { name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" },
      { name: "type", help: "Contract type.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "CLIENT", path: "company.name" },
      { header: "STATUS", path: "status" }, { header: "END", path: "endDate" },
    ],
  },

  // ── Stock ──────────────────────────────────────────────────────────
  {
    name: "asset list",
    noun: "asset",
    verb: "list",
    group: "stock",
    permission: Permission.AssetView,
    description: "Assets at a client, or all of them.",
    path: "/inventory/assets",
    query: ["type", "status", "companyId", "search", "category", "limit", "offset"],
    flags: [
      { name: "type", help: "Asset type, e.g. laptop.", type: "string" },
      { name: "status", help: "Asset status.", type: "string" },
      { name: "client", help: "Client that owns it.", type: "string", from: "clients", query: "companyId" },
      { name: "search", help: "Free text: name, tag or serial.", type: "string" },
      { name: "category", help: "Category.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "TAG", path: "assetTag" },
      { header: "TYPE", path: "type" }, { header: "STATUS", path: "status" },
      { header: "CLIENT", path: "company.name" },
    ],
  },
  {
    name: "asset show",
    noun: "asset",
    verb: "show",
    group: "stock",
    permission: Permission.AssetView,
    description: "One asset, by name, tag or id.",
    path: "/inventory/assets/{subject}",
    subject: {
      label: "ASSET", required: true,
      lookup: { path: "/inventory/assets", searchParam: "search", match: ["name", "assetTag", "serialNumber", "id"], display: ["name", "assetTag", "type"] },
    },
  },
  {
    name: "product list",
    noun: "product",
    verb: "list",
    group: "stock",
    permission: Permission.ProductView,
    description: "The product catalogue, with stock levels.",
    path: "/products",
    query: ["type", "category", "search", "active", "lowStock", "limit", "offset"],
    flags: [
      { name: "type", help: "Product type.", type: "string" },
      { name: "category", help: "Category.", type: "string" },
      { name: "search", help: "Free text: name or SKU.", type: "string" },
      { name: "active", help: "Only active products.", type: "boolean" },
      { name: "low-stock", help: "Only products at or below their reorder point.", type: "boolean", query: "lowStock" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "SKU", path: "sku" },
      { header: "TYPE", path: "type" }, { header: "COST", path: "costPrice" }, { header: "PRICE", path: "sellPrice" },
    ],
  },
  {
    name: "vendor list",
    noun: "vendor",
    verb: "list",
    group: "stock",
    permission: Permission.BillingView,
    description: "Suppliers you buy from.",
    path: "/procurement/vendors",
  },
  {
    name: "order list",
    noun: "order",
    verb: "list",
    group: "stock",
    permission: Permission.BillingView,
    description: "Purchase orders.",
    path: "/procurement/orders",
    query: ["status", "vendorId", "limit", "offset"],
    flags: [
      { name: "status", help: "Order status.", type: "string" },
      { name: "vendor", help: "Vendor.", type: "string", query: "vendorId" },
    ],
  },

  // ── Documentation (Kumo) ───────────────────────────────────────────
  {
    name: "kumo organization list",
    noun: "kumo organization",
    verb: "list",
    group: "kumo",
    permission: Permission.KumoView,
    description: "Documented organizations, with their coverage.",
    path: "/kumo/organizations",
    query: ["search", "sort", "companyType", "limit", "offset"],
    flags: [
      { name: "search", help: "Free text: name or slug.", type: "string" },
      { name: "sort", help: "Field to sort by (default name).", type: "string" },
      { name: "type", help: "Organization type.", type: "string", query: "companyType" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "TYPE", path: "companyType" },
      { header: "ASSETS", path: "assetCount" }, { header: "PASSWORDS", path: "passwordCount" },
    ],
  },
  {
    name: "kumo organization show",
    noun: "kumo organization",
    verb: "show",
    group: "kumo",
    permission: Permission.KumoView,
    description: "One organization's documentation.",
    path: "/kumo/organizations/{subject}",
    subject: {
      label: "ORGANIZATION", required: true,
      lookup: { path: "/kumo/organizations", searchParam: "search", match: ["name", "slug", "id"], display: ["name", "companyType"] },
    },
  },
  {
    name: "kumo asset list",
    noun: "kumo asset",
    verb: "list",
    group: "kumo",
    permission: Permission.KumoAssetView,
    description: "Documented assets, by client or template.",
    path: "/kumo/assets",
    query: ["templateId", "companyId", "search", "limit", "offset"],
    flags: [
      { name: "template", help: "Asset template.", type: "string", query: "templateId" },
      { name: "client", help: "Client.", type: "string", from: "clients", query: "companyId" },
      { name: "search", help: "Free text: asset name.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "name" }, { header: "TEMPLATE", path: "template.name" },
      { header: "CLIENT", path: "company.name" }, { header: "UPDATED", path: "updatedAt" },
    ],
  },
  {
    name: "kumo password list",
    noun: "kumo password",
    verb: "list",
    group: "kumo",
    permission: Permission.KumoPasswordsView,
    description: "Stored credentials. Values are never printed by a list.",
    path: "/kumo/passwords",
  },
  {
    name: "kumo document list",
    noun: "kumo document",
    verb: "list",
    group: "kumo",
    permission: Permission.KumoDocumentView,
    description: "Documents and runbooks.",
    path: "/kumo/documents",
    query: ["folderId"],
    flags: [{ name: "folder", help: "Only this folder.", type: "string", query: "folderId" }],
    columns: [
      { header: "TITLE", path: "title" }, { header: "STATUS", path: "status" },
      { header: "UPDATED", path: "updatedAt" },
    ],
  },
  {
    name: "kumo dashboard",
    noun: "kumo dashboard",
    verb: "show",
    group: "kumo",
    permission: Permission.KumoView,
    description: "Documentation coverage across the estate.",
    path: "/kumo/dashboard",
  },

  // ── Knowledge ──────────────────────────────────────────────────────
  {
    name: "kb list",
    noun: "kb",
    verb: "list",
    group: "knowledge",
    permission: Permission.KBView,
    description: "Knowledge base articles.",
    path: "/kb",
    query: ["search", "categoryId", "status", "visibility", "limit", "offset"],
    flags: [
      { name: "search", help: "Free text: title or body.", type: "string" },
      { name: "category", help: "Category.", type: "string", query: "categoryId" },
      { name: "status", help: "Publication status.", type: "string" },
      { name: "visibility", help: "Who can read it.", type: "string" },
    ],
    columns: [
      { header: "TITLE", path: "title" }, { header: "SLUG", path: "slug" },
      { header: "STATUS", path: "status" }, { header: "UPDATED", path: "updatedAt" },
    ],
  },
  {
    name: "kb show",
    noun: "kb",
    verb: "show",
    group: "knowledge",
    permission: Permission.KBView,
    description: "One article, by slug.",
    path: "/kb/{subject}",
    subject: { label: "SLUG", required: true },
  },
  {
    name: "kb categories",
    noun: "kb",
    verb: "categories",
    group: "knowledge",
    permission: Permission.KBView,
    description: "The knowledge base's categories.",
    path: "/kb/categories",
    columns: [{ header: "NAME", path: "name" }, { header: "ARTICLES", path: "_count.articles" }],
  },
  {
    name: "chat list",
    noun: "chat",
    verb: "list",
    group: "knowledge",
    permission: Permission.ChatView,
    description: "Chat sessions.",
    path: "/chat/sessions",
    query: ["status"],
    flags: [{ name: "status", help: "Session status.", type: "string" }],
  },
  {
    name: "survey list",
    noun: "survey",
    verb: "list",
    group: "knowledge",
    permission: Permission.SurveyView,
    description: "Surveys and their response counts.",
    path: "/surveys",
  },

  // ── Reporting ──────────────────────────────────────────────────────
  {
    name: "report list",
    noun: "report",
    verb: "list",
    group: "reporting",
    permission: Permission.ReportView,
    description: "Saved reports.",
    path: "/reports",
    columns: [
      { header: "NAME", path: "name" }, { header: "SOURCE", path: "source" },
      { header: "UPDATED", path: "updatedAt" },
    ],
  },
  {
    name: "report run",
    noun: "report",
    verb: "run",
    group: "reporting",
    permission: Permission.ReportView,
    description: "Run one of the standard reports by name.",
    path: "/reports/data/{subject}",
    subject: { label: "REPORT", required: true, values: CONSOLE_REPORT_KEYS },
  },
  {
    name: "report saved",
    noun: "report",
    verb: "saved",
    group: "reporting",
    permission: Permission.ReportView,
    description: "Run a saved report by id.",
    path: "/reports/{subject}/run",
    subject: { label: "REPORT ID", required: true },
  },
  {
    name: "report options",
    noun: "report",
    verb: "options",
    group: "reporting",
    permission: Permission.ReportView,
    description: "Every standard report, and what each one can be filtered by.",
    path: "/reports/data/options",
  },

  // ── Monitoring ─────────────────────────────────────────────────────
  {
    name: "alert list",
    noun: "alert",
    verb: "list",
    group: "monitoring",
    permission: Permission.ServiceAlertView,
    description: "Active service alerts.",
    path: "/alerts",
  },
  {
    name: "alert rules",
    noun: "alert",
    verb: "rules",
    group: "monitoring",
    permission: Permission.ServiceAlertView,
    description: "The rules that raise alerts.",
    path: "/alerts/rules",
  },
  {
    name: "alert status",
    noun: "alert",
    verb: "status",
    group: "monitoring",
    permission: Permission.ServiceAlertView,
    description: "Current service health, provider by provider.",
    path: "/service-alerts/status",
  },
  {
    name: "alert services",
    noun: "alert",
    verb: "services",
    group: "monitoring",
    permission: Permission.ServiceAlertView,
    description: "The services being watched.",
    path: "/service-alerts/services",
  },
  {
    name: "alert webhooks",
    noun: "alert",
    verb: "webhooks",
    group: "monitoring",
    permission: Permission.SystemConfig,
    description: "Webhooks alerts are delivered to, and their recent deliveries.",
    path: "/alert-webhooks",
  },

  // ── AI ─────────────────────────────────────────────────────────────
  {
    name: "inference status",
    noun: "inference",
    verb: "status",
    group: "ai",
    permission: Permission.InferenceView,
    description: "Which model connections are configured and reachable.",
    path: "/inference/status",
  },
  {
    name: "inference providers",
    noun: "inference",
    verb: "providers",
    group: "ai",
    permission: Permission.InferenceView,
    description: "Connected model providers.",
    path: "/inference/providers",
  },
  {
    name: "inference tools",
    noun: "inference",
    verb: "tools",
    group: "ai",
    permission: Permission.InferenceView,
    description: "The tools a model may call in this application.",
    path: "/inference/tools",
  },
  {
    name: "inference patterns",
    noun: "inference",
    verb: "patterns",
    group: "ai",
    permission: Permission.InferenceView,
    description: "Recognised prompt patterns and what they map to.",
    path: "/inference/patterns",
  },
  {
    name: "ai action list",
    noun: "ai action",
    verb: "list",
    group: "ai",
    permission: Permission.InferenceView,
    description: "Actions proposed by the assistant, and their state.",
    path: "/ai-actions",
  },

  // ── Integrations ───────────────────────────────────────────────────
  {
    name: "connection list",
    noun: "connection",
    verb: "list",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "Every configured connection.",
    path: "/cloudconnect",
    columns: [
      { header: "NAME", path: "name" }, { header: "TYPE", path: "type" },
      { header: "STATUS", path: "status" }, { header: "LAST SYNC", path: "lastSyncAt" },
    ],
  },
  {
    name: "connection status",
    noun: "connection",
    verb: "status",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "Whether each connection is currently healthy.",
    path: "/cloudconnect/status",
  },
  {
    name: "connection types",
    noun: "connection",
    verb: "types",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "The connector types this build supports.",
    path: "/cloudconnect/types",
  },
  {
    name: "connection logs",
    noun: "connection",
    verb: "logs",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "A connection's sync history.",
    path: "/cloudconnect/{subject}/sync-logs",
    subject: { label: "CONNECTION", required: true, lookup: { path: "/cloudconnect", match: ["name", "type", "id"], display: ["name", "type"] } },
  },
  {
    name: "connection entities",
    noun: "connection",
    verb: "entities",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "What a connection has synchronised.",
    path: "/cloudconnect/{subject}/synced-entities",
    subject: { label: "CONNECTION", required: true, lookup: { path: "/cloudconnect", match: ["name", "type", "id"], display: ["name", "type"] } },
    query: ["entityType"],
    flags: [{ name: "entity-type", help: "Only one entity type.", type: "string", query: "entityType" }],
  },
  {
    name: "email connector list",
    noun: "email connector",
    verb: "list",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "Mailboxes the application reads.",
    path: "/email-connectors",
  },
  {
    name: "email connector status",
    noun: "email connector",
    verb: "status",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "One mail connector's state and last poll.",
    path: "/email-connectors/{subject}/status",
    subject: { label: "CONNECTOR", required: true, lookup: { path: "/email-connectors", match: ["address", "name", "id"], display: ["address", "provider"] } },
  },
  {
    name: "flexpoint invoices",
    noun: "flexpoint",
    verb: "invoices",
    group: "integrations",
    permission: Permission.IntegrationView,
    description: "Invoices as the accounting connection sees them.",
    path: "/flexpoint/invoices",
  },

  // ── Administration ─────────────────────────────────────────────────
  {
    name: "user list",
    noun: "user",
    verb: "list",
    group: "administration",
    permission: Permission.UserManage,
    description: "Staff accounts, filtered by role or status.",
    path: "/users",
    query: ["search", "role", "status", "limit", "offset"],
    flags: [
      { name: "search", help: "Free text: name or email.", type: "string" },
      { name: "role", help: "System role.", type: "string" },
      { name: "status", help: "Account status, e.g. active.", type: "string" },
    ],
    columns: [
      { header: "NAME", path: "firstName" }, { header: "LAST", path: "lastName" },
      { header: "EMAIL", path: "email" }, { header: "ROLE", path: "systemRole" }, { header: "ACTIVE", path: "isActive" },
    ],
  },
  {
    name: "user show",
    noun: "user",
    verb: "show",
    group: "administration",
    permission: Permission.UserManage,
    description: "One staff account, by email, name or id.",
    path: "/users/{subject}",
    subject: {
      label: "USER", required: true,
      lookup: { path: "/users", searchParam: "search", match: ["email", "firstName", "lastName", "id"], display: ["email", "firstName", "lastName"] },
    },
  },
  {
    name: "role list",
    noun: "role",
    verb: "list",
    group: "administration",
    permission: Permission.RoleManage,
    description: "Roles and their permissions.",
    path: "/roles",
    columns: [{ header: "NAME", path: "name" }, { header: "PERMISSIONS", path: "_count.permissions" }],
  },
  {
    name: "role show",
    noun: "role",
    verb: "show",
    group: "administration",
    permission: Permission.RoleManage,
    description: "One role and every permission it grants.",
    path: "/roles/{subject}",
    subject: { label: "ROLE", required: true, lookup: { path: "/roles", match: ["name", "id"], display: ["name"] } },
  },
  {
    name: "api key list",
    noun: "api key",
    verb: "list",
    group: "administration",
    permission: Permission.UserManage,
    description: "API keys, their scopes and their last use.",
    path: "/api-keys",
    query: ["includeRevoked"],
    flags: [{ name: "revoked", help: "Include revoked keys.", type: "boolean", query: "includeRevoked" }],
  },

  // ── System ─────────────────────────────────────────────────────────
  {
    name: "audit list",
    noun: "audit",
    verb: "list",
    group: "system",
    permission: null,
    description: "The audit trail, newest first.",
    path: "/system/audit-logs",
    query: ["entity", "entityId"],
    flags: [
      { name: "entity", help: "Entity type, e.g. Ticket.", type: "string" },
      { name: "entity-id", help: "One record, by id.", type: "string", query: "entityId" },
    ],
    columns: [
      { header: "WHEN", path: "createdAt" }, { header: "WHO", path: "userName" },
      { header: "ACTION", path: "action" }, { header: "ENTITY", path: "entity" },
    ],
  },
  {
    name: "system version",
    noun: "system",
    verb: "version",
    group: "system",
    permission: null,
    description: "The build this deployment is running.",
    path: "/system/version",
  },
  {
    name: "system whatsnew",
    noun: "system",
    verb: "whatsnew",
    group: "system",
    permission: null,
    description: "The release notes, newest first.",
    path: "/system/changelog",
  },
  {
    name: "system configs",
    noun: "system",
    verb: "configs",
    group: "system",
    permission: Permission.SystemConfig,
    description: "Every setting, its value and where the value came from.",
    path: "/system/configs",
  },
  {
    name: "system deployment",
    noun: "system",
    verb: "deployment",
    group: "system",
    permission: Permission.SystemConfig,
    description: "The deployment report: build, add-in, installers and their state.",
    path: "/system/deployment",
  },
  {
    name: "system poller",
    noun: "system",
    verb: "poller",
    group: "system",
    permission: Permission.SystemConfig,
    description: "The mail poller's retry count and recovery log.",
    path: "/system/poller/status",
  },
  {
    name: "workflow list",
    noun: "workflow",
    verb: "list",
    group: "system",
    permission: Permission.WorkflowView,
    description: "Automation rules and whether they are armed.",
    path: "/workflows/rules",
  },
  {
    name: "event list",
    noun: "event",
    verb: "list",
    group: "system",
    permission: Permission.TicketView,
    description: "Events received from connected systems.",
    path: "/events",
  },
  {
    name: "bulk show",
    noun: "bulk",
    verb: "show",
    group: "system",
    permission: Permission.TicketView,
    description: "A bulk operation's progress.",
    path: "/bulk/{subject}",
    subject: { label: "BULK ID", required: true },
  },
];

/** Every noun in the catalogue, longest first so `kumo password` wins over `kumo`. */
export const CONSOLE_NOUNS: readonly string[] = [
  ...new Set(CONSOLE_COMMANDS.map((c) => c.noun)),
].sort((a, b) => b.length - a.length || a.localeCompare(b));

/** Commands grouped for `help`, in `CONSOLE_GROUPS` order. */
export function commandsByGroup(
  commands: readonly ConsoleCommandSpec[] = CONSOLE_COMMANDS,
): { group: (typeof CONSOLE_GROUPS)[number]; commands: ConsoleCommandSpec[] }[] {
  return CONSOLE_GROUPS.map((group) => ({
    group,
    commands: commands.filter((c) => c.group === group.id),
  })).filter((entry) => entry.commands.length > 0);
}

/** The verbs a noun offers, in catalogue order. */
export function verbsFor(noun: string, commands: readonly ConsoleCommandSpec[] = CONSOLE_COMMANDS): string[] {
  return commands.filter((c) => c.noun === noun).map((c) => c.verb);
}

/** One command, by noun and verb. */
export function findCommand(
  noun: string,
  verb: string,
  commands: readonly ConsoleCommandSpec[] = CONSOLE_COMMANDS,
): ConsoleCommandSpec | undefined {
  return commands.find((c) => c.noun === noun && c.verb === verb);
}

/** The command named by a resolved subject position, e.g. `ticket show`. */
export function commandName(noun: string, verb: string): string {
  return `${noun} ${verb}`;
}

/**
 * Filter the catalogue to what a caller may run.
 *
 * A command whose route carries no permission is available to any signed-in caller — the caller's own
 * record and the release notes. Everything else needs the permission its route needs, and this filter
 * is a *courtesy*: the route checks again, because it is the only thing that can.
 */
export function permittedCommands(
  permissions: readonly string[],
  commands: readonly ConsoleCommandSpec[] = CONSOLE_COMMANDS,
): ConsoleCommandSpec[] {
  const held = new Set(permissions);
  return commands.filter((c) => c.permission === null || held.has(c.permission));
}

/** Does this caller hold the permission a command needs? */
export function mayRun(command: ConsoleCommandSpec, permissions: readonly string[]): boolean {
  return command.permission === null || permissions.includes(command.permission);
}

/**
 * Every flag a command accepts: its own, then the universal ones that apply to it.
 *
 * A route-backed universal flag (`limit`, `offset`) appears only when the command's `query` list
 * declares that parameter, so `board list --limit 5` cannot be typed at a route that would ignore the
 * limit. The console's own flags (`--json`, `--quiet`, `--verbose`) always apply, because they are
 * handled here and never forwarded.
 */
export function flagsFor(command: ConsoleCommandSpec): ConsoleFlagSpec[] {
  const own = command.flags ?? [];
  const ownNames = new Set(own.map((f) => f.name));
  const declared = new Set([...own.map((f) => f.name), ...(command.query ?? [])]);
  const universal = CONSOLE_UNIVERSAL_FLAGS.filter((flag) =>
    flag.scope === "console" ? !ownNames.has(flag.name) : declared.has(flag.name) && !ownNames.has(flag.name));
  return [...own, ...universal];
}

/**
 * One command as it crosses the wire.
 *
 * The catalogue is data, so this is a copy rather than a transformation — but a named one, so the
 * shape the API serves is stated in one place and a field added to a command has to be added here
 * deliberately rather than leaking out of whatever object happened to be in scope.
 */
export interface ConsoleCommandDescription {
  name: string;
  noun: string;
  verb: string;
  group: ConsoleGroupId;
  permission: Permission | null;
  description: string;
  /** The route this command runs, for `--verbose` and for the CLI's own help. */
  path: string;
  query?: readonly string[];
  subject?: ConsoleSubjectSpec;
  flags: readonly ConsoleFlagSpec[];
  columns?: readonly ConsoleColumnSpec[];
  rows?: string;
}

export function describeCommand(command: ConsoleCommandSpec): ConsoleCommandDescription {
  return {
    name: command.name,
    noun: command.noun,
    verb: command.verb,
    group: command.group,
    permission: command.permission,
    description: command.description,
    path: command.path,
    ...(command.query ? { query: command.query } : {}),
    ...(command.subject ? { subject: command.subject } : {}),
    flags: flagsFor(command),
    ...(command.columns ? { columns: command.columns } : {}),
    ...(command.rows ? { rows: command.rows } : {}),
  };
}
