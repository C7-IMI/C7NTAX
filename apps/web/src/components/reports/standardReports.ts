/**
 * The standard reports (PLAN-020).
 *
 * Each report is a description of the data behind it (the endpoint and the filters that apply) and
 * a builder that turns that payload into sections. Nothing here fetches or formats for a specific
 * output — the kit renders, prints and exports whatever the builder returns, so the screen, the
 * print-out and the spreadsheet are the same report.
 *
 * The detail is deliberate: the old screen showed a generic key-value grid, so a report whose
 * payload was "statuses and counts" rendered as "3 items". Every report below names its own tables,
 * so the reader sees rows.
 */
import { ClipboardList, Timer, DollarSign, Users, UserMinus, Clock, CheckCircle, Calendar, TrendingUp, PieChart, Presentation } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { duration, money, number, type Section } from "./reportKit";

/** A payload straight off `/api/reports/data/...`; fields are read defensively. */
type Payload = Record<string, unknown>;

export interface ReportFilters {
  client?: boolean;
  board?: boolean;
  period?: boolean;
}

/**
 * A control that belongs to one report rather than to every report.
 *
 * The shared filter bar answers "which client, which board, which period" because every report has
 * those; a report like inactive Microsoft 365 accounts has questions of its own — how long counts as
 * inactive, whether to include accounts that are already disabled — and they are asked in the same
 * bar, next to the client, so the report reads as one set of choices rather than two.
 */
export interface ReportOption {
  key: string;
  label: string;
  /** `tenant` is a select filled from the connected tenants the options endpoint returns. */
  kind: "number" | "boolean" | "select" | "tenant";
  default: string | number | boolean;
  suffix?: string;
  hint?: string;
  choices?: Array<{ value: string; label: string }>;
}

export interface StandardReport {
  id: string;
  title: string;
  description: string;
  icon: LucideIcon;
  endpoint: string;
  filters: ReportFilters;
  /** Report-specific controls, rendered in the filter bar and sent with the filters. */
  options?: ReportOption[];
  /** True when the report brings its own period (a business review has periods rather than a range). */
  quarters?: boolean;
  /** The noun the cadence uses in a section title — "this week", "this month", "this quarter". */
  periodNoun?: string;
  /** What the cadence is, for the pack's own "how this was built" facts. */
  periodLabel?: string;
  build: (payload: Payload) => Section[];
}

const list = <T,>(value: unknown): T[] => (Array.isArray(value) ? (value as T[]) : []);
const record = (value: unknown): Payload => (value && typeof value === "object" ? (value as Payload) : {});
const text = (value: unknown, fallback = "—") => (value === null || value === undefined || value === "" ? fallback : String(value));
const num = (value: unknown) => Number(value ?? 0);

const toneFor = (pct: number | null | undefined, good = 90): "good" | "warn" | "bad" | "neutral" => {
  if (pct === null || pct === undefined) return "neutral";
  if (pct >= good) return "good";
  if (pct >= good * 0.75) return "warn";
  return "bad";
};

const OUTCOME_LABEL: Record<string, string> = {
  met: "Met",
  breached: "Answered late",
  missed: "Target passed, nothing recorded",
  awaiting: "Inside target",
};

// ═══════════════════════════════════════════════════════════════════
//  1. Ticket volume
// ═══════════════════════════════════════════════════════════════════

const ticketVolume: StandardReport = {
  id: "ticket-volume",
  title: "Ticket Volume",
  description: "Tickets by status, priority, board and assignee, with the trend and the oldest open work",
  icon: PieChart,
  endpoint: "/reports/data/ticket-volume",
  filters: { client: true, board: true, period: true },
  build: payload => {
    const averages = record(payload.averages);
    const quality = record(payload.dataQuality);
    const trend = list<Payload>(payload.trend);
    return [
      {
        kind: "kpis",
        title: "Volume",
        items: [
          { label: "Tickets", value: number(payload.total) },
          { label: "Open", value: number(payload.open), tone: "warn" },
          { label: "Resolved", value: number(payload.closed), tone: "good" },
          { label: "Backlog", value: `${number(payload.backlogPct)}%`, sub: `${number(payload.unassigned)} unassigned · ${number(payload.overdue)} overdue` },
        ],
      },
      { kind: "bars", title: "By status", rows: list<Payload>(payload.byStatus).map(r => ({ label: text(r.label), value: num(r.count) })) },
      { kind: "bars", title: "By priority", rows: list<Payload>(payload.byPriority).map(r => ({ label: text(r.label), value: num(r.count) })) },
      { kind: "bars", title: "By board", rows: list<Payload>(payload.byBoard).map(r => ({ label: text(r.label), value: num(r.count) })) },
      { kind: "bars", title: "By assignee", rows: list<Payload>(payload.byAssignee).map(r => ({ label: text(r.label), value: num(r.count) })) },
      {
        kind: "table",
        title: "Volume over time",
        columns: [
          { key: "period", label: "Period" },
          { key: "opened", label: "Opened", align: "right" },
          { key: "closed", label: "Resolved", align: "right" },
          { key: "net", label: "Net", align: "right" },
        ],
        rows: trend.map(t => ({ period: text(t.period), opened: num(t.opened), closed: num(t.closed), net: num(t.opened) - num(t.closed) })),
      },
      {
        kind: "table",
        title: "Busiest clients",
        columns: [
          { key: "client", label: "Client" },
          { key: "count", label: "Tickets", align: "right" },
          { key: "share", label: "Share", align: "right", format: "percent" },
        ],
        rows: list<Payload>(payload.byClient).map(r => ({ client: text(r.label), count: num(r.count), share: num(payload.total) ? Math.round((num(r.count) / num(payload.total)) * 1000) / 10 : 0 })),
      },
      {
        kind: "table",
        title: "Oldest open tickets",
        columns: [
          { key: "ticketNumber", label: "Ticket" },
          { key: "title", label: "Subject" },
          { key: "client", label: "Client" },
          { key: "board", label: "Board" },
          { key: "assignedTo", label: "Assigned" },
          { key: "status", label: "Status" },
          { key: "priority", label: "Priority" },
          { key: "ageDays", label: "Age (days)", align: "right" },
        ],
        rows: list<Payload>(payload.oldestOpen),
        emptyText: "No open tickets in this period.",
      },
      {
        kind: "facts",
        title: "Averages",
        items: [
          { label: "First response", value: averages.firstResponseMinutes === null || averages.firstResponseMinutes === undefined ? "Not recorded" : duration(averages.firstResponseMinutes) },
          { label: "Time to resolve", value: averages.resolutionMinutes === null || averages.resolutionMinutes === undefined ? "Nothing resolved in the period" : duration(averages.resolutionMinutes) },
          { label: "Age of an open ticket", value: averages.ageDaysOpen === null || averages.ageDaysOpen === undefined ? "—" : `${averages.ageDaysOpen} days` },
          { label: "Age of a resolved ticket", value: averages.ageDaysClosed === null || averages.ageDaysClosed === undefined ? "—" : `${averages.ageDaysClosed} days` },
        ],
      },
      ...(quality.note ? [{ kind: "notes", title: "Data quality", items: [String(quality.note)], tone: "warn" } as Section] : []),
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  2. SLA performance
// ═══════════════════════════════════════════════════════════════════

const sla: StandardReport = {
  id: "sla",
  title: "SLA Performance",
  description: "Response and resolution compliance by board and technician, with every target that was missed",
  icon: Timer,
  endpoint: "/reports/data/sla-compliance",
  filters: { client: true, board: true, period: true },
  build: payload => {
    const response = record(payload.response);
    const resolution = record(payload.resolution);
    const sources = record(payload.responseSources);
    const quality = record(payload.dataQuality);
    const groupColumns = (prefix: "Response" | "Resolution") => [
      { key: "label", label: prefix === "Response" ? "Board / technician" : "Board / technician" },
      { key: "tickets", label: "Tickets", align: "right" as const },
      { key: "met", label: "Met", align: "right" as const },
      { key: "late", label: "Late", align: "right" as const },
      { key: "missed", label: "Missed", align: "right" as const },
      { key: "awaiting", label: "Inside target", align: "right" as const },
      { key: "compliance", label: "Compliance", align: "right" as const, format: "percent" as const },
      { key: "avg", label: "Avg", align: "right" as const },
    ];
    const groupRows = (rows: Payload[], prefix: "Response" | "Resolution") => rows.map(r => ({
      label: text(r.label),
      tickets: num(r.tickets),
      met: num(r[`met${prefix}`]),
      late: num(r[`breached${prefix}`]),
      missed: num(r[`missed${prefix}`]),
      awaiting: num(r[`awaiting${prefix}`]),
      compliance: num(r[`${prefix.toLowerCase()}CompliancePct`]),
      avg: prefix === "Response" && r.avgResponseMinutes !== null && r.avgResponseMinutes !== undefined ? duration(r.avgResponseMinutes) : "—",
    }));

    return [
      {
        kind: "kpis",
        title: "Compliance",
        items: [
          { label: "Response", value: `${number(payload.responseCompliancePct)}%`, tone: toneFor(num(payload.responseCompliancePct)), sub: `${number(response.met)} of ${num(payload.evaluated)} tickets` },
          { label: "Resolution", value: `${number(payload.resolutionCompliancePct)}%`, tone: toneFor(num(payload.resolutionCompliancePct)), sub: `${number(resolution.met)} of ${num(payload.evaluated)} tickets` },
          { label: "Average first response", value: payload.avgResponseMinutes === null || payload.avgResponseMinutes === undefined ? "Not recorded" : duration(payload.avgResponseMinutes), tone: "info" },
          { label: "Average time to resolve", value: payload.avgResolutionMinutes === null || payload.avgResolutionMinutes === undefined ? "Nothing resolved" : duration(payload.avgResolutionMinutes), tone: "info" },
        ],
      },
      {
        kind: "facts",
        title: "Outcomes",
        items: [
          { label: "Response met / answered late", value: `${number(response.met)} / ${number(response.breached)}` },
          { label: "Response target passed with nothing recorded", value: number(response.missed) },
          { label: "Still inside the response target", value: number(response.awaiting) },
          { label: "Resolution met / late", value: `${number(resolution.met)} / ${number(resolution.breached)}` },
          { label: "Unresolved past the resolution target", value: number(resolution.missed) },
          { label: "First response found on the ticket stamp", value: `${number(sources.stamp)} tickets` },
          { label: "First response taken from our first reply", value: `${number(sources.reply)} tickets` },
          { label: "No reply recorded at all", value: `${number(sources.none)} tickets` },
        ],
      },
      { kind: "table", title: "By board — response", columns: groupColumns("Response"), rows: groupRows(list<Payload>(payload.byBoard), "Response") },
      { kind: "table", title: "By board — resolution", columns: groupColumns("Resolution"), rows: groupRows(list<Payload>(payload.byBoard), "Resolution") },
      { kind: "table", title: "By technician — response", columns: groupColumns("Response"), rows: groupRows(list<Payload>(payload.byTechnician), "Response") },
      { kind: "table", title: "By technician — resolution", columns: groupColumns("Resolution"), rows: groupRows(list<Payload>(payload.byTechnician), "Resolution") },
      {
        kind: "table",
        title: "Targets missed and answered late",
        columns: [
          { key: "ticketNumber", label: "Ticket" },
          { key: "title", label: "Subject" },
          { key: "client", label: "Client" },
          { key: "assignedTo", label: "Assigned" },
          { key: "status", label: "Status" },
          { key: "priority", label: "Priority" },
          { key: "ageHours", label: "Age", align: "right", format: "hours" },
          { key: "response", label: "Response" },
          { key: "resolution", label: "Resolution" },
        ],
        rows: list<Payload>(payload.breaches).map(b => ({
          ...b,
          response: OUTCOME_LABEL[text(b.responseOutcome, "")] ?? text(b.responseOutcome),
          resolution: OUTCOME_LABEL[text(b.resolutionOutcome, "")] ?? text(b.resolutionOutcome),
        })),
        emptyText: "Nothing breached a target in this period.",
      },
      ...(payload.note ? [{ kind: "notes", title: "What this says", items: [String(payload.note)], tone: "info" } as Section] : []),
      ...(quality.note ? [{ kind: "notes", title: "Data quality", items: [String(quality.note)], tone: "warn" } as Section] : []),
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  3. Technician productivity
// ═══════════════════════════════════════════════════════════════════

const utilization: StandardReport = {
  id: "utilization",
  title: "Technician Productivity",
  description: "Hours, billable split, utilization against capacity and ticket throughput per technician",
  icon: Users,
  endpoint: "/reports/data/technician-utilization",
  filters: { client: true, period: true },
  build: payload => {
    const totals = record(payload.totals);
    const rows = list<Payload>(payload.technicians);
    return [
      {
        kind: "kpis",
        title: "Team",
        items: [
          { label: "People with activity", value: number(totals.staff) },
          { label: "Billable", value: duration(totals.billableMinutes), tone: "good" },
          { label: "Non-billable", value: duration(totals.nonBillableMinutes), tone: "warn" },
          { label: "Tickets resolved", value: number(totals.ticketsClosed) },
          { label: "Value recorded", value: money(totals.valueRecorded), tone: "info" },
        ],
      },
      { kind: "bars", title: "Billable hours by technician", rows: rows.map(r => ({ label: text(r.name), value: num(r.billableMinutes), display: duration(r.billableMinutes) })) },
      { kind: "bars", title: "Tickets resolved by technician", rows: rows.filter(r => num(r.ticketsClosed) > 0).map(r => ({ label: text(r.name), value: num(r.ticketsClosed) })) },
      {
        kind: "table",
        title: "Per technician",
        columns: [
          { key: "name", label: "Technician" },
          { key: "department", label: "Department" },
          { key: "billable", label: "Billable", align: "right" },
          { key: "nonBillable", label: "Non-billable", align: "right" },
          { key: "total", label: "Total", align: "right" },
          { key: "billablePct", label: "Billable %", align: "right", format: "percent" },
          { key: "utilization", label: "Utilization", align: "right" },
          { key: "assigned", label: "Assigned", align: "right" },
          { key: "closed", label: "Resolved", align: "right" },
          { key: "open", label: "Open", align: "right" },
          { key: "avgPerTicket", label: "Avg per ticket", align: "right" },
          { key: "value", label: "Value recorded", align: "right", format: "money" },
          { key: "cost", label: "Labour cost", align: "right" },
        ],
        rows: rows.map(r => ({
          name: text(r.name),
          department: text(r.department, "—"),
          billable: duration(r.billableMinutes),
          nonBillable: duration(r.nonBillableMinutes),
          total: duration(r.totalMinutes),
          billablePct: num(r.billablePct),
          utilization: r.utilizationPct === null || r.utilizationPct === undefined ? "—" : `${number(r.utilizationPct)}%`,
          assigned: num(r.ticketsAssigned),
          closed: num(r.ticketsClosed),
          open: num(r.ticketsOpen),
          avgPerTicket: r.avgHoursPerTicketClosed === null || r.avgHoursPerTicketClosed === undefined ? "—" : `${r.avgHoursPerTicketClosed}h`,
          value: num(r.valueRecorded),
          cost: r.labourCost === null || r.labourCost === undefined ? "No cost rate" : money(r.labourCost),
        })),
      },
      {
        kind: "facts",
        title: "How utilization is measured",
        items: [
          { label: "Capacity basis", value: text(payload.capacityBasis) },
          { label: "People without a cost rate", value: `${number(totals.withoutCostRate)} of ${number(totals.staff)}` },
          { label: "Labour cost", value: money(totals.labourCost) },
        ],
      },
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  4. Revenue
// ═══════════════════════════════════════════════════════════════════

const revenue: StandardReport = {
  id: "revenue",
  title: "Revenue",
  description: "Invoiced, collected and outstanding, receivables ageing, payments by method and the largest debts",
  icon: DollarSign,
  endpoint: "/reports/data/revenue-summary",
  filters: { client: true, period: true },
  build: payload => {
    const monthly = list<Payload>(payload.monthlyRevenue);
    return [
      {
        kind: "kpis",
        title: "In the period",
        items: [
          { label: "Invoiced", value: money(payload.invoicedInPeriod) },
          { label: "Collected", value: money(payload.collectedInPeriod), tone: "good" },
          { label: "Collection rate", value: `${number(payload.collectionRate)}%`, tone: toneFor(num(payload.collectionRate), 95) },
          { label: "Average invoice", value: money(payload.averageInvoice), tone: "info" },
        ],
      },
      {
        kind: "kpis",
        title: "Balance sheet",
        items: [
          { label: "Outstanding", value: money(payload.totalOutstanding), tone: "warn" },
          { label: "Overdue", value: money(payload.totalOverdue), tone: "bad" },
          { label: "Paid to date (all time)", value: money(payload.totalPaidAllTime), tone: "good" },
          { label: "Tax collected in the period", value: money(payload.taxCollected) },
        ],
      },
      { kind: "bars", title: "Invoiced by month", rows: monthly.map(m => ({ label: text(m.month), value: num(m.invoiced), display: money(m.invoiced) })) },
      { kind: "bars", title: "Collected by month", rows: monthly.map(m => ({ label: text(m.month), value: num(m.collected), display: money(m.collected), tone: "good" as const })) },
      {
        kind: "table",
        title: "Receivables ageing",
        columns: [
          { key: "label", label: "Bucket" },
          { key: "invoices", label: "Invoices", align: "right" },
          { key: "amount", label: "Amount", align: "right", format: "money" },
        ],
        rows: list<Payload>(payload.aging),
      },
      {
        kind: "table",
        title: "By client",
        columns: [
          { key: "client", label: "Client" },
          { key: "invoices", label: "Invoices", align: "right" },
          { key: "invoiced", label: "Invoiced", align: "right", format: "money" },
          { key: "collected", label: "Collected", align: "right", format: "money" },
          { key: "outstanding", label: "Outstanding", align: "right", format: "money" },
          { key: "oldest", label: "Oldest overdue", align: "right" },
        ],
        rows: list<Payload>(payload.byClient).map(r => ({ ...r, oldest: num(r.oldestOverdueDays) ? `${number(r.oldestOverdueDays)} days` : "Current" })),
      },
      {
        kind: "table",
        title: "Largest outstanding invoices",
        columns: [
          { key: "invoiceNumber", label: "Invoice" },
          { key: "client", label: "Client" },
          { key: "amount", label: "Amount", align: "right", format: "money" },
          { key: "issued", label: "Issued" },
          { key: "due", label: "Due" },
          { key: "daysOverdue", label: "Days overdue", align: "right" },
        ],
        rows: list<Payload>(payload.largestOutstanding),
        emptyText: "Nothing outstanding.",
      },
      {
        kind: "table",
        title: "Payments by method",
        columns: [
          { key: "method", label: "Method" },
          { key: "payments", label: "Payments", align: "right" },
          { key: "amount", label: "Amount", align: "right", format: "money" },
        ],
        rows: list<Payload>(payload.byMethod),
        emptyText: "No payments were recorded in this period.",
      },
      {
        kind: "facts",
        title: "Counts",
        items: [
          { label: "Invoices in the period", value: number(payload.invoiceCount) },
          { label: "Paid", value: number(payload.paidCount) },
          { label: "Open", value: number(payload.openCount) },
        ],
      },
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  5. Ticket aging
// ═══════════════════════════════════════════════════════════════════

const aging: StandardReport = {
  id: "aging",
  title: "Ticket Aging",
  description: "How long open tickets have been open, what has gone quiet, and who is holding them",
  icon: Clock,
  endpoint: "/reports/data/ticket-aging",
  filters: { client: true, board: true, period: true },
  build: payload => {
    const averages = record(payload.averages);
    const groupColumns = [
      { key: "label", label: "Group" },
      { key: "open", label: "Open", align: "right" as const },
      { key: "over30", label: "Over 30 days", align: "right" as const },
      { key: "avgAgeDays", label: "Average age (days)", align: "right" as const },
    ];
    return [
      {
        kind: "kpis",
        title: "Open work",
        items: [
          { label: "Open tickets", value: number(payload.total) },
          { label: "Average age", value: averages.ageDays === null || averages.ageDays === undefined ? "—" : `${averages.ageDays} days` },
          { label: "Oldest", value: averages.oldestDays ? `${number(averages.oldestDays)} days` : "—", tone: "bad" },
          { label: "Quiet for 7+ days", value: number(payload.stale), tone: "warn" },
          { label: "Unassigned", value: number(payload.unassigned), tone: "warn" },
        ],
      },
      { kind: "bars", title: "Age profile", rows: list<Payload>(payload.buckets).map(b => ({ label: text(b.label), value: num(b.count), display: `${number(b.count)} (${number(b.pct)}%)` })) },
      { kind: "table", title: "By priority", columns: groupColumns, rows: list<Payload>(payload.byPriority) },
      { kind: "table", title: "By board", columns: groupColumns, rows: list<Payload>(payload.byBoard) },
      { kind: "table", title: "By assignee", columns: groupColumns, rows: list<Payload>(payload.byAssignee) },
      { kind: "table", title: "By client", columns: groupColumns, rows: list<Payload>(payload.byClient) },
      {
        kind: "table",
        title: "Oldest open tickets",
        columns: [
          { key: "ticketNumber", label: "Ticket" },
          { key: "title", label: "Subject" },
          { key: "client", label: "Client" },
          { key: "board", label: "Board" },
          { key: "assignedTo", label: "Assigned" },
          { key: "status", label: "Status" },
          { key: "priority", label: "Priority" },
          { key: "ageDays", label: "Age (days)", align: "right" },
          { key: "idleDays", label: "Quiet (days)", align: "right" },
          { key: "due", label: "Due" },
        ],
        rows: list<Payload>(payload.oldest),
      },
      {
        kind: "facts",
        title: "Also worth knowing",
        items: [
          { label: "Average quiet time", value: averages.idleDays === null || averages.idleDays === undefined ? "—" : `${averages.idleDays} days` },
          { label: "Waiting on the client", value: number(payload.waitingOnClient) },
        ],
      },
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  6. Time tracking
// ═══════════════════════════════════════════════════════════════════

const timeTracking: StandardReport = {
  id: "time-tracking",
  title: "Time Tracking",
  description: "Every hour by date, technician, work type and ticket, with the billable split and recorded value",
  icon: Calendar,
  endpoint: "/reports/data/time-tracking",
  filters: { client: true, period: true },
  build: payload => {
    const totals = record(payload.totals);
    const pricing = record(payload.pricing);
    const byDate = list<Payload>(payload.byDate).slice(0, 30).reverse();
    return [
      {
        kind: "kpis",
        title: "Hours",
        items: [
          { label: "Entries", value: number(totals.entries) },
          { label: "Total", value: duration(totals.minutes) },
          { label: "Billable", value: duration(totals.billableMinutes), tone: "good" },
          { label: "Non-billable", value: duration(totals.nonBillableMinutes), tone: "warn" },
          { label: "Overtime", value: duration(totals.overtimeMinutes) },
          { label: "No charge", value: duration(totals.noChargeMinutes) },
          { label: "Average entry", value: duration(totals.averageEntryMinutes), tone: "info" },
          { label: "Value recorded", value: money(totals.valueRecorded), tone: "info" },
        ],
      },
      { kind: "bars", title: "Hours by day", rows: byDate.map(d => ({ label: text(d.date), value: num(d.minutes), display: duration(d.minutes) })), note: "Most recent 30 days in the period." },
      { kind: "bars", title: "Hours by work type", rows: list<Payload>(payload.byWorkType).map(w => ({ label: text(w.workType), value: num(w.minutes), display: duration(w.minutes) })) },
      {
        kind: "table",
        title: "By technician",
        columns: [
          { key: "technician", label: "Technician" },
          { key: "entries", label: "Entries", align: "right" },
          { key: "minutes", label: "Hours", align: "right" },
          { key: "billedMinutes", label: "Billed", align: "right" },
          { key: "overtimeMinutes", label: "Overtime", align: "right" },
          { key: "averageEntryMinutes", label: "Average entry", align: "right" },
        ],
        rows: list<Payload>(payload.byTechnician).map(r => ({
          technician: text(r.technician),
          entries: num(r.entries),
          minutes: duration(r.minutes),
          billedMinutes: duration(r.billedMinutes),
          overtimeMinutes: duration(r.overtimeMinutes),
          averageEntryMinutes: duration(r.averageEntryMinutes),
        })),
      },
      {
        kind: "table",
        title: "Heaviest tickets",
        columns: [
          { key: "ticketNumber", label: "Ticket" },
          { key: "title", label: "Subject" },
          { key: "client", label: "Client" },
          { key: "entries", label: "Entries", align: "right" },
          { key: "minutes", label: "Hours", align: "right" },
        ],
        rows: list<Payload>(payload.byTicket).map(r => ({ ...r, minutes: duration(r.minutes) })),
      },
      {
        kind: "table",
        title: `Entries (latest ${number(payload.rowLimit)} in the period)`,
        columns: [
          { key: "date", label: "Date" },
          { key: "technician", label: "Technician" },
          { key: "ticketNumber", label: "Ticket" },
          { key: "client", label: "Client" },
          { key: "workType", label: "Work type" },
          { key: "minutes", label: "Hours", align: "right" },
          { key: "billable", label: "Billable", format: "yesno" },
          { key: "rate", label: "Rate", align: "right", format: "money" },
          { key: "description", label: "Description" },
        ],
        rows: list<Payload>(payload.rows).map(r => ({ ...r, minutes: duration(r.minutes) })),
        note: `${number(pricing.entriesWithRate)} entries carry a rate and ${number(pricing.entriesWithoutRate)} do not. Totals above come from the whole period, not from this list.`,
      },
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  7. Client satisfaction
// ═══════════════════════════════════════════════════════════════════

const csat: StandardReport = {
  id: "csat",
  title: "Client Satisfaction",
  description: "Survey responses, NPS, promoters and detractors, measured from replies rather than estimated",
  icon: CheckCircle,
  endpoint: "/reports/data/csat",
  filters: { client: true, period: true },
  build: payload => {
    const totals = record(payload.totals);
    return [
      {
        kind: "kpis",
        title: "Responses",
        items: [
          { label: "Responses", value: number(totals.responses) },
          { label: "NPS", value: totals.nps === null || totals.nps === undefined ? "No scores" : number(totals.nps), tone: num(totals.nps) >= 30 ? "good" : num(totals.nps) >= 0 ? "warn" : "bad" },
          { label: "Average score", value: totals.averageScore === null || totals.averageScore === undefined ? "—" : `${totals.averageScore} / 10`, tone: "info" },
          { label: "Tickets resolved in the period", value: number(totals.resolvedTickets) },
        ],
      },
      { kind: "bars", title: "Score distribution", rows: list<Payload>(payload.distribution).map(d => ({ label: `${d.score}`, value: num(d.count) })) },
      {
        kind: "table",
        title: "By client",
        columns: [
          { key: "client", label: "Client" },
          { key: "responses", label: "Responses", align: "right" },
          { key: "averageScore", label: "Average", align: "right" },
          { key: "nps", label: "NPS", align: "right" },
          { key: "promoters", label: "Promoters", align: "right" },
          { key: "passives", label: "Passives", align: "right" },
          { key: "detractors", label: "Detractors", align: "right" },
          { key: "resolvedTickets", label: "Resolved", align: "right" },
          { key: "coveragePct", label: "Coverage", align: "right", format: "percent" },
          { key: "lastResponseAt", label: "Last response" },
        ],
        rows: list<Payload>(payload.byClient),
      },
      {
        kind: "table",
        title: "Surveys",
        columns: [
          { key: "name", label: "Survey" },
          { key: "type", label: "Type" },
          { key: "isActive", label: "Active", format: "yesno" },
          { key: "sendOnResolve", label: "Sent on resolve", format: "yesno" },
          { key: "responses", label: "Responses in the period", align: "right" },
        ],
        rows: list<Payload>(payload.surveys),
      },
      { kind: "facts", title: "Promoter split", items: [
        { label: "Promoters (9–10)", value: number(totals.promoters) },
        { label: "Passives (7–8)", value: number(totals.passives) },
        { label: "Detractors (0–6)", value: number(totals.detractors) },
      ] },
      ...(payload.note ? [{ kind: "notes", title: "How this is measured", items: [String(payload.note)], tone: "info" } as Section] : []),
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  8. Contract profitability
// ═══════════════════════════════════════════════════════════════════

const contract: StandardReport = {
  id: "contract",
  title: "Contract Profitability",
  description: "Revenue against labour, expense and product cost per agreement, with the margin that leaves",
  icon: TrendingUp,
  endpoint: "/reports/data/contract-profitability",
  filters: { client: true, period: true },
  build: payload => {
    const totals = record(payload.totals);
    const basis = record(payload.costBasis);
    return [
      {
        kind: "kpis",
        title: "Portfolio",
        items: [
          { label: "Agreements", value: number(totals.agreements) },
          { label: "Annualised value", value: money(totals.annualisedValue), tone: "info" },
          { label: "Invoiced", value: money(totals.invoiced) },
          { label: "Collected", value: money(totals.collected), tone: "good" },
          { label: "Cost", value: money(num(totals.labourCost) + num(totals.expenseCost) + num(totals.productCost)), tone: "warn" },
          { label: "Margin", value: money(totals.margin), tone: num(totals.margin) >= 0 ? "good" : "bad" },
          { label: "Margin %", value: `${number(totals.marginPct)}%`, tone: num(totals.marginPct) >= 40 ? "good" : num(totals.marginPct) >= 20 ? "warn" : "bad" },
          { label: "Renewals in 90 days", value: number(totals.renewalsNext90Days) },
        ],
      },
      {
        kind: "table",
        title: "Per agreement",
        columns: [
          { key: "agreement", label: "Agreement" },
          { key: "client", label: "Client" },
          { key: "type", label: "Type" },
          { key: "billingAmount", label: "Billing", align: "right", format: "money" },
          { key: "billingPeriod", label: "Period" },
          { key: "annualisedValue", label: "Annualised", align: "right", format: "money" },
          { key: "invoiced", label: "Invoiced", align: "right", format: "money" },
          { key: "collected", label: "Collected", align: "right", format: "money" },
          { key: "outstanding", label: "Outstanding", align: "right", format: "money" },
          { key: "hoursDelivered", label: "Hours", align: "right" },
          { key: "labour", label: "Labour cost", align: "right", format: "money" },
          { key: "expenses", label: "Expenses", align: "right", format: "money" },
          { key: "products", label: "Products", align: "right", format: "money" },
          { key: "margin", label: "Margin", align: "right", format: "money" },
          { key: "marginPct", label: "Margin %", align: "right", format: "percent" },
          { key: "effectiveHourlyRate", label: "Effective rate", align: "right", format: "money" },
          { key: "endDate", label: "Renews" },
        ],
        rows: list<Payload>(payload.agreements).map(a => {
          const costs = record(a.costs);
          return {
            agreement: text(a.agreement),
            client: text(a.client),
            type: text(a.type),
            billingAmount: num(a.billingAmount),
            billingPeriod: text(a.billingPeriod),
            annualisedValue: num(a.annualisedValue),
            invoiced: num(a.invoiced),
            collected: num(a.collected),
            outstanding: num(a.outstanding),
            hoursDelivered: a.hoursDelivered,
            labour: num(costs.labour),
            expenses: num(costs.expenses),
            products: num(costs.products),
            margin: num(a.margin),
            marginPct: num(a.marginPct),
            effectiveHourlyRate: a.effectiveHourlyRate === null || a.effectiveHourlyRate === undefined ? "—" : money(a.effectiveHourlyRate),
            endDate: text(a.endDate, "Open ended"),
          };
        }),
        emptyText: "No service agreements matched.",
      },
      {
        kind: "table",
        title: "Allowances used",
        columns: [
          { key: "agreement", label: "Agreement" },
          { key: "client", label: "Client" },
          { key: "allowance", label: "Included hours", align: "right" },
          { key: "allowanceUsed", label: "Used", align: "right" },
          { key: "allowanceRemaining", label: "Remaining", align: "right" },
          { key: "hoursDelivered", label: "Delivered in period", align: "right" },
        ],
        rows: list<Payload>(payload.agreements).filter(a => num(a.allowance) > 0).map(a => ({
          agreement: text(a.agreement), client: text(a.client),
          allowance: number(a.allowance), allowanceUsed: a.allowanceUsed ?? "—", allowanceRemaining: a.allowanceRemaining ?? "—",
          hoursDelivered: a.hoursDelivered,
        })),
        emptyText: "No agreement in scope has an included allowance.",
      },
      {
        kind: "facts",
        title: "What the cost is made of",
        items: [
          { label: "Labour", value: money(totals.labourCost) },
          { label: "Expenses", value: money(totals.expenseCost) },
          { label: "Products", value: money(totals.productCost) },
          { label: "Hours with no cost rate", value: number(totals.unpricedHours) },
        ],
      },
      { kind: "facts", title: "Cost basis", items: [
        { label: "Labour", value: text(basis.labour) },
        { label: "Expenses", value: text(basis.expenses) },
        { label: "Products", value: text(basis.products) },
      ] },
      ...(basis.note ? [{ kind: "notes", title: "Read this before quoting the margin", items: [String(basis.note)], tone: num(basis.hoursWithoutCostRate) > 0 ? "warn" : "good" } as Section] : []),
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  9. Client value
// ═══════════════════════════════════════════════════════════════════

const clientValue: StandardReport = {
  id: "client-value",
  title: "Client Value",
  description: "What each client is worth in attention and money — volume, responsiveness, hours and revenue",
  icon: Users,
  endpoint: "/reports/data/client-value",
  filters: { client: true, period: true },
  build: payload => {
    const totals = record(payload.totals);
    const clients = list<Payload>(payload.clients);
    return [
      {
        kind: "kpis",
        title: "Book",
        items: [
          { label: "Clients", value: number(totals.clients) },
          { label: "Tickets", value: number(totals.tickets) },
          { label: "Hours logged", value: `${number(totals.hoursLogged)}h` },
          { label: "Invoiced", value: money(totals.invoiced) },
          { label: "Outstanding", value: money(totals.outstanding), tone: "warn" },
          { label: "Recurring annual value", value: money(totals.recurringAnnualValue), tone: "good" },
        ],
      },
      { kind: "bars", title: "Tickets by client", rows: clients.map(c => ({ label: text(c.client), value: num(c.ticketsTotal) })) },
      { kind: "bars", title: "Invoiced by client", rows: clients.map(c => ({ label: text(c.client), value: num(c.invoiced), display: money(c.invoiced) })) },
      {
        kind: "table",
        title: "Per client",
        columns: [
          { key: "client", label: "Client" },
          { key: "industry", label: "Industry" },
          { key: "serviceLevel", label: "Service level" },
          { key: "ticketsTotal", label: "Tickets", align: "right" },
          { key: "ticketsLast90Days", label: "Last 90 days", align: "right" },
          { key: "open", label: "Open", align: "right" },
          { key: "highPriority", label: "High priority", align: "right" },
          { key: "activePeople", label: "People in touch", align: "right" },
          { key: "avgFirstReply", label: "First reply", align: "right" },
          { key: "avgResolution", label: "Time to resolve", align: "right" },
          { key: "hoursLogged", label: "Hours", align: "right", format: "hours" },
          { key: "nonBillableHours", label: "Non-billable", align: "right", format: "hours" },
          { key: "invoiced", label: "Invoiced", align: "right", format: "money" },
          { key: "outstanding", label: "Outstanding", align: "right", format: "money" },
          { key: "recurringAnnualValue", label: "Recurring", align: "right", format: "money" },
          { key: "revenuePerTicket", label: "Revenue per ticket", align: "right" },
        ],
        rows: clients.map(c => ({
          client: text(c.client),
          industry: text(c.industry, "—"),
          serviceLevel: text(c.serviceLevel, "—"),
          ticketsTotal: num(c.ticketsTotal),
          ticketsLast90Days: num(c.ticketsLast90Days),
          open: num(c.open),
          highPriority: num(c.highPriority),
          activePeople: num(c.activePeople),
          avgFirstReply: c.avgFirstReplyMinutes === null || c.avgFirstReplyMinutes === undefined ? "—" : duration(c.avgFirstReplyMinutes),
          avgResolution: c.avgResolutionHours === null || c.avgResolutionHours === undefined ? "—" : `${c.avgResolutionHours}h`,
          hoursLogged: num(c.hoursLogged),
          nonBillableHours: num(c.nonBillableHours),
          invoiced: num(c.invoiced),
          outstanding: num(c.outstanding),
          recurringAnnualValue: num(c.recurringAnnualValue),
          revenuePerTicket: c.revenuePerTicket === null || c.revenuePerTicket === undefined ? "—" : money(c.revenuePerTicket),
        })),
      },
    ];
  },
};

// ═══════════════════════════════════════════════════════════════════
//  10. Business reviews (weekly / monthly / quarterly)
// ═══════════════════════════════════════════════════════════════════

const change = (value: unknown): string => {
  if (value === null || value === undefined) return "No comparable period";
  const n = Number(value);
  return `${n >= 0 ? "+" : ""}${n}% vs the period before`;
};

/**
 * The business-review pack, once, for all three cadences. A weekly review and a quarterly review
 * are the same document over a different window — writing it three times is how the three end up
 * disagreeing — so the builder takes the cadence's nouns and endpoint, and the server supplies the
 * window, the comparison and the list of periods the picker offers.
 */
function businessReview({ id, title, description, endpoint, icon, noun, periodLabel }: {
  id: string;
  title: string;
  description: string;
  endpoint: string;
  icon: LucideIcon;
  noun: string;
  periodLabel: string;
}): StandardReport {
  return {
    id,
    title,
    description,
    icon,
    endpoint,
    filters: { client: true },
    quarters: true,
    periodNoun: noun,
    periodLabel,
    build: payload => {
      const comparisons = record(payload.comparisons);
      const delivery = record(payload.serviceDelivery);
      const hours = record(delivery.hours);
      const commercials = record(payload.commercials);
      const agreementTotals = record(commercials.agreementTotals);
      const estate = record(payload.estate);
      const satisfaction = record(payload.satisfaction);
      const clients = record(payload.clients);
      const risk = record(payload.risk);
      const slaDetail = record(delivery.sla);
      const resp = record(slaDetail.response);
      const reso = record(slaDetail.resolution);
      const ticketDelta = record(comparisons.tickets);
      const hoursDelta = record(comparisons.hours);
      const invoicedDelta = record(comparisons.invoiced);
      const collectedDelta = record(comparisons.collected);
      const compliance = record(comparisons.responseCompliancePct);
      const reviewed = text(payload.reviewedPeriod ?? payload.reviewedQuarter, "The period");
      const comparedWith = text(payload.comparedWith, "the period before");

      return [
        {
          kind: "kpis",
          title: `${reviewed} against ${comparedWith}`,
          items: [
            { label: "Tickets", value: number(ticketDelta.current), sub: change(ticketDelta.changePct), tone: "info" },
            { label: "Hours delivered", value: `${number(hoursDelta.current)}h`, sub: change(hoursDelta.changePct), tone: "info" },
            { label: "Invoiced", value: money(invoicedDelta.current), sub: change(invoicedDelta.changePct), tone: "good" },
            { label: "Collected", value: money(collectedDelta.current), sub: change(collectedDelta.changePct), tone: "good" },
          ],
        },
        { kind: "notes", title: "Highlights", items: list<string>(payload.highlights), tone: "good" },
        { kind: "notes", title: "Watch items", items: list<string>(payload.watchItems), tone: "warn" },
        {
          kind: "kpis",
          title: "Service delivery",
          items: [
            { label: "Opened", value: number(delivery.opened) },
            { label: "Resolved", value: number(delivery.closed), tone: "good" },
            { label: "Backlog at close", value: number(delivery.backlog), tone: "warn" },
            { label: "Response compliance", value: `${number(slaDetail.responseCompliancePct)}%`, tone: toneFor(num(slaDetail.responseCompliancePct)), sub: `Was ${number(compliance.previous)}%` },
            { label: "Resolution compliance", value: `${number(slaDetail.resolutionCompliancePct)}%`, tone: toneFor(num(slaDetail.resolutionCompliancePct)) },
            { label: "Average first response", value: delivery.firstResponseHours === null || delivery.firstResponseHours === undefined ? "Not recorded" : `${delivery.firstResponseHours}h` },
            { label: "Average time to resolve", value: delivery.resolutionHours === null || delivery.resolutionHours === undefined ? "—" : `${delivery.resolutionHours}h` },
            { label: "Hours billable", value: `${number(hours.billable)} of ${number(hours.total)}`, tone: "info" },
          ],
        },
        {
          kind: "table",
          title: "Targets met, late and missed",
          columns: [
            { key: "target", label: "Target" },
            { key: "met", label: "Met", align: "right" },
            { key: "late", label: "Answered late", align: "right" },
            { key: "missed", label: "Missed", align: "right" },
            { key: "awaiting", label: "Inside target", align: "right" },
          ],
          rows: [
            { target: "First response", met: num(resp.met), late: num(resp.breached), missed: num(resp.missed), awaiting: num(resp.awaiting) },
            { target: "Resolution", met: num(reso.met), late: num(reso.breached), missed: num(reso.missed), awaiting: num(reso.awaiting) },
          ],
        },
        { kind: "bars", title: "Hours by work type", rows: list<Payload>(hours.byWorkType).map(w => ({ label: text(w.workType), value: num(w.minutes), display: duration(w.minutes) })) },
        {
          kind: "table",
          title: "Delivery by technician",
          columns: [
            { key: "name", label: "Technician" },
            { key: "closed", label: "Resolved", align: "right" },
            { key: "billableHours", label: "Billable hours", align: "right" },
            { key: "utilizationPct", label: "Utilization", align: "right" },
          ],
          rows: list<Payload>(delivery.ticketsClosedByTechnician) as Array<Record<string, unknown>>,
          emptyText: "No technician activity in this period.",
        },
        { kind: "bars", title: "Tickets opened by period", rows: list<Payload>(delivery.trend).map(t => ({ label: text(t.period), value: num(t.opened), display: `${number(t.opened)} opened · ${number(t.closed)} resolved` })) },
        {
          kind: "kpis",
          title: "Commercials",
          items: [
            { label: "Invoiced", value: money(commercials.invoiced), tone: "good" },
            { label: "Collected", value: money(commercials.collected), tone: "good" },
            { label: "Outstanding", value: money(commercials.outstanding), tone: "warn" },
            { label: "Overdue", value: money(commercials.overdue), tone: "bad" },
            { label: "Collection rate", value: `${number(commercials.collectionRate)}%`, tone: toneFor(num(commercials.collectionRate), 95) },
            { label: "Average invoice", value: money(commercials.averageInvoice), tone: "info" },
            { label: "Recurring annual value", value: money(agreementTotals.annualisedValue), tone: "info" },
            { label: "Agreement margin", value: `${number(agreementTotals.marginPct)}%`, tone: "info" },
          ],
        },
        {
          kind: "table",
          title: `Revenue by client this ${noun}`,
          columns: [
            { key: "client", label: "Client" },
            { key: "invoices", label: "Invoices", align: "right" },
            { key: "invoiced", label: "Invoiced", align: "right", format: "money" },
            { key: "collected", label: "Collected", align: "right", format: "money" },
            { key: "outstanding", label: "Outstanding", align: "right", format: "money" },
            { key: "oldest", label: "Oldest overdue", align: "right" },
          ],
          rows: list<Payload>(commercials.byClient).map(r => ({ ...r, oldest: num(r.oldestOverdueDays) ? `${number(r.oldestOverdueDays)} days` : "Current" })),
        },
        {
          kind: "table",
          title: "Agreements",
          columns: [
            { key: "agreement", label: "Agreement" },
            { key: "client", label: "Client" },
            { key: "billingAmount", label: "Billing", align: "right", format: "money" },
            { key: "annualisedValue", label: "Annualised", align: "right", format: "money" },
            { key: "invoiced", label: "Invoiced", align: "right", format: "money" },
            { key: "hoursDelivered", label: "Hours", align: "right" },
            { key: "margin", label: "Margin", align: "right", format: "money" },
            { key: "marginPct", label: "Margin %", align: "right", format: "percent" },
          ],
          rows: list<Payload>(commercials.agreements),
          emptyText: "No agreements in scope.",
        },
        {
          kind: "table",
          title: "Catalogue items sold",
          columns: [
            { key: "product", label: "Product" },
            { key: "sku", label: "SKU" },
            { key: "type", label: "Type" },
            { key: "quantity", label: "Quantity", align: "right" },
            { key: "lines", label: "Lines", align: "right" },
            { key: "revenue", label: "Revenue", align: "right", format: "money" },
          ],
          rows: list<Payload>(commercials.topProducts),
          emptyText: `No catalogue items were invoiced this ${noun}.`,
        },
        {
          kind: "table",
          title: "Clients by tickets",
          columns: [{ key: "label", label: "Client" }, { key: "count", label: "Tickets", align: "right" }],
          rows: list<Payload>(clients.byTickets),
        },
        {
          kind: "table",
          title: "Open work by client",
          columns: [
            { key: "label", label: "Client" },
            { key: "open", label: "Open", align: "right" },
            { key: "over30", label: "Over 30 days", align: "right" },
            { key: "avgAgeDays", label: "Average age (days)", align: "right" },
          ],
          rows: list<Payload>(clients.aging),
        },
        {
          kind: "table",
          title: "Risk — targets missed and answered late",
          columns: [
            { key: "ticketNumber", label: "Ticket" },
            { key: "title", label: "Subject" },
            { key: "client", label: "Client" },
            { key: "assignedTo", label: "Assigned" },
            { key: "ageHours", label: "Age", align: "right", format: "hours" },
            { key: "responseOutcome", label: "Response" },
            { key: "resolutionOutcome", label: "Resolution" },
          ],
          rows: list<Payload>(risk.slaBreaches),
          emptyText: `Nothing breached a target this ${noun}.`,
        },
        {
          kind: "table",
          title: "Risk — largest outstanding invoices",
          columns: [
            { key: "invoiceNumber", label: "Invoice" },
            { key: "client", label: "Client" },
            { key: "amount", label: "Amount", align: "right", format: "money" },
            { key: "due", label: "Due" },
            { key: "daysOverdue", label: "Days overdue", align: "right" },
          ],
          rows: (risk.largestOutstanding as Array<Record<string, unknown>>) ?? [],
          emptyText: "Nothing outstanding.",
        },
        {
          kind: "facts",
          title: "Estate under management",
          items: [
            { label: "Assets", value: number(estate.assets) },
            { label: "Warranties expiring in 90 days", value: number(estate.warrantyExpiringIn90Days) },
            ...list<Payload>(estate.byType).map(t => ({ label: text(t.type), value: number(t.count) })),
          ],
        },
        {
          kind: "kpis",
          title: "Satisfaction",
          items: [
            { label: "Responses", value: number(satisfaction.responses) },
            { label: "NPS", value: satisfaction.nps === null || satisfaction.nps === undefined ? "No scores" : number(satisfaction.nps), tone: num(satisfaction.nps) >= 30 ? "good" : "warn" },
            { label: "Average score", value: satisfaction.averageScore === null || satisfaction.averageScore === undefined ? "—" : `${satisfaction.averageScore} / 10`, tone: "info" },
          ],
        },
        {
          kind: "table",
          title: "Satisfaction by client",
          columns: [
            { key: "client", label: "Client" },
            { key: "responses", label: "Responses", align: "right" },
            { key: "averageScore", label: "Average", align: "right" },
            { key: "nps", label: "NPS", align: "right" },
            { key: "promoters", label: "Promoters", align: "right" },
            { key: "detractors", label: "Detractors", align: "right" },
          ],
          rows: list<Payload>(satisfaction.byClient),
        },
        {
          kind: "facts",
          title: "How this pack was built",
          items: [
            { label: "Cadence", value: `${periodLabel} — reviewed ${reviewed}` },
            { label: "Compared with", value: comparedWith },
            { label: "Every figure comes from", value: "The same sources as the standard reports" },
          ],
        },
        { kind: "notes", title: "Notes", items: list<string>(payload.notes), tone: "info" },
      ];
    },
  };
}

const weeklyReview = businessReview({
  id: "weekly-review",
  title: "Weekly Business Review",
  description: "Last week's service, targets, commercials and risks, against the week before",
  endpoint: "/reports/data/weekly-business-review",
  icon: Calendar,
  noun: "week",
  periodLabel: "Last completed week",
});

const monthlyReview = businessReview({
  id: "monthly-review",
  title: "Monthly Business Review",
  description: "Last month's service, targets, commercials and risks, against the month before",
  endpoint: "/reports/data/monthly-business-review",
  icon: Calendar,
  noun: "month",
  periodLabel: "Last completed month",
});

const qbr = businessReview({
  id: "qbr",
  title: "Quarterly Business Review",
  description: "The service, commercial and risk picture for a quarter, against the one before it",
  endpoint: "/reports/data/quarterly-business-review",
  icon: Presentation,
  noun: "quarter",
  periodLabel: "Last completed quarter",
});

// ═══════════════════════════════════════════════════════════════════
//  10. Inactive Microsoft 365 accounts
// ═══════════════════════════════════════════════════════════════════

/**
 * Accounts across every connected tenant that nobody signs in to, per client.
 *
 * The report answers the licence-cleanup question in the order it is actually asked: how many
 * accounts are idle, whose they are, which ones are already disabled, and which ones we simply
 * cannot tell (no sign-in activity stored — those are reported as unknown, never as dormant, because
 * a report that funds itself by guessing gets live accounts switched off).
 */
const m365Inactive: StandardReport = {
  id: "m365-inactive-accounts",
  title: "Inactive Microsoft 365 Accounts",
  description: "Every idle account across the connected tenants, per client, with the threshold, disabled and unknown accounts under your control",
  icon: UserMinus,
  endpoint: "/reports/data/m365-inactive-accounts",
  filters: { client: true },
  options: [
    { key: "inactiveDays", label: "Inactive after", kind: "number", default: 90, suffix: "days", hint: "How long without a sign-in makes an account idle. 30 to catch lapsed users early, 90 to find the ones nobody will miss." },
    { key: "includeDisabled", label: "Disabled accounts", kind: "boolean", default: true, hint: "Accounts already switched off have been dealt with. Include them to see the whole estate, exclude them to see only what still needs a decision." },
    { key: "includeUnknown", label: "Unknown sign-in", kind: "boolean", default: true, hint: "Accounts with no sign-in activity recorded. Counting them as idle would be a guess; they are listed as unknown and can be left out entirely." },
    { key: "tenantId", label: "Tenant", kind: "tenant", default: "", hint: "One connected Microsoft 365 tenant, or all of them." },
  ],
  build: payload => {
    const coverage = record(payload.coverage);
    const totals = record(payload.totals);
    const accounts = list<Payload>(payload.accounts);
    const byClient = list<Payload>(payload.byClient);
    const byTenant = list<Payload>(payload.byTenant);
    const notes = list<unknown>(payload.notes).map(String);
    const inactive = num(totals.inactive);
    const listed = num(totals.accounts);

    return [
      {
        kind: "kpis",
        title: "Accounts",
        items: [
          { label: "Listed", value: number(listed), sub: text(payload.optionsLabel, "") },
          { label: "Inactive", value: number(inactive), tone: inactive ? "bad" : "good", sub: "No sign-in within the threshold" },
          { label: "Already disabled", value: number(totals.disabled), tone: "neutral", sub: "Handled — included unless you exclude them" },
          { label: "Unknown", value: number(totals.unknown), tone: num(totals.unknown) ? "warn" : "good", sub: "No sign-in activity could be read" },
        ],
      },
      {
        kind: "facts",
        title: "What this covers",
        items: [
          { label: "Scope", value: text(payload.scopeLabel, "All clients") },
          { label: "Tenants read", value: number(coverage.tenants) },
          { label: "Accounts synced in scope", value: number(coverage.accountsSynced) },
          { label: "Accounts listed", value: number(coverage.accountsListed) },
          { label: "Mapped to a client", value: number(totals.mapped) },
          { label: "Not mapped to a client", value: number(totals.unmapped) },
        ],
      },
      {
        kind: "table",
        title: "By client",
        columns: [
          { key: "client", label: "Client" },
          { key: "accounts", label: "Accounts", align: "right" },
          { key: "inactive", label: "Inactive", align: "right" },
          { key: "disabled", label: "Disabled", align: "right" },
          { key: "unknown", label: "Unknown", align: "right" },
          { key: "oldestDays", label: "Longest silence", align: "right" },
          { key: "averageDays", label: "Average silence", align: "right" },
        ],
        rows: byClient.map(row => ({
          client: text(row.clientName),
          accounts: number(row.accounts),
          inactive: number(row.inactive),
          disabled: number(row.disabled),
          unknown: number(row.unknown),
          oldestDays: row.oldestDays === null || row.oldestDays === undefined ? "—" : `${row.oldestDays} days`,
          averageDays: row.averageDays === null || row.averageDays === undefined ? "—" : `${row.averageDays} days`,
        })),
        emptyText: "No accounts match these options.",
      },
      {
        kind: "table",
        title: "By tenant",
        columns: [
          { key: "tenant", label: "Connected tenant" },
          { key: "accounts", label: "Accounts", align: "right" },
          { key: "inactive", label: "Inactive", align: "right" },
          { key: "unknown", label: "Unknown", align: "right" },
        ],
        rows: byTenant.map(row => ({
          tenant: text(row.tenantName),
          accounts: number(row.accounts),
          inactive: number(row.inactive),
          unknown: number(row.unknown),
        })),
      },
      {
        kind: "table",
        title: "Accounts",
        columns: [
          { key: "displayName", label: "Account" },
          { key: "userPrincipalName", label: "User principal name" },
          { key: "client", label: "Client" },
          { key: "tenant", label: "Tenant" },
          { key: "state", label: "State" },
          { key: "lastSignIn", label: "Last sign-in" },
          { key: "days", label: "Days", align: "right" },
          { key: "title", label: "Job title" },
        ],
        rows: accounts.map(row => ({
          displayName: text(row.displayName),
          userPrincipalName: text(row.userPrincipalName),
          client: text(row.clientName),
          tenant: text(row.tenantName),
          state: text(row.stateLabel),
          lastSignIn: text(row.lastSignInDisplay),
          days: row.daysSinceSignIn === null || row.daysSinceSignIn === undefined ? "—" : number(row.daysSinceSignIn),
          title: text(row.jobTitle, ""),
        })),
        emptyText: "No accounts match these options.",
      },
      ...(payload.truncated ? [{ kind: "notes", tone: "warn", title: "Truncated", items: ["Only the 500 worst accounts are listed. Narrow it to one client or one tenant for the rest."] } as Section] : []),
      ...(notes.length ? [{ kind: "notes", tone: "warn", title: "How to read this", items: notes } as Section] : []),
    ];
  },
};

export const STANDARD_REPORTS: StandardReport[] = [
  ticketVolume,
  sla,
  utilization,
  revenue,
  aging,
  timeTracking,
  csat,
  contract,
  clientValue,
  m365Inactive,
  weeklyReview,
  monthlyReview,
  qbr,
];

export const REPORT_BY_ID = new Map(STANDARD_REPORTS.map(r => [r.id, r]));
/** The three business reviews share one builder, so the screen can switch cadence without a reload. */
export const REVIEW_REPORTS = [weeklyReview, monthlyReview, qbr];

/** The types a saved report can be given, so the custom-report editor offers the same list. */
export const REPORT_TYPE_OPTIONS = [
  { value: "custom", label: "Custom (config-driven)" },
  ...STANDARD_REPORTS.map(r => ({ value: r.id === "ticket-volume" ? "ticket_summary" : r.id, label: r.title })),
  { value: "time", label: "Time Tracking" },
];