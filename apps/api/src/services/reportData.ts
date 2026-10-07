/**
 * Report data (PLAN-020).
 *
 * Every standard report is computed here rather than in the route, so the route file stays a list
 * of endpoints and one report's numbers can be read without reading the other nine. The rules this
 * module holds to:
 *
 *   1. **Nothing is invented.** Two reports used to fabricate their figures with `Math.random()`
 *      (satisfaction scores, agreement costs). A report that guesses is worse than one that says
 *      what it cannot see, so a figure that has no source is now reported as unavailable with the
 *      reason attached (`costBasis.hoursWithoutCostRate`, `coverage.note`).
 *   2. **A total is never taken from a page of rows.** The previous time-tracking report summed
 *      `take: 200` and called it the total. Totals come from `aggregate`/`groupBy`; the row list is
 *      a separate, clearly-limited sample.
 *   3. **Client scoping cannot be widened by a query parameter.** A request may narrow to a client
 *      or a board; it can never name a client the account is not already scoped to.
 *   4. **A period is optional and stated.** With no `from`/`to` the report covers all time and says
 *      so, which keeps the dashboard's existing numbers exactly as they were.
 */
import { prisma } from "../index";
import { companyWhere } from "../middleware/companyScope";
import type { AuthUser } from "../middleware/auth";

export interface ReportPeriod {
  from: string | null;
  to: string | null;
  /** What the UI prints above the numbers: an explicit range, or "All time". */
  label: string;
  days: number | null;
  clientId: string | null;
  clientName: string | null;
  boardId: string | null;
  boardName: string | null;
}

const CLOSED_STATUSES = ["resolved", "closed", "cancelled"];

/**
 * Reads a date parameter. A plain `YYYY-MM-DD` is taken as a calendar day in the reader's own
 * timezone — `new Date("2026-08-01")` is UTC midnight, which renders as 31 July west of Greenwich
 * and would have made every date-range filter off by one day. An ISO timestamp is taken as given.
 */
function parseDate(value: unknown, endOfDay = false): Date | null {
  if (typeof value !== "string" || !value.trim()) return null;
  const text = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const [year, month, day] = text.split("-").map(Number) as [number, number, number];
    return endOfDay ? new Date(year, month - 1, day, 23, 59, 59, 999) : new Date(year, month - 1, day, 0, 0, 0, 0);
  }
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? null : date;
}

const asString = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);

/**
 * Reads the period, client and board a report was asked for. A date range given as plain
 * `YYYY-MM-DD` is treated as whole days in both directions, so an export that says "to the 7th"
 * includes the 7th rather than stopping at midnight.
 */
export async function parsePeriod(query: Record<string, unknown>, user?: AuthUser): Promise<ReportPeriod> {
  const from = parseDate(query.from);
  const to = parseDate(query.to, true);
  const scopedCompany = companyWhere(user).companyId ?? null;
  const requestedClient = asString(query.clientId);
  const clientId = scopedCompany ?? requestedClient;
  const boardId = asString(query.boardId);

  const [client, board] = await Promise.all([
    clientId ? prisma.company.findUnique({ where: { id: clientId }, select: { name: true } }) : null,
    boardId ? prisma.serviceBoard.findUnique({ where: { id: boardId }, select: { name: true } }) : null,
  ]);

  const days = from && to ? Math.max(1, Math.round((to.getTime() - from.getTime()) / 86400000)) : null;
  const fmt = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return {
    from: from ? from.toISOString() : null,
    to: to ? to.toISOString() : null,
    label: from && to ? `${fmt(from)} – ${fmt(to)}` : "All time",
    days,
    clientId,
    clientName: client?.name ?? null,
    boardId,
    boardName: board?.name ?? null,
  };
}

/** The client restriction for a report: a scoped account can only ever see its own company. */
function companyFilter(period: ReportPeriod): { companyId?: string } {
  return period.clientId ? { companyId: period.clientId } : {};
}

/** The same restriction for a model that reaches its client through a ticket. */
function ticketCompanyFilter(period: ReportPeriod): Record<string, unknown> {
  return period.clientId ? { ticket: { companyId: period.clientId } } : {};
}

function dateRange(field: string, period: ReportPeriod): Record<string, unknown> {
  if (!period.from && !period.to) return {};
  const range: Record<string, Date> = {};
  if (period.from) range.gte = new Date(period.from);
  if (period.to) range.lte = new Date(period.to);
  return { [field]: range };
}

/** `{ createdAt: { gte, lte } }` plus the client/board filters a ticket report was asked for. */
function ticketScope(period: ReportPeriod, dateField = "createdAt"): Record<string, unknown> {
  const where: Record<string, unknown> = { ...companyFilter(period), ...dateRange(dateField, period) };
  if (period.boardId) where.boardId = period.boardId;
  return where;
}

const hours = (minutes: number) => +(minutes / 60).toFixed(2);
const money = (value: number) => +value.toFixed(2);
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);

/** How many times a year a billing period is charged — a one-off nothing. */
const PERIODS_PER_YEAR: Record<string, number> = { monthly: 12, quarterly: 4, annual: 1, yearly: 1 };
const annualise = (amount: number, billingPeriod: string): number => amount * (PERIODS_PER_YEAR[billingPeriod] ?? 0);
const nameOf = (user?: { firstName: string; lastName: string } | null) => (user ? `${user.firstName} ${user.lastName}` : "Unassigned");

/**
 * Durations in milliseconds that are worth averaging. A record whose end precedes its start is a
 * data defect, not a fast resolution, so it is excluded from every average and counted once so the
 * report can say it happened rather than printing a negative duration.
 */
function durations(from: Array<{ start: Date | null; end?: Date | null; createdAt?: Date; resolvedAt?: Date | null }>) {
  const valid: number[] = [];
  let impossible = 0;
  for (const row of from) {
    const start = row.start ?? row.createdAt ?? null;
    const end = row.end ?? row.resolvedAt ?? null;
    if (!start || !end) continue;
    const ms = end.getTime() - start.getTime();
    if (ms < 0) impossible++;
    else valid.push(ms);
  }
  return { averageMinutes: valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null, count: valid.length, impossible };
}

/** "1 invoice" / "3 invoices" — a report that says "1 invoices" reads as a bug. */
const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${count} ${count === 1 ? singular : pluralForm}`;

/** The sentence a report uses when a record's end date precedes its start date. */
const impossibleDurationNote = (count: number) =>
  `${plural(count, "ticket")} ${count === 1 ? "has a resolution date" : "have resolution dates"} before ${count === 1 ? "its" : "their"} creation date and ${count === 1 ? "was" : "were"} left out of the averages.`;

async function nameMaps() {
  const [boards, users, companies] = await Promise.all([
    prisma.serviceBoard.findMany({ select: { id: true, name: true, slaResponseMinutes: true, slaResolutionMinutes: true } }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true } }),
    prisma.company.findMany({ select: { id: true, name: true, industry: true } }),
  ]);
  return {
    boardById: new Map(boards.map(b => [b.id, b])),
    userById: new Map(users.map(u => [u.id, u])),
    companyById: new Map(companies.map(c => [c.id, c])),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  1. Ticket volume
// ═══════════════════════════════════════════════════════════════════

export async function ticketVolumeReport(user: AuthUser | undefined, period: ReportPeriod) {
  const where = ticketScope(period);
  const tickets = await prisma.ticket.findMany({
    where,
    select: {
      id: true, ticketNumber: true, title: true, status: true, priority: true, source: true,
      createdAt: true, firstResponseAt: true, resolvedAt: true, closedAt: true, dueDate: true,
      boardId: true, assignedToId: true, companyId: true, categoryId: true,
    },
  });
  const { boardById, userById, companyById } = await nameMaps();

  const open = tickets.filter(t => !CLOSED_STATUSES.includes(t.status));
  const resolvedTickets = tickets.filter(t => t.resolvedAt);
  const resolution = durations(resolvedTickets.map(t => ({ start: t.createdAt, end: t.resolvedAt })));
  const responded = tickets.filter(t => t.firstResponseAt);
  const responseMinutes = responded.map(t => (t.firstResponseAt!.getTime() - t.createdAt.getTime()) / 60000);
  const now = Date.now();

  // Volume over time. A range of two months or less is read by day; anything longer by month.
  const byDay = period.days !== null && period.days <= 62;
  const buckets = new Map<string, { period: string; opened: number; closed: number }>();
  const keyFor = (d: Date) => (byDay ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));
  for (const t of tickets) {
    const key = keyFor(t.createdAt);
    if (!buckets.has(key)) buckets.set(key, { period: key, opened: 0, closed: 0 });
    buckets.get(key)!.opened++;
    const closedAt = t.closedAt ?? t.resolvedAt;
    if (closedAt) {
      const closedKey = keyFor(closedAt);
      if (!buckets.has(closedKey)) buckets.set(closedKey, { period: closedKey, opened: 0, closed: 0 });
      buckets.get(closedKey)!.closed++;
    }
  }

  const countBy = <T extends string>(pick: (t: typeof tickets[number]) => T | null, label: (k: T) => string) => {
    const map = new Map<T, number>();
    for (const t of tickets) {
      const key = pick(t) ?? ("unassigned" as T);
      map.set(key, (map.get(key) ?? 0) + 1);
    }
    return [...map.entries()].map(([key, count]) => ({ key, label: label(key), count })).sort((a, b) => b.count - a.count);
  };

  return {
    period,
    total: tickets.length,
    open: open.length,
    closed: resolvedTickets.length,
    backlogPct: pct(open.length, tickets.length),
    unassigned: tickets.filter(t => !t.assignedToId).length,
    overdue: open.filter(t => t.dueDate && t.dueDate.getTime() < now).length,
    byStatus: countBy(t => t.status as string, k => k.replace(/_/g, " ")),
    byPriority: countBy(t => t.priority as string, k => k),
    bySource: countBy(t => t.source as string, k => k.replace(/_/g, " ")),
    byBoard: countBy(t => t.boardId as string, k => boardById.get(k)?.name ?? k),
    byAssignee: countBy(t => t.assignedToId as string | null, k => (k === "unassigned" ? "Unassigned" : nameOf(userById.get(k)))),
    byClient: countBy(t => t.companyId as string, k => companyById.get(k)?.name ?? k).slice(0, 15),
    trend: [...buckets.values()].sort((a, b) => a.period.localeCompare(b.period)),
    averages: {
      firstResponseMinutes: responseMinutes.length ? Math.round(responseMinutes.reduce((a, b) => a + b, 0) / responseMinutes.length) : null,
      resolutionMinutes: resolution.averageMinutes,
      ageDaysOpen: open.length ? +(open.reduce((sum, t) => sum + (now - t.createdAt.getTime()) / 86400000, 0) / open.length).toFixed(1) : null,
      ageDaysClosed: resolution.averageMinutes !== null ? +(resolution.averageMinutes / 1440).toFixed(1) : null,
    },
    dataQuality: resolution.impossible > 0
      ? { impossibleResolutions: resolution.impossible, note: impossibleDurationNote(resolution.impossible) }
      : { impossibleResolutions: 0, note: null },
    oldestOpen: open
      .slice()
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .slice(0, 10)
      .map(t => ({
        ticketNumber: t.ticketNumber,
        title: t.title,
        status: t.status,
        priority: t.priority,
        client: companyById.get(t.companyId)?.name ?? "—",
        assignedTo: t.assignedToId ? nameOf(userById.get(t.assignedToId)) : "Unassigned",
        board: boardById.get(t.boardId)?.name ?? "—",
        ageDays: Math.round((now - t.createdAt.getTime()) / 86400000),
      })),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  2. SLA performance
// ═══════════════════════════════════════════════════════════════════

/**
 * A ticket is judged against its board's targets. "Awaiting" is its own outcome rather than a
 * breach: a ticket opened an hour ago has not missed a four-hour response target, and the old
 * report counted it as either met or breached depending on which way it happened to fall.
 */
/**
 * A ticket is judged against its board's targets. Four outcomes rather than two: "missed" is a
 * target passed with nothing recorded against it, which is a different problem from "breached" (a
 * reply or fix arrived, but late), and "awaiting" is a ticket still inside its target.
 *
 * The first response is `firstResponseAt` when the ticket carries one and otherwise our earliest
 * public reply on the ticket — a comment written by an internal account. Most of this data predates
 * the stamp, and a report that called every one of those a breach would be reporting on its own
 * missing column rather than on the service.
 */
export async function slaReport(user: AuthUser | undefined, period: ReportPeriod) {
  const scope = ticketScope(period);
  const tickets = await prisma.ticket.findMany({
    where: { ...scope, status: { notIn: ["cancelled"] } },
    select: {
      id: true, ticketNumber: true, title: true, status: true, priority: true, createdAt: true,
      firstResponseAt: true, resolvedAt: true, boardId: true, assignedToId: true, companyId: true,
      slaResponseDue: true, slaResolutionDue: true,
    },
  });

  const firstStaffReplies = await prisma.ticketComment.groupBy({
    by: ["ticketId"],
    where: { isInternal: false, author: { companyId: null }, ticket: { ...scope } },
    _min: { createdAt: true },
  });
  const replyByTicket = new Map(firstStaffReplies.map(r => [r.ticketId, r._min.createdAt]));

  const { boardById, userById, companyById } = await nameMaps();
  const now = Date.now();

  type Outcome = "met" | "breached" | "missed" | "awaiting";
  interface Row {
    ticketNumber: string; title: string; status: string; priority: string;
    board: string; assignedTo: string; client: string; ageMinutes: number;
    responseMinutes: number | null; resolutionMinutes: number | null;
    responseSource: "stamp" | "reply" | "none";
    responseOutcome: Outcome; resolutionOutcome: Outcome;
  }

  let impossibleResolutions = 0;

  const rows: Row[] = tickets.map(t => {
    const board = boardById.get(t.boardId);
    const responseTarget = board?.slaResponseMinutes ?? 240;
    const resolutionTarget = board?.slaResolutionMinutes ?? 1440;
    const ageMinutes = Math.round((now - t.createdAt.getTime()) / 60000);
    const stamped = t.firstResponseAt ? Math.round((t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000) : null;
    const reply = replyByTicket.get(t.id);
    const replied = reply && reply >= t.createdAt ? Math.round((reply.getTime() - t.createdAt.getTime()) / 60000) : null;
    const responseMinutes = stamped ?? replied;
    const responseSource: Row["responseSource"] = stamped !== null ? "stamp" : replied !== null ? "reply" : "none";

    let resolutionMinutes: number | null = null;
    if (t.resolvedAt) {
      const ms = t.resolvedAt.getTime() - t.createdAt.getTime();
      if (ms < 0) impossibleResolutions++;
      else resolutionMinutes = Math.round(ms / 60000);
    }

    const outcome = (actual: number | null, target: number): Outcome =>
      actual !== null ? (actual <= target ? "met" : "breached") : (ageMinutes > target ? "missed" : "awaiting");

    return {
      ticketNumber: t.ticketNumber,
      title: t.title,
      status: t.status,
      priority: t.priority,
      board: board?.name ?? "—",
      assignedTo: t.assignedToId ? nameOf(userById.get(t.assignedToId)) : "Unassigned",
      client: companyById.get(t.companyId)?.name ?? "—",
      ageMinutes,
      responseMinutes,
      resolutionMinutes,
      responseSource,
      responseOutcome: outcome(responseMinutes, responseTarget),
      resolutionOutcome: outcome(resolutionMinutes, resolutionTarget),
    };
  });

  const tally = (pick: (r: Row) => Outcome) => ({
    met: rows.filter(r => pick(r) === "met").length,
    breached: rows.filter(r => pick(r) === "breached").length,
    missed: rows.filter(r => pick(r) === "missed").length,
    awaiting: rows.filter(r => pick(r) === "awaiting").length,
  });

  const tallyOf = (groupRows: Row[], pick: (r: Row) => Outcome) => ({
    met: groupRows.filter(r => pick(r) === "met").length,
    breached: groupRows.filter(r => pick(r) === "breached").length,
    missed: groupRows.filter(r => pick(r) === "missed").length,
    awaiting: groupRows.filter(r => pick(r) === "awaiting").length,
  });

  /** One group's compliance, for the by-board and by-technician tables. */
  const group = (key: (r: Row) => string) => {
    const map = new Map<string, Row[]>();
    for (const row of rows) map.set(key(row), [...(map.get(key(row)) ?? []), row]);
    return [...map.entries()]
      .map(([label, groupRows]) => {
        const response = tallyOf(groupRows, r => r.responseOutcome);
        const resolution = tallyOf(groupRows, r => r.resolutionOutcome);
        // Compliance is measured against every ticket with a verdict, missed ones included — a
        // target passed with no reply is a failure of the target whether or not anyone replied.
        const decided = response.met + response.breached + response.missed;
        const resolutionDecided = resolution.met + resolution.breached + resolution.missed;
        const responseTimes = groupRows.map(r => r.responseMinutes).filter((m): m is number => m !== null);
        return {
          label,
          tickets: groupRows.length,
          metResponse: response.met,
          breachedResponse: response.breached,
          missedResponse: response.missed,
          awaitingResponse: response.awaiting,
          responseCompliancePct: pct(response.met, decided),
          metResolution: resolution.met,
          breachedResolution: resolution.breached,
          missedResolution: resolution.missed,
          awaitingResolution: resolution.awaiting,
          resolutionCompliancePct: pct(resolution.met, resolutionDecided),
          avgResponseMinutes: responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
        };
      })
      .sort((a, b) => b.tickets - a.tickets);
  };

  const response = tally(r => r.responseOutcome);
  const resolution = tally(r => r.resolutionOutcome);
  const responseTimes = rows.map(r => r.responseMinutes).filter((m): m is number => m !== null);
  const resolutionTimes = rows.map(r => r.resolutionMinutes).filter((m): m is number => m !== null);
  const fromStamp = rows.filter(r => r.responseSource === "stamp").length;
  const fromReply = rows.filter(r => r.responseSource === "reply").length;
  const noResponse = rows.filter(r => r.responseSource === "none").length;

  return {
    period,
    evaluated: rows.length,
    response,
    resolution,
    responseCompliancePct: pct(response.met, response.met + response.breached + response.missed),
    resolutionCompliancePct: pct(resolution.met, resolution.met + resolution.breached + resolution.missed),
    avgResponseMinutes: responseTimes.length ? Math.round(responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length) : null,
    avgResolutionMinutes: resolutionTimes.length ? Math.round(resolutionTimes.reduce((a, b) => a + b, 0) / resolutionTimes.length) : null,
    responseSources: { stamp: fromStamp, reply: fromReply, none: noResponse },
    dataQuality: {
      impossibleResolutions,
      note: impossibleResolutions > 0 ? impossibleDurationNote(impossibleResolutions) : null,
    },
    byBoard: group(r => r.board),
    byTechnician: group(r => r.assignedTo),
    breaches: rows
      .filter(r => r.responseOutcome !== "met" && r.responseOutcome !== "awaiting" || (r.resolutionOutcome !== "met" && r.resolutionOutcome !== "awaiting"))
      .sort((a, b) => b.ageMinutes - a.ageMinutes)
      .slice(0, 15)
      .map(r => ({
        ticketNumber: r.ticketNumber, title: r.title, client: r.client, board: r.board, assignedTo: r.assignedTo,
        status: r.status, priority: r.priority, ageHours: Math.round(r.ageMinutes / 60),
        responseOutcome: r.responseOutcome, resolutionOutcome: r.resolutionOutcome,
      })),
    note: rows.length === 0
      ? "No tickets fall in this period."
      : `${plural(response.awaiting, "ticket")} are still inside their response target, ${response.breached} were answered late and ${response.missed} passed their target with no reply recorded.`,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  3. Technician utilization
// ═══════════════════════════════════════════════════════════════════

/** Weekdays between two dates — the capacity basis, stated on the report rather than assumed silently. */
function weekdaysBetween(from: Date | null, to: Date | null): number {
  if (!from || !to) return 0;
  let days = 0;
  const cursor = new Date(from);
  while (cursor <= to) {
    const day = cursor.getDay();
    if (day !== 0 && day !== 6) days++;
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

export async function utilizationReport(user: AuthUser | undefined, period: ReportPeriod) {
  const entries = await prisma.timeEntry.findMany({
    where: { ...ticketCompanyFilter(period), ...dateRange("date", period) },
    select: { userId: true, minutes: true, billable: true, noCharge: true, overtimeMinutes: true, billedMinutes: true, rate: true },
  });
  const { userById } = await nameMaps();

  // Throughput comes from the tickets themselves, so a technician with no closed tickets still
  // appears when they logged time, and one who closed tickets without logging time appears too.
  const tickets = await prisma.ticket.findMany({
    where: ticketScope(period),
    select: { assignedToId: true, status: true, resolvedAt: true, createdAt: true },
  });

  const staff = await prisma.user.findMany({
    where: { isActive: true, companyId: null },
    select: { id: true, firstName: true, lastName: true, department: true, title: true, costRate: true },
    orderBy: [{ firstName: "asc" }],
  });

  const weekdays = weekdaysBetween(period.from ? new Date(period.from) : null, period.to ? new Date(period.to) : null);
  const capacityMinutes = weekdays * 8 * 60;

  const rows = staff.map(person => {
    const theirs = entries.filter(e => e.userId === person.id);
    const billableMinutes = theirs.filter(e => e.billable).reduce((s, e) => s + e.minutes, 0);
    const nonBillableMinutes = theirs.filter(e => !e.billable).reduce((s, e) => s + e.minutes, 0);
    const noChargeMinutes = theirs.filter(e => e.noCharge).reduce((s, e) => s + e.minutes, 0);
    const overtimeMinutes = theirs.reduce((s, e) => s + (e.overtimeMinutes ?? 0), 0);
    const valueRecorded = theirs.reduce((s, e) => s + ((e.billedMinutes ?? e.minutes) / 60) * (e.rate ?? 0), 0);
    const cost = person.costRate ? (theirs.reduce((s, e) => s + e.minutes, 0) / 60) * person.costRate : null;
    const assigned = tickets.filter(t => t.assignedToId === person.id);
    const closed = assigned.filter(t => t.resolvedAt);
    const open = assigned.filter(t => !CLOSED_STATUSES.includes(t.status));
    const closedDurations = durations(closed.map(t => ({ start: t.createdAt, end: t.resolvedAt })));
    const totalLogged = billableMinutes + nonBillableMinutes;
    return {
      userId: person.id,
      name: `${person.firstName} ${person.lastName}`,
      department: person.department ?? "",
      title: person.title ?? "",
      billableMinutes,
      nonBillableMinutes,
      noChargeMinutes,
      overtimeMinutes,
      totalMinutes: totalLogged,
      billablePct: pct(billableMinutes, totalLogged),
      /** Against an 8-hour weekday, and only when the report was given a period to measure. */
      capacityMinutes: capacityMinutes || null,
      utilizationPct: capacityMinutes ? pct(totalLogged, capacityMinutes) : null,
      ticketsAssigned: assigned.length,
      ticketsClosed: closed.length,
      ticketsOpen: open.length,
      avgHoursPerTicketClosed: closedDurations.averageMinutes !== null ? +(closedDurations.averageMinutes / 60).toFixed(1) : null,
      valueRecorded: money(valueRecorded),
      labourCost: cost === null ? null : money(cost),
      costRate: person.costRate ?? null,
    };
  }).filter(r => r.totalMinutes > 0 || r.ticketsAssigned > 0);

  return {
    period,
    capacityBasis: period.days ? `${weekdays} weekdays × 8 hours in the period` : "Not measured — give the report a date range for a utilization percentage",
    totals: {
      staff: rows.length,
      billableMinutes: rows.reduce((s, r) => s + r.billableMinutes, 0),
      nonBillableMinutes: rows.reduce((s, r) => s + r.nonBillableMinutes, 0),
      ticketsClosed: rows.reduce((s, r) => s + r.ticketsClosed, 0),
      valueRecorded: money(rows.reduce((s, r) => s + r.valueRecorded, 0)),
      labourCost: money(rows.reduce((s, r) => s + (r.labourCost ?? 0), 0)),
      withoutCostRate: rows.filter(r => r.costRate === null).length,
    },
    technicians: rows.sort((a, b) => b.totalMinutes - a.totalMinutes),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  4. Revenue
// ═══════════════════════════════════════════════════════════════════

const OPEN_INVOICE_STATUSES = ["sent", "partial", "overdue"];

export async function revenueReport(user: AuthUser | undefined, period: ReportPeriod) {
  const scope = companyFilter(period);
  const inPeriod = dateRange("issueDate", period);
  const now = new Date();

  const [invoices, payments, byClientCompanies] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...scope, ...(period.from || period.to ? inPeriod : {}) },
      select: {
        id: true, invoiceNumber: true, status: true, issueDate: true, dueDate: true, paidAt: true,
        subtotal: true, taxTotal: true, total: true, companyId: true, agreementId: true,
        payments: { select: { amount: true, method: true, processedAt: true } },
      },
    }),
    prisma.payment.findMany({
      where: { invoice: { ...scope }, ...dateRange("processedAt", period) },
      select: { amount: true, method: true, processedAt: true, invoice: { select: { invoiceNumber: true, companyId: true } } },
    }),
    prisma.company.findMany({ where: { isActive: true, ...scope }, select: { id: true, name: true } }),
  ]);

  const allTimePaid = await prisma.invoice.aggregate({ _sum: { total: true }, where: { status: "paid", ...scope } });
  const outstandingWhere = { status: { in: OPEN_INVOICE_STATUSES }, ...scope };
  const outstanding = await prisma.invoice.findMany({
    where: outstandingWhere,
    select: { total: true, dueDate: true, companyId: true, invoiceNumber: true, issueDate: true },
  });

  const invoicedInPeriod = invoices.reduce((s, i) => s + i.total, 0);
  const collectedInPeriod = payments.reduce((s, p) => s + p.amount, 0);

  // Invoiced and collected per month, kept together so a chart can show the gap between them.
  const monthly = new Map<string, { month: string; invoiced: number; collected: number }>();
  const monthKey = (d: Date) => d.toISOString().slice(0, 7);
  for (const i of invoices) {
    const key = monthKey(i.issueDate);
    if (!monthly.has(key)) monthly.set(key, { month: key, invoiced: 0, collected: 0 });
    monthly.get(key)!.invoiced += i.total;
  }
  for (const p of payments) {
    const key = monthKey(p.processedAt);
    if (!monthly.has(key)) monthly.set(key, { month: key, invoiced: 0, collected: 0 });
    monthly.get(key)!.collected += p.amount;
  }

  const buckets = [
    { label: "Not yet due", min: -Infinity, max: 0 },
    { label: "1–30 days", min: 0, max: 30 },
    { label: "31–60 days", min: 30, max: 60 },
    { label: "61–90 days", min: 60, max: 90 },
    { label: "Over 90 days", min: 90, max: Infinity },
  ];
  const aging = buckets.map(b => {
    const matching = outstanding.filter(i => {
      const overdueDays = (now.getTime() - i.dueDate.getTime()) / 86400000;
      return overdueDays > b.min && overdueDays <= b.max;
    });
    return { label: b.label, invoices: matching.length, amount: money(matching.reduce((s, i) => s + i.total, 0)) };
  });

  const clientRows = byClientCompanies.map(c => {
    const theirs = invoices.filter(i => i.companyId === c.id);
    const owed = outstanding.filter(i => i.companyId === c.id);
    const paid = theirs.reduce((s, i) => s + i.payments.reduce((ps, p) => ps + p.amount, 0), 0);
    return {
      client: c.name,
      invoiced: money(theirs.reduce((s, i) => s + i.total, 0)),
      collected: money(paid),
      outstanding: money(owed.reduce((s, i) => s + i.total, 0)),
      invoices: theirs.length,
      oldestOverdueDays: owed.length ? Math.max(0, Math.round(Math.max(...owed.map(i => (now.getTime() - i.dueDate.getTime()) / 86400000)))) : 0,
    };
  }).filter(r => r.invoiced > 0 || r.outstanding > 0).sort((a, b) => b.invoiced - a.invoiced);

  const byMethod = new Map<string, { method: string; payments: number; amount: number }>();
  for (const p of payments) {
    const row = byMethod.get(p.method) ?? { method: p.method, payments: 0, amount: 0 };
    row.payments++;
    row.amount = money(row.amount + p.amount);
    byMethod.set(p.method, row);
  }

  return {
    period,
    invoicedInPeriod: money(invoicedInPeriod),
    collectedInPeriod: money(collectedInPeriod),
    totalPaidAllTime: money(allTimePaid._sum.total ?? 0),
    totalOutstanding: money(outstanding.reduce((s, i) => s + i.total, 0)),
    totalOverdue: money(outstanding.filter(i => i.dueDate < now).reduce((s, i) => s + i.total, 0)),
    collectionRate: pct(collectedInPeriod, invoicedInPeriod),
    averageInvoice: money(invoices.length ? invoicedInPeriod / invoices.length : 0),
    taxCollected: money(invoices.reduce((s, i) => s + i.taxTotal, 0)),
    invoiceCount: invoices.length,
    paidCount: invoices.filter(i => i.status === "paid").length,
    openCount: outstanding.length,
    monthlyRevenue: [...monthly.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .slice(-24)
      .map(m => ({ month: m.month, invoiced: money(m.invoiced), collected: money(m.collected) })),
    aging,
    byClient: clientRows.slice(0, 15),
    byMethod: [...byMethod.values()].sort((a, b) => b.amount - a.amount),
    largestOutstanding: outstanding
      .slice()
      .sort((a, b) => b.total - a.total)
      .slice(0, 10)
      .map(i => ({
        invoiceNumber: i.invoiceNumber,
        client: byClientCompanies.find(c => c.id === i.companyId)?.name ?? "—",
        amount: money(i.total),
        issued: i.issueDate.toISOString().slice(0, 10),
        due: i.dueDate.toISOString().slice(0, 10),
        daysOverdue: Math.max(0, Math.round((now.getTime() - i.dueDate.getTime()) / 86400000)),
      })),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  5. Ticket aging
// ═══════════════════════════════════════════════════════════════════

export async function agingReport(user: AuthUser | undefined, period: ReportPeriod) {
  const tickets = await prisma.ticket.findMany({
    where: { ...ticketScope(period), status: { notIn: CLOSED_STATUSES } },
    select: {
      ticketNumber: true, title: true, status: true, priority: true, createdAt: true, updatedAt: true,
      dueDate: true, boardId: true, assignedToId: true, companyId: true,
    },
  });
  const { boardById, userById, companyById } = await nameMaps();
  const now = Date.now();

  const withAge = tickets.map(t => ({
    ...t,
    ageDays: (now - t.createdAt.getTime()) / 86400000,
    idleDays: (now - t.updatedAt.getTime()) / 86400000,
  }));

  const bucketDefs = [
    { key: "lessThan1Day", label: "Under 1 day", test: (d: number) => d < 1 },
    { key: "oneTo3Days", label: "1–3 days", test: (d: number) => d >= 1 && d < 3 },
    { key: "threeTo7Days", label: "3–7 days", test: (d: number) => d >= 3 && d < 7 },
    { key: "sevenTo30Days", label: "7–30 days", test: (d: number) => d >= 7 && d < 30 },
    { key: "over30Days", label: "Over 30 days", test: (d: number) => d >= 30 },
  ];
  const buckets = bucketDefs.map(b => {
    const matching = withAge.filter(t => b.test(t.ageDays));
    return { key: b.key, label: b.label, count: matching.length, pct: pct(matching.length, withAge.length) };
  });

  const groupBy = (pick: (t: typeof withAge[number]) => string) => {
    const map = new Map<string, { open: number; totalAgeDays: number; over30: number }>();
    for (const t of withAge) {
      const key = pick(t);
      const row = map.get(key) ?? { open: 0, totalAgeDays: 0, over30: 0 };
      row.open++;
      row.totalAgeDays += t.ageDays;
      if (t.ageDays >= 30) row.over30++;
      map.set(key, row);
    }
    return [...map.entries()]
      .map(([label, r]) => ({ label, open: r.open, over30: r.over30, avgAgeDays: +(r.totalAgeDays / r.open).toFixed(1) }))
      .sort((a, b) => b.open - a.open);
  };

  return {
    period,
    total: withAge.length,
    buckets,
    byPriority: groupBy(t => t.priority),
    byBoard: groupBy(t => boardById.get(t.boardId)?.name ?? "—"),
    byClient: groupBy(t => companyById.get(t.companyId)?.name ?? "—").slice(0, 15),
    byAssignee: groupBy(t => (t.assignedToId ? nameOf(userById.get(t.assignedToId)) : "Unassigned")),
    averages: {
      ageDays: withAge.length ? +(withAge.reduce((s, t) => s + t.ageDays, 0) / withAge.length).toFixed(1) : null,
      idleDays: withAge.length ? +(withAge.reduce((s, t) => s + t.idleDays, 0) / withAge.length).toFixed(1) : null,
      oldestDays: withAge.length ? Math.round(Math.max(...withAge.map(t => t.ageDays))) : null,
    },
    stale: withAge.filter(t => t.idleDays >= 7).length,
    unassigned: withAge.filter(t => !t.assignedToId).length,
    waitingOnClient: withAge.filter(t => t.status === "waiting_on_client").length,
    oldest: withAge
      .slice()
      .sort((a, b) => b.ageDays - a.ageDays)
      .slice(0, 15)
      .map(t => ({
        ticketNumber: t.ticketNumber,
        title: t.title,
        client: companyById.get(t.companyId)?.name ?? "—",
        board: boardById.get(t.boardId)?.name ?? "—",
        assignedTo: t.assignedToId ? nameOf(userById.get(t.assignedToId)) : "Unassigned",
        status: t.status,
        priority: t.priority,
        ageDays: Math.round(t.ageDays),
        idleDays: Math.round(t.idleDays),
        due: t.dueDate ? t.dueDate.toISOString().slice(0, 10) : null,
      })),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  6. Time tracking
// ═══════════════════════════════════════════════════════════════════

export async function timeTrackingReport(user: AuthUser | undefined, period: ReportPeriod) {
  const where = { ...ticketCompanyFilter(period), ...dateRange("date", period) };

  // Totals from an aggregate, never from the page of rows below it.
  const [totals, entries] = await Promise.all([
    prisma.timeEntry.aggregate({
      where,
      _count: { id: true },
      _sum: { minutes: true, overtimeMinutes: true, billedMinutes: true },
      _avg: { minutes: true },
    }),
    prisma.timeEntry.findMany({
      where,
      orderBy: { date: "desc" },
      take: 250,
      select: {
        id: true, date: true, minutes: true, billable: true, noCharge: true, overtimeMinutes: true,
        billedMinutes: true, rate: true, workType: true, description: true,
        user: { select: { id: true, firstName: true, lastName: true } },
        ticket: { select: { ticketNumber: true, title: true, companyId: true } },
      },
    }),
  ]);

  const [billableSplit, noChargeTotals, byTechnician, byWorkType, byTicket] = await Promise.all([
    prisma.timeEntry.groupBy({ by: ["billable"], where, _count: { id: true }, _sum: { minutes: true } }),
    prisma.timeEntry.aggregate({ where: { ...where, noCharge: true }, _count: { id: true }, _sum: { minutes: true } }),
    prisma.timeEntry.groupBy({ by: ["userId"], where, _count: { id: true }, _sum: { minutes: true, overtimeMinutes: true, billedMinutes: true }, _avg: { minutes: true } }),
    prisma.timeEntry.groupBy({ by: ["workType"], where, _count: { id: true }, _sum: { minutes: true } }),
    prisma.timeEntry.groupBy({ by: ["ticketId"], where, _count: { id: true }, _sum: { minutes: true } }),
  ]);

  const { userById, companyById } = await nameMaps();
  const ticketsFor = byTicket.length
    ? await prisma.ticket.findMany({ where: { id: { in: byTicket.map(t => t.ticketId) } }, select: { id: true, ticketNumber: true, title: true, companyId: true } })
    : [];
  const ticketById = new Map(ticketsFor.map(t => [t.id, t]));

  const typedEntries = entries as Array<typeof entries[number] & { rate: number | null }>;
  const withRate = typedEntries.filter(e => e.rate);
  const withoutRate = typedEntries.length - withRate.length;

  // A per-day roll-up of the whole period, which is what the trend chart reads.
  const byDate = await prisma.$queryRaw<Array<{ day: Date; entries: bigint; minutes: bigint; billable: bigint }>>`
    SELECT date_trunc('day', te."date") AS day,
           COUNT(*) AS entries,
           SUM(te."minutes") AS minutes,
           SUM(CASE WHEN te."billable" THEN te."minutes" ELSE 0 END) AS billable
    FROM "TimeEntry" te
    JOIN "Ticket" t ON t."id" = te."ticketId"
    WHERE (${period.clientId}::text IS NULL OR t."companyId" = ${period.clientId}::text)
      AND (${period.from}::timestamptz IS NULL OR te."date" >= ${period.from}::timestamptz)
      AND (${period.to}::timestamptz IS NULL OR te."date" <= ${period.to}::timestamptz)
    GROUP BY 1
    ORDER BY 1 DESC`;

  return {
    period,
    totals: {
      entries: totals._count.id,
      minutes: totals._sum.minutes ?? 0,
      billableMinutes: billableSplit.find(b => b.billable)?._sum.minutes ?? 0,
      nonBillableMinutes: billableSplit.find(b => !b.billable)?._sum.minutes ?? 0,
      noChargeMinutes: noChargeTotals._sum.minutes ?? 0,
      overtimeMinutes: totals._sum.overtimeMinutes ?? 0,
      billedMinutes: totals._sum.billedMinutes ?? 0,
      averageEntryMinutes: totals._avg.minutes ? Math.round(totals._avg.minutes) : 0,
      valueRecorded: money(typedEntries.reduce((s, e) => s + ((e.billedMinutes ?? e.minutes) / 60) * (e.rate ?? 0), 0)),
    },
    byTechnician: byTechnician
      .map(t => ({
        technician: nameOf(userById.get(t.userId)),
        entries: t._count.id,
        minutes: t._sum.minutes ?? 0,
        billedMinutes: t._sum.billedMinutes ?? 0,
        overtimeMinutes: t._sum.overtimeMinutes ?? 0,
        averageEntryMinutes: t._avg.minutes ? Math.round(t._avg.minutes) : 0,
      }))
      .sort((a, b) => b.minutes - a.minutes),
    byWorkType: byWorkType
      .map(t => ({ workType: t.workType ?? "Unspecified", entries: t._count.id, minutes: t._sum.minutes ?? 0 }))
      .sort((a, b) => b.minutes - a.minutes),
    byTicket: byTicket
      .map(t => {
        const ticket = ticketById.get(t.ticketId);
        return {
          ticketNumber: ticket?.ticketNumber ?? "—",
          title: ticket?.title ?? "—",
          client: ticket ? companyById.get(ticket.companyId)?.name ?? "—" : "—",
          entries: t._count.id,
          minutes: t._sum.minutes ?? 0,
        };
      })
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 15),
    byDate: byDate.map(d => ({
      date: d.day.toISOString().slice(0, 10),
      entries: Number(d.entries),
      minutes: Number(d.minutes),
      billableMinutes: Number(d.billable),
    })),
    rows: typedEntries.map(e => ({
      date: e.date.toISOString().slice(0, 10),
      technician: `${e.user.firstName} ${e.user.lastName}`,
      ticketNumber: e.ticket?.ticketNumber ?? "—",
      ticketTitle: e.ticket?.title ?? "—",
      client: e.ticket ? companyById.get(e.ticket.companyId)?.name ?? "—" : "—",
      workType: e.workType ?? "—",
      minutes: e.minutes,
      billable: e.billable,
      noCharge: e.noCharge,
      rate: e.rate ?? null,
      description: e.description ?? "—",
    })),
    rowLimit: 250,
    pricing: {
      entriesWithRate: withRate.length,
      entriesWithoutRate: withoutRate,
      note: withoutRate > 0
        ? `${withoutRate} of the ${typedEntries.length} listed entries carry no rate, so they add nothing to "recorded value".`
        : "Every listed entry carries a rate.",
    },
  };
}

// ═══════════════════════════════════════════════════════════════════
//  7. Client satisfaction
// ═══════════════════════════════════════════════════════════════════

/**
 * Satisfaction from the survey responses the product actually stores. The old report generated
 * NPS scores, response rates and trends with `Math.random()`, which meant a client-facing number
 * that changed every time the page was refreshed and corresponded to nothing.
 *
 * There is no record of a survey being *sent* (only a flag on the survey that says it should be on
 * resolve), so "coverage" is measured against the tickets resolved in the same period and is
 * labelled as coverage rather than as a response rate.
 */
export async function csatReport(user: AuthUser | undefined, period: ReportPeriod) {
  const scope = companyFilter(period);
  const responses = await prisma.surveyResponse.findMany({
    where: { ...scope, ...dateRange("completedAt", period) },
    select: { id: true, surveyId: true, companyId: true, ticketId: true, npsScore: true, completedAt: true },
  });
  const { companyById } = await nameMaps();

  const resolvedRange = dateRange("resolvedAt", period);
  const resolved = await prisma.ticket.groupBy({
    by: ["companyId"],
    where: {
      ...companyFilter(period),
      resolvedAt: { not: null, ...(resolvedRange.resolvedAt as object | undefined) },
    },
    _count: { id: true },
  });
  const resolvedByClient = new Map(resolved.map(r => [r.companyId, r._count.id]));

  const clientIds = [...new Set([...responses.map(r => r.companyId), ...resolvedByClient.keys()])]
    .filter((id): id is string => Boolean(id));

  const scoreOf = (r: { npsScore: number | null }) => r.npsScore ?? null;
  const scores = responses.map(scoreOf).filter((s): s is number => s !== null);

  const byClient = clientIds.map(id => {
    const theirs = responses.filter(r => r.companyId === id);
    const theirScores = theirs.map(scoreOf).filter((s): s is number => s !== null);
    const promoters = theirScores.filter(s => s >= 9).length;
    const passives = theirScores.filter(s => s >= 7 && s < 9).length;
    const detractors = theirScores.filter(s => s < 7).length;
    const resolvedCount = resolvedByClient.get(id) ?? 0;
    return {
      client: companyById.get(id)?.name ?? "—",
      responses: theirs.length,
      scored: theirScores.length,
      averageScore: theirScores.length ? +(theirScores.reduce((a, b) => a + b, 0) / theirScores.length).toFixed(1) : null,
      nps: theirScores.length ? Math.round(((promoters - detractors) / theirScores.length) * 100) : null,
      promoters,
      passives,
      detractors,
      resolvedTickets: resolvedCount,
      coveragePct: resolvedCount > 0 ? pct(theirs.length, resolvedCount) : null,
      lastResponseAt: theirs.length ? theirs.map(r => r.completedAt).sort((a, b) => b.getTime() - a.getTime())[0]!.toISOString().slice(0, 10) : null,
    };
  }).sort((a, b) => b.responses - a.responses);

  const surveys = await prisma.survey.findMany({ select: { id: true, name: true, type: true, isActive: true, sendOnResolve: true } });

  return {
    period,
    totals: {
      responses: responses.length,
      scored: scores.length,
      nps: scores.length ? Math.round(((scores.filter(s => s >= 9).length - scores.filter(s => s < 7).length) / scores.length) * 100) : null,
      averageScore: scores.length ? +(scores.reduce((a, b) => a + b, 0) / scores.length).toFixed(1) : null,
      promoters: scores.filter(s => s >= 9).length,
      passives: scores.filter(s => s >= 7 && s < 9).length,
      detractors: scores.filter(s => s < 7).length,
      resolvedTickets: [...resolvedByClient.values()].reduce((a, b) => a + b, 0),
    },
    distribution: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(score => ({ score, count: scores.filter(s => s === score).length })),
    byClient,
    surveys: surveys.map(s => ({
      name: s.name,
      type: s.type,
      isActive: s.isActive,
      sendOnResolve: s.sendOnResolve,
      responses: responses.filter(r => r.surveyId === s.id).length,
    })),
    note: responses.length === 0
      ? "No survey responses in this period. Satisfaction is reported from responses only — nothing is estimated."
      : "Coverage compares responses with the tickets resolved in the same period; a survey is sent on resolve when the survey itself is set to do so.",
  };
}

// ═══════════════════════════════════════════════════════════════════
//  8. Contract profitability
// ═══════════════════════════════════════════════════════════════════

/**
 * What each agreement earned and what it cost. Cost is built from three sources that are actually
 * recorded — labour at each person's internal cost rate, expenses on the client's tickets, and
 * product cost on invoice lines that came from the catalogue — and the hours with no cost rate are
 * reported so the margin's completeness can be judged. The old report multiplied revenue by a
 * random 0.4–0.7 and called the difference a margin.
 */
export async function contractProfitabilityReport(user: AuthUser | undefined, period: ReportPeriod) {
  const agreements = await prisma.serviceAgreement.findMany({
    where: { ...companyFilter(period) },
    select: {
      id: true, name: true, companyId: true, agreementType: true, billingPeriod: true, billingAmount: true,
      hourlyRate: true, blockHoursIncluded: true, blockHoursUsed: true, startDate: true, endDate: true, isActive: true,
      company: { select: { name: true } },
    },
    orderBy: { name: "asc" },
  });

  const agreementIds = agreements.map(a => a.id);
  const companyIds = [...new Set(agreements.map(a => a.companyId))];

  const [invoices, expenseRows, timeRows, users] = await Promise.all([
    prisma.invoice.findMany({
      where: { agreementId: { in: agreementIds } },
      select: { id: true, agreementId: true, status: true, total: true, issueDate: true, paidAt: true, payments: { select: { amount: true } }, lineItems: { select: { quantity: true, productId: true } } },
    }),
    prisma.expense.findMany({
      where: { companyId: { in: companyIds }, status: { in: ["approved", "billed"] }, ...dateRange("expenseDate", period) },
      select: { companyId: true, amount: true },
    }),
    prisma.timeEntry.findMany({
      where: { ticket: { companyId: { in: companyIds } }, ...dateRange("date", period) },
      select: { userId: true, minutes: true, billable: true, billedMinutes: true, rate: true, ticket: { select: { companyId: true } } },
    }),
    prisma.user.findMany({ select: { id: true, firstName: true, lastName: true, costRate: true } }),
  ]);

  const userById = new Map(users.map(u => [u.id, u]));
  const inPeriod = (d: Date | null) => {
    if (!d) return false;
    if (period.from && d < new Date(period.from)) return false;
    if (period.to && d > new Date(period.to)) return false;
    return true;
  };

  // Product cost needs the catalogue's cost price, which is only on the product itself.
  const productIds = [...new Set(invoices.flatMap(i => i.lineItems.map(li => li.productId).filter((p): p is string => Boolean(p))))];
  const products = productIds.length
    ? await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, costPrice: true, sellPrice: true } })
    : [];
  const productById = new Map(products.map(p => [p.id, p]));

  const rows = agreements.map(a => {
    const theirs = invoices.filter(i => i.agreementId === a.id);
    const periodInvoices = period.from || period.to ? theirs.filter(i => inPeriod(i.issueDate)) : theirs;
    const invoiced = periodInvoices.reduce((s, i) => s + i.total, 0);
    const collected = periodInvoices.reduce((s, i) => s + i.payments.reduce((ps, p) => ps + p.amount, 0), 0);
    const outsidePeriod = theirs.reduce((s, i) => s + i.total, 0) - invoiced;

    const productCost = periodInvoices.reduce((sum, i) => sum + i.lineItems.reduce((ls, li) => {
      const product = li.productId ? productById.get(li.productId) : null;
      return ls + (product ? product.costPrice * li.quantity : 0);
    }, 0), 0);

    const entries = timeRows.filter(t => t.ticket.companyId === a.companyId);
    const minutes = entries.reduce((s, t) => s + t.minutes, 0);
    const billableMinutes = entries.filter(t => t.billable).reduce((s, t) => s + t.minutes, 0);
    const priced = entries.filter(t => userById.get(t.userId)?.costRate);
    const unpriced = entries.filter(t => !userById.get(t.userId)?.costRate);
    const labourCost = priced.reduce((s, t) => s + (t.minutes / 60) * (userById.get(t.userId)!.costRate ?? 0), 0);
    const unpricedHours = hours(unpriced.reduce((s, t) => s + t.minutes, 0));
    const expenses = expenseRows.filter(e => e.companyId === a.companyId).reduce((s, e) => s + e.amount, 0);

    const cost = labourCost + expenses + productCost;
    const margin = invoiced - cost;
    const allowance = a.blockHoursIncluded || 0;
    const allowanceUsed = a.agreementType === "block" || a.agreementType === "cyberCare" ? a.blockHoursUsed : null;

    return {
      agreement: a.name,
      client: a.company?.name ?? "—",
      type: a.agreementType,
      billingPeriod: a.billingPeriod,
      billingAmount: money(a.billingAmount),
      annualisedValue: money(annualise(a.billingAmount, a.billingPeriod)),
      hourlyRate: a.hourlyRate ?? null,
      isActive: a.isActive,
      startDate: a.startDate.toISOString().slice(0, 10),
      endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
      daysToRenewal: a.endDate ? Math.round((a.endDate.getTime() - Date.now()) / 86400000) : null,
      invoiced: money(invoiced),
      invoicedOutsidePeriod: money(outsidePeriod),
      collected: money(collected),
      outstanding: money(invoiced - collected),
      hoursDelivered: hours(minutes),
      billableHours: hours(billableMinutes),
      allowance,
      allowanceUsed,
      allowanceRemaining: allowance ? +(allowance - (allowanceUsed ?? 0)).toFixed(2) : null,
      costs: {
        labour: money(labourCost),
        expenses: money(expenses),
        products: money(productCost),
        total: money(cost),
      },
      margin: money(margin),
      marginPct: pct(margin, invoiced),
      effectiveHourlyRate: minutes > 0 ? money(invoiced / hours(minutes)) : null,
      costPerHourDelivered: minutes > 0 ? money(cost / hours(minutes)) : null,
      unpricedHours,
    };
  });

  const totals = {
    agreements: rows.length,
    annualisedValue: money(rows.filter(r => r.isActive).reduce((s, r) => s + r.annualisedValue, 0)),
    invoiced: money(rows.reduce((s, r) => s + r.invoiced, 0)),
    collected: money(rows.reduce((s, r) => s + r.collected, 0)),
    hoursDelivered: +rows.reduce((s, r) => s + r.hoursDelivered, 0).toFixed(2),
    labourCost: money(rows.reduce((s, r) => s + r.costs.labour, 0)),
    expenseCost: money(rows.reduce((s, r) => s + r.costs.expenses, 0)),
    productCost: money(rows.reduce((s, r) => s + r.costs.products, 0)),
    margin: money(rows.reduce((s, r) => s + r.margin, 0)),
    unpricedHours: +rows.reduce((s, r) => s + r.unpricedHours, 0).toFixed(2),
    renewalsNext90Days: rows.filter(r => r.daysToRenewal !== null && r.daysToRenewal >= 0 && r.daysToRenewal <= 90).length,
  };

  return {
    period,
    totals: { ...totals, marginPct: pct(totals.margin, totals.invoiced) },
    costBasis: {
      labour: "Time delivered × the person's internal cost rate",
      expenses: "Approved and billed expenses on the client's records",
      products: "Invoice lines that came from the Product Catalog, at cost price",
      hoursWithoutCostRate: totals.unpricedHours,
      note: totals.unpricedHours > 0
        ? `${totals.unpricedHours} hours have no internal cost rate recorded, so they add nothing to the labour cost above — the margin on those agreements reads better than it is.`
        : "Every delivered hour is priced at a recorded cost rate.",
    },
    agreements: rows.sort((a, b) => b.margin - a.margin),
  };
}

// ═══════════════════════════════════════════════════════════════════
//  9. Quarterly business review
// ═══════════════════════════════════════════════════════════════════

export interface Quarter { label: string; start: Date; end: Date; previous: { label: string; start: Date; end: Date } }

/**
 * The quarter a date falls in, and the one before it. Boundaries are built in UTC from the date's
 * UTC parts so a report means the same quarter whatever timezone the server runs in, and the end of
 * a quarter is the last millisecond of its last day rather than midnight of the next one.
 */
export function quarterOf(reference: Date): Quarter {
  const year = reference.getUTCFullYear();
  const startMonth = Math.floor(reference.getUTCMonth() / 3) * 3;
  const start = new Date(Date.UTC(year, startMonth, 1, 0, 0, 0, 0));
  const end = new Date(Date.UTC(year, startMonth + 3, 1, 0, 0, 0, 0) - 1);
  const prevStart = new Date(Date.UTC(year, startMonth - 3, 1, 0, 0, 0, 0));
  const prevEnd = new Date(start.getTime() - 1);
  const label = (d: Date) => `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  return { label: label(start), start, end, previous: { label: label(prevStart), start: prevStart, end: prevEnd } };
}

/** The most recently finished quarter — what a business review is normally about. */
export function lastCompletedQuarter(reference: Date): Quarter {
  return quarterOf(new Date(Date.UTC(reference.getUTCFullYear(), reference.getUTCMonth(), 1) - 86400000));
}

/** The eight quarters ending with the most recent completed one, for the report's picker. */
export function recentQuarters(reference: Date, count = 8): Array<{ label: string; from: string; to: string }> {
  const latest = lastCompletedQuarter(reference);
  const list: Array<{ label: string; from: string; to: string }> = [];
  for (let i = 0; i < count; i++) {
    const start = new Date(Date.UTC(latest.start.getUTCFullYear(), latest.start.getUTCMonth() - i * 3, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1) - 1);
    list.push({ label: `Q${Math.floor(start.getUTCMonth() / 3) + 1} ${start.getUTCFullYear()}`, from: start.toISOString(), to: end.toISOString() });
  }
  return list;
}

/**
 * The Quarterly Business Review: the shape of a QBR pack, assembled from the reports above so the
 * numbers a customer is shown in the meeting are the same numbers the team sees day to day. It is
 * deliberately additive — one quarter's service delivery, commercials, clients and risks — and it
 * says when a comparison cannot be made rather than printing a zero.
 */
export async function qbrReport(user: AuthUser | undefined, period: ReportPeriod) {
  const explicitFrom = period.from ? new Date(period.from) : null;
  const explicitTo = period.to ? new Date(period.to) : null;
  const now = new Date();

  // With no range the review is of the last *finished* quarter, which is what a business review is
  // normally about — reviewing a quarter that started yesterday would report almost nothing.
  const quarter = explicitFrom && explicitTo
    ? quarterOf(new Date(Date.UTC(explicitFrom.getUTCFullYear(), explicitFrom.getUTCMonth(), 1)))
    : lastCompletedQuarter(now);

  const rangeStart = explicitFrom ?? quarter.start;
  const rangeEnd = explicitTo ?? quarter.end;

  // A comparison has to be like for like. A finished quarter is compared with the whole quarter
  // before it; a quarter still in progress is compared with the same number of elapsed days of the
  // one before it, which is stated in the notes rather than left as a puzzle.
  const elapsedDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / 86400000) + 1);
  const quarterLength = Math.round((quarter.end.getTime() - quarter.start.getTime()) / 86400000) + 1;
  const partial = elapsedDays < quarterLength;
  const previousEnd = partial
    ? new Date(quarter.previous.start.getTime() + elapsedDays * 86400000 - 1)
    : quarter.previous.end;

  const window = { from: rangeStart.toISOString(), to: rangeEnd.toISOString() };
  const previousRange = { from: quarter.previous.start.toISOString(), to: previousEnd.toISOString() };

  const current = { ...period, ...window, label: explicitFrom ? period.label : quarter.label, days: elapsedDays };
  const previous = { ...period, ...previousRange, label: quarter.previous.label, days: Math.round((previousEnd.getTime() - quarter.previous.start.getTime()) / 86400000) + 1 };

  const [volume, priorVolume, sla, priorSla, time, priorTime, revenue, priorRevenue, csat, contracts, aging, util] = await Promise.all([
    ticketVolumeReport(user, current),
    ticketVolumeReport(user, previous),
    slaReport(user, current),
    slaReport(user, previous),
    timeTrackingReport(user, current),
    timeTrackingReport(user, previous),
    revenueReport(user, current),
    revenueReport(user, previous),
    csatReport(user, current),
    contractProfitabilityReport(user, current),
    agingReport(user, current),
    utilizationReport(user, current),
  ]);

  const topProducts = await prisma.invoiceLineItem.groupBy({
    by: ["productId"],
    where: {
      productId: { not: null },
      invoice: { ...companyFilter(period), ...dateRange("issueDate", current) },
    },
    _sum: { total: true, quantity: true },
    _count: { id: true },
  });
  const productNames = topProducts.length
    ? await prisma.product.findMany({ where: { id: { in: topProducts.map(p => p.productId!).filter(Boolean) } }, select: { id: true, name: true, sku: true, productType: true } })
    : [];
  const productById = new Map(productNames.map(p => [p.id, p]));

  const assets = await prisma.asset.findMany({
    where: { ...companyFilter(period) },
    select: { type: true, status: true, warrantyExpiry: true },
  });

  const delta = (now_: number, before: number) => (before > 0 ? Math.round(((now_ - before) / before) * 1000) / 10 : null);

  const highlights: string[] = [];
  const watchItems: string[] = [];

  if (priorVolume.total > 0) {
    const change = delta(volume.total, priorVolume.total);
    if (change !== null) highlights.push(`Ticket volume ${change >= 0 ? "rose" : "fell"} ${Math.abs(change)}% against ${quarter.previous.label} (${volume.total} vs ${priorVolume.total}).`);
  } else {
    watchItems.push(`No tickets were logged in ${quarter.previous.label}, so there is no volume comparison to make.`);
  }
  if (sla.responseCompliancePct) highlights.push(`Response compliance landed at ${sla.responseCompliancePct}% with ${plural(sla.response.met + sla.response.breached + sla.response.missed, "answered ticket")} against ${plural(sla.evaluated, "ticket")}.`);
  if (sla.response.breached > 0 || sla.response.missed > 0) {
    const parts: string[] = [];
    if (sla.response.breached > 0) parts.push(`${plural(sla.response.breached, "ticket")} answered late`);
    if (sla.response.missed > 0) parts.push(`${sla.response.missed} past the response target with no reply recorded`);
    watchItems.push(`Response targets: ${parts.join(", ")}.`);
  }
  if (sla.resolution.missed > 0 || sla.resolution.breached > 0) {
    const parts: string[] = [];
    if (sla.resolution.breached > 0) parts.push(`${plural(sla.resolution.breached, "resolution")} landed late`);
    if (sla.resolution.missed > 0) parts.push(`${sla.resolution.missed} tickets past the resolution target unresolved`);
    watchItems.push(`Resolution targets: ${parts.join(", ")}.`);
  }
  if (revenue.invoicedInPeriod > 0) {
    const change = delta(revenue.invoicedInPeriod, priorRevenue.invoicedInPeriod);
    highlights.push(`$${revenue.invoicedInPeriod.toLocaleString()} invoiced and $${revenue.collectedInPeriod.toLocaleString()} collected (${revenue.collectionRate}% collection rate)${change !== null ? `, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${quarter.previous.label}` : ""}.`);
  }
  if (revenue.totalOverdue > 0) {
    const overdueCount = revenue.aging.filter(a => a.label !== "Not yet due").reduce((s, a) => s + a.invoices, 0);
    watchItems.push(`$${revenue.totalOverdue.toLocaleString()} is overdue across ${overdueCount} invoice${overdueCount === 1 ? "" : "s"}.`);
  }
  if (time.totals.minutes > 0) highlights.push(`${time.totals.entries} time entries recorded — ${hours(time.totals.billableMinutes)} billable and ${hours(time.totals.nonBillableMinutes)} non-billable hours.`);
  if (csat.totals.responses > 0) highlights.push(`${plural(csat.totals.responses, "survey response")} with an NPS of ${csat.totals.nps} across ${plural(csat.byClient.filter(c => c.responses > 0).length, "client")}.`);
  else watchItems.push("No survey responses in the quarter, so satisfaction is not reported.");
  if (contracts.totals.unpricedHours > 0) watchItems.push(`${contracts.totals.unpricedHours} delivered hours have no internal cost rate, so agreement margins are overstated.`);
  if (aging.averages.oldestDays !== null && aging.averages.oldestDays > 30) watchItems.push(`The oldest open ticket is ${aging.averages.oldestDays} days old.`);
  if (aging.unassigned > 0) watchItems.push(`${plural(aging.unassigned, "open ticket")} are unassigned.`);
  if (contracts.totals.renewalsNext90Days > 0) highlights.push(`${contracts.totals.renewalsNext90Days} agreements renew within 90 days.`);

  const warrantySoon = assets.filter(a => a.warrantyExpiry && a.warrantyExpiry.getTime() > now.getTime() && a.warrantyExpiry.getTime() < now.getTime() + 90 * 86400000).length;

  return {
    period: { ...current, label: current.label, quarter: quarter.label, previousLabel: quarter.previous.label },
    comparisons: {
      tickets: { current: volume.total, previous: priorVolume.total, changePct: delta(volume.total, priorVolume.total) },
      hours: { current: hours(time.totals.minutes), previous: hours(priorTime.totals.minutes), changePct: delta(time.totals.minutes, priorTime.totals.minutes) },
      invoiced: { current: revenue.invoicedInPeriod, previous: priorRevenue.invoicedInPeriod, changePct: delta(revenue.invoicedInPeriod, priorRevenue.invoicedInPeriod) },
      collected: { current: revenue.collectedInPeriod, previous: priorRevenue.collectedInPeriod, changePct: delta(revenue.collectedInPeriod, priorRevenue.collectedInPeriod) },
      responseCompliancePct: { current: sla.responseCompliancePct, previous: priorSla.responseCompliancePct },
      resolutionCompliancePct: { current: sla.resolutionCompliancePct, previous: priorSla.resolutionCompliancePct },
    },
    serviceDelivery: {
      opened: volume.total,
      closed: volume.closed,
      backlog: volume.open,
      sla,
      responseBreakdown: volume.byPriority,
      resolutionHours: volume.averages.resolutionMinutes ? +(volume.averages.resolutionMinutes / 60).toFixed(1) : null,
      firstResponseHours: volume.averages.firstResponseMinutes ? +(volume.averages.firstResponseMinutes / 60).toFixed(1) : null,
      trend: volume.trend,
      topCategories: volume.byBoard,
      hours: {
        total: hours(time.totals.minutes),
        billable: hours(time.totals.billableMinutes),
        nonBillable: hours(time.totals.nonBillableMinutes),
        overtime: hours(time.totals.overtimeMinutes),
        byWorkType: time.byWorkType.slice(0, 8),
      },
      ticketsClosedByTechnician: util.technicians.map(t => ({ name: t.name, closed: t.ticketsClosed, billableHours: hours(t.billableMinutes), utilizationPct: t.utilizationPct })),
    },
    commercials: {
      invoiced: revenue.invoicedInPeriod,
      collected: revenue.collectedInPeriod,
      outstanding: revenue.totalOutstanding,
      overdue: revenue.totalOverdue,
      collectionRate: revenue.collectionRate,
      averageInvoice: revenue.averageInvoice,
      monthly: revenue.monthlyRevenue,
      byClient: revenue.byClient.slice(0, 8),
      agreements: contracts.agreements.slice(0, 10),
      agreementTotals: contracts.totals,
      topProducts: topProducts
        .map(p => ({
          product: p.productId ? productById.get(p.productId)?.name ?? "—" : "—",
          sku: p.productId ? productById.get(p.productId)?.sku ?? "" : "",
          type: p.productId ? productById.get(p.productId)?.productType ?? "" : "",
          quantity: p._sum.quantity ?? 0,
          revenue: money(p._sum.total ?? 0),
          lines: p._count.id,
        }))
        .sort((a, b) => b.revenue - a.revenue)
        .slice(0, 10),
    },
    clients: {
      byTickets: volume.byClient.slice(0, 10),
      byRevenue: revenue.byClient.slice(0, 10),
      aging: aging.byClient.slice(0, 10),
    },
    risk: {
      aging,
      slaBreaches: sla.breaches,
      largestOutstanding: revenue.largestOutstanding,
    },
    estate: {
      assets: assets.length,
      byType: [...new Set(assets.map(a => a.type))].map(type => ({ type, count: assets.filter(a => a.type === type).length })).sort((a, b) => b.count - a.count),
      byStatus: [...new Set(assets.map(a => a.status))].map(status => ({ status, count: assets.filter(a => a.status === status).length })).sort((a, b) => b.count - a.count),
      warrantyExpiringIn90Days: warrantySoon,
    },
    satisfaction: {
      responses: csat.totals.responses,
      nps: csat.totals.nps,
      averageScore: csat.totals.averageScore,
      byClient: csat.byClient.slice(0, 10),
      distribution: csat.distribution,
    },
    highlights: highlights.slice(0, 8),
    watchItems: watchItems.slice(0, 8),
    /** The picker's list, so the screen and the report agree about which quarters exist. */
    quarters: recentQuarters(now),
    reviewedQuarter: quarter.label,
    comparedWith: quarter.previous.label,
    notes: [
      `Reviewed ${quarter.label} against ${quarter.previous.label}${partial ? `, over the same ${elapsedDays} days because ${quarter.label} is not finished` : ""}.`,
      "Every figure is computed from the same sources as the standard reports, so the pack and the console cannot disagree.",
    ],
  };
}

// ═══════════════════════════════════════════════════════════════════
//  10. Client value
// ═══════════════════════════════════════════════════════════════════

/**
 * What each client is worth in attention and money. Extended for the reports overhaul with the
 * commercial half (invoiced, collected, outstanding) and the support half (SLA and satisfaction),
 * because "value" was previously a ticket count and a time total with no money in it.
 */
export async function clientValueReport(user: AuthUser | undefined, period: ReportPeriod) {
  const scope = companyFilter(period);
  const clients = await prisma.company.findMany({
    where: { isActive: true, ...scope },
    select: { id: true, name: true, industry: true, serviceLevel: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  if (clients.length === 0) return { period, clients: [], note: "No active clients in scope." };

  const since = new Date();
  since.setDate(since.getDate() - 90);
  const clientIds = clients.map(c => c.id);
  const from = period.from ? new Date(period.from) : null;
  const to = period.to ? new Date(period.to) : null;

  const [tickets, comments, timeEntries, expenses, invoices, agreements] = await Promise.all([
    prisma.ticket.findMany({
      where: { companyId: { in: clientIds }, ...(from || to ? dateRange("createdAt", period) : {}) },
      select: { id: true, companyId: true, status: true, priority: true, createdAt: true, firstResponseAt: true, resolvedAt: true, contactId: true, additionalContacts: { select: { contactId: true } } },
    }),
    prisma.ticketComment.findMany({
      where: { ticket: { companyId: { in: clientIds } }, isInternal: false },
      select: { ticketId: true, createdAt: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.timeEntry.findMany({
      where: { ticket: { companyId: { in: clientIds } }, ...(from || to ? dateRange("date", period) : {}) },
      select: { ticketId: true, minutes: true, billedMinutes: true, billable: true },
    }),
    prisma.expense.findMany({
      where: { companyId: { in: clientIds }, status: { in: ["approved", "billed"] } },
      select: { companyId: true, amount: true },
    }),
    prisma.invoice.findMany({
      where: { companyId: { in: clientIds } },
      select: { companyId: true, status: true, total: true, issueDate: true, dueDate: true, payments: { select: { amount: true } } },
    }),
    prisma.serviceAgreement.findMany({
      where: { companyId: { in: clientIds }, isActive: true },
      select: { companyId: true, name: true, billingAmount: true, billingPeriod: true },
    }),
  ]);

  const firstReply = new Map<string, Date>();
  for (const comment of comments) {
    if (!firstReply.has(comment.ticketId)) firstReply.set(comment.ticketId, comment.createdAt);
  }
  const now = Date.now();

  const rows = clients.map(client => {
    const theirs = tickets.filter(t => t.companyId === client.id);
    const open = theirs.filter(t => !CLOSED_STATUSES.includes(t.status));
    const resolved = theirs.filter(t => t.resolvedAt);
    const recent = theirs.filter(t => t.createdAt >= since);
    // A first reply is measured from the ticket's own first-response stamp when it has one, and
    // only falls back to the first public comment when it does not.
    const replyTimes = theirs
      .map(t => {
        if (t.firstResponseAt) return (t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000;
        const reply = firstReply.get(t.id);
        return reply && reply >= t.createdAt ? (reply.getTime() - t.createdAt.getTime()) / 60000 : null;
      })
      .filter((minutes): minutes is number => minutes !== null && minutes >= 0);
    const people = new Set<string>();
    for (const t of theirs) {
      if (t.contactId) people.add(t.contactId);
      for (const extra of t.additionalContacts) people.add(extra.contactId);
    }
    const entryIds = new Set(theirs.map(t => t.id));
    const clientEntries = timeEntries.filter(te => entryIds.has(te.ticketId));
    const minutes = clientEntries.reduce((sum, te) => sum + te.minutes, 0);
    const billedMinutes = clientEntries.reduce((sum, te) => sum + (te.billedMinutes ?? te.minutes), 0);
    const theirInvoices = invoices.filter(i => i.companyId === client.id);
    const invoiced = theirInvoices.reduce((s, i) => s + i.total, 0);
    const collected = theirInvoices.reduce((s, i) => s + i.payments.reduce((ps, p) => ps + p.amount, 0), 0);
    const outstanding = theirInvoices.filter(i => OPEN_INVOICE_STATUSES.includes(i.status)).reduce((s, i) => s + i.total, 0);
    const theirAgreements = agreements.filter(a => a.companyId === client.id);
    const recurring = theirAgreements.reduce((s, a) => s + annualise(a.billingAmount, a.billingPeriod), 0);
    const resolution = durations(resolved.map(t => ({ start: t.createdAt, end: t.resolvedAt })));

    return {
      client: client.name,
      industry: client.industry ?? "",
      serviceLevel: client.serviceLevel ?? "",
      clientSince: client.createdAt.toISOString().slice(0, 10),
      ticketsTotal: theirs.length,
      ticketsLast90Days: recent.length,
      open: open.length,
      resolvedOrClosed: theirs.length - open.length,
      highPriority: theirs.filter(t => t.priority === "critical" || t.priority === "high").length,
      activePeople: people.size,
      avgFirstReplyMinutes: replyTimes.length ? Math.round(replyTimes.reduce((a, b) => a + b, 0) / replyTimes.length) : null,
      avgResolutionHours: resolution.averageMinutes !== null ? +(resolution.averageMinutes / 3600000).toFixed(1) : null,
      oldestOpenDays: open.length ? Math.round(Math.max(...open.map(t => (now - t.createdAt.getTime()) / 86400000))) : 0,
      hoursLogged: hours(minutes),
      hoursBilled: hours(billedMinutes),
      nonBillableHours: hours(clientEntries.filter(e => !e.billable).reduce((s, e) => s + e.minutes, 0)),
      approvedExpenses: money(expenses.filter(e => e.companyId === client.id).reduce((sum, e) => sum + e.amount, 0)),
      invoiced: money(invoiced),
      collected: money(collected),
      outstanding: money(outstanding),
      agreements: theirAgreements.length,
      recurringAnnualValue: money(recurring),
      revenuePerTicket: theirs.length ? money(invoiced / theirs.length) : null,
    };
  });

  return {
    period,
    totals: {
      clients: rows.length,
      tickets: rows.reduce((s, r) => s + r.ticketsTotal, 0),
      hoursLogged: +rows.reduce((s, r) => s + r.hoursLogged, 0).toFixed(2),
      invoiced: money(rows.reduce((s, r) => s + r.invoiced, 0)),
      outstanding: money(rows.reduce((s, r) => s + r.outstanding, 0)),
      recurringAnnualValue: money(rows.reduce((s, r) => s + r.recurringAnnualValue, 0)),
    },
    clients: rows.sort((a, b) => b.invoiced - a.ticketsTotal),
  };
}
