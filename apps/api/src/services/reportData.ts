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

/**
 * The same restriction for a query against the `Company` model itself, whose own key is `id` —
 * using `companyId` there asks for a column that does not exist, which is a 500 rather than an
 * empty list, and only for an account that is scoped to a client.
 */
function companySelfFilter(period: ReportPeriod): { id?: string } {
  return period.clientId ? { id: period.clientId } : {};
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
  let repliesBeforeCreation = 0;

  const rows: Row[] = tickets.map(t => {
    const board = boardById.get(t.boardId);
    const responseTarget = board?.slaResponseMinutes ?? 240;
    const resolutionTarget = board?.slaResolutionMinutes ?? 1440;
    const ageMinutes = Math.round((now - t.createdAt.getTime()) / 60000);
    const stamped = t.firstResponseAt ? Math.round((t.firstResponseAt.getTime() - t.createdAt.getTime()) / 60000) : null;
    const reply = replyByTicket.get(t.id);
    if (reply && reply < t.createdAt) repliesBeforeCreation++;
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
    responseSources: { stamp: fromStamp, reply: fromReply, none: noResponse, replyBeforeCreation: repliesBeforeCreation },
    dataQuality: {
      impossibleResolutions,
      repliesBeforeCreation,
      note: [
        impossibleResolutions > 0 ? impossibleDurationNote(impossibleResolutions) : null,
        repliesBeforeCreation > 0
          ? `${plural(repliesBeforeCreation, "ticket")} ${repliesBeforeCreation === 1 ? "has a reply dated" : "have replies dated"} before the ticket was created, so ${repliesBeforeCreation === 1 ? "it is" : "they are"} counted as having no reply recorded.`
          : null,
      ].filter(Boolean).join(" ") || null,
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

/**
 * The receivables ageing buckets, measured in days past each invoice's due date. Defined once and
 * used by both the revenue summary and the ageing report, so "60 days" cannot mean one thing on one
 * screen and another on the next. The boundaries are deliberate and are printed in the payload:
 * a bucket is `min < days <= max`, so an invoice due today is still current and one due exactly
 * 30 days ago is in the 1–30 band.
 */
const AGING_BUCKETS: Array<{ key: string; label: string; min: number; max: number }> = [
  { key: "current", label: "Not yet due", min: -Infinity, max: 0 },
  { key: "1-30", label: "1–30 days", min: 0, max: 30 },
  { key: "31-60", label: "31–60 days", min: 30, max: 60 },
  { key: "61-90", label: "61–90 days", min: 60, max: 90 },
  { key: "over-90", label: "Over 90 days", min: 90, max: Infinity },
];

const daysOverdue = (dueDate: Date, now: Date) => (now.getTime() - dueDate.getTime()) / 86400000;

/** The bucket an invoice's age falls in, for labelling its row as well as counting it. */
const bucketFor = (days: number) => AGING_BUCKETS.find(b => days > b.min && days <= b.max) ?? AGING_BUCKETS[AGING_BUCKETS.length - 1]!;

/** Every open invoice, counted and summed into the five ageing buckets. */
function ageingBuckets<T extends { total: number; dueDate: Date }>(outstanding: T[], now: Date) {
  return AGING_BUCKETS.map(b => {
    const matching = outstanding.filter(i => {
      const days = daysOverdue(i.dueDate, now);
      return days > b.min && days <= b.max;
    });
    return { key: b.key, label: b.label, invoices: matching.length, amount: money(matching.reduce((s, i) => s + i.total, 0)) };
  });
}

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
    prisma.company.findMany({ where: { isActive: true, ...companySelfFilter(period) }, select: { id: true, name: true } }),
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

  const aging = ageingBuckets(outstanding, now);

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

/** The three review cadences the business-review report runs at. */
export type ReviewGranularity = "week" | "month" | "quarter";

export interface ReviewWindow { label: string; start: Date; end: Date }
export interface ReviewPlan {
  granularity: ReviewGranularity;
  current: ReviewWindow;
  previous: ReviewWindow;
  options: Array<{ label: string; from: string; to: string }>;
}

const DAY_MS = 86400000;
const startOfDay = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
/** Monday, matching how this product already labels a week. */
const startOfWeek = (d: Date) => {
  const day = startOfDay(d);
  const offset = (day.getUTCDay() + 6) % 7;
  return new Date(day.getTime() - offset * DAY_MS);
};
const startOfMonth = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
const startOfQuarter = (d: Date) => new Date(Date.UTC(d.getUTCFullYear(), Math.floor(d.getUTCMonth() / 3) * 3, 1));

const monthName = (d: Date) => d.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const shortDate = (d: Date) => d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });

/**
 * The review window a granularity is about, the one before it, and the list a picker offers.
 *
 * With no range given the report uses the last **finished** period rather than the one in progress:
 * reviewing a week that started yesterday reports almost nothing, and a business review is about a
 * period somebody can draw a conclusion from. Boundaries are built in UTC from the date's UTC parts
 * so a report means the same period whatever timezone the server runs in, and a period's end is the
 * last millisecond of its last day rather than midnight of the next one.
 */
export function reviewPlan(granularity: ReviewGranularity, reference: Date): ReviewPlan {
  const label = (d: Date) => {
    if (granularity === "week") return `Week of ${shortDate(d)}`;
    if (granularity === "month") return monthName(d);
    return `Q${Math.floor(d.getUTCMonth() / 3) + 1} ${d.getUTCFullYear()}`;
  };
  const startOf = granularity === "week" ? startOfWeek : granularity === "month" ? startOfMonth : startOfQuarter;
  const nextStart = (start: Date) => {
    if (granularity === "week") return new Date(start.getTime() + 7 * DAY_MS);
    if (granularity === "month") return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 3, 1));
  };
  const previousStart = (start: Date) => {
    if (granularity === "week") return new Date(start.getTime() - 7 * DAY_MS);
    if (granularity === "month") return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 1, 1));
    return new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() - 3, 1));
  };
  const endOf = (start: Date) => new Date(nextStart(start).getTime() - 1);

  const window = (start: Date): ReviewWindow => ({ label: label(start), start, end: endOf(start) });

  // The most recent period that has finished: step back to the day before this period began and
  // take the period that day falls in. Stepping back one day from *today* is not enough — mid-week
  // and mid-month it lands in the period still being reported.
  const lastFinishedStart = startOf(new Date(startOf(reference).getTime() - DAY_MS));
  const current = window(lastFinishedStart);
  const previous = { ...window(previousStart(lastFinishedStart)), label: label(previousStart(lastFinishedStart)) };

  const count = granularity === "quarter" ? 8 : 12;
  const options: Array<{ label: string; from: string; to: string }> = [];
  for (let i = 0; i < count; i++) {
    let start = lastFinishedStart;
    for (let step = 0; step < i; step++) start = previousStart(start);
    const w = window(start);
    options.push({ label: w.label, from: w.start.toISOString(), to: w.end.toISOString() });
  }

  return { granularity, current, previous, options };
}

/** The quarter a date falls in, and the one before it — kept for the quarter-specific callers. */
export function quarterOf(reference: Date): Quarter {
  const plan = reviewPlan("quarter", reference);
  return { label: plan.current.label, start: plan.current.start, end: plan.current.end, previous: plan.previous };
}

/** The most recently finished quarter — what a business review is normally about. */
export function lastCompletedQuarter(reference: Date): Quarter {
  return quarterOf(reference);
}

/** The quarters ending with the most recent completed one, for the report's picker. */
export function recentQuarters(reference: Date, count = 8): Array<{ label: string; from: string; to: string }> {
  return reviewPlan("quarter", reference).options.slice(0, count);
}

/**
 * The business review — the shape of a QBR pack, assembled from the reports above so the numbers a
 * customer is shown in the meeting are the same numbers the team sees day to day. It is
 * deliberately additive — one period's service delivery, commercials, clients and risks — and it
 * says when a comparison cannot be made rather than printing a zero.
 *
 * One implementation serves all three cadences, because a weekly and a monthly review are the same
 * pack over a different window: copying it three times is how the three drift apart.
 */
export async function businessReviewReport(user: AuthUser | undefined, period: ReportPeriod, granularity: ReviewGranularity = "quarter") {
  const explicitFrom = period.from ? new Date(period.from) : null;
  const explicitTo = period.to ? new Date(period.to) : null;
  const now = new Date();

  // With no range the review is of the last *finished* period — reviewing a week that started
  // yesterday would report almost nothing.
  const plan = reviewPlan(granularity, now);
  const chosen = explicitFrom && explicitTo
    ? { label: period.label, start: explicitFrom, end: explicitTo, previous: { label: plan.previous.label, start: plan.previous.start, end: plan.previous.end } }
    : { ...plan.current, previous: plan.previous };

  const rangeStart = chosen.start;
  const rangeEnd = chosen.end;

  // A comparison has to be like for like. A finished period is compared with the whole period
  // before it; a period still in progress is compared with the same number of elapsed days of its
  // predecessor, which the notes state rather than leaving as a puzzle.
  const elapsedDays = Math.max(1, Math.round((rangeEnd.getTime() - rangeStart.getTime()) / DAY_MS) + 1);
  const periodLength = Math.round((plan.current.end.getTime() - plan.current.start.getTime()) / DAY_MS) + 1;
  const partial = elapsedDays < periodLength;
  const previousStart = explicitFrom && explicitTo ? chosen.previous.start : plan.previous.start;
  const previousEnd = partial ? new Date(previousStart.getTime() + elapsedDays * DAY_MS - 1) : (explicitFrom && explicitTo ? chosen.previous.end : plan.previous.end);

  const window = { from: rangeStart.toISOString(), to: rangeEnd.toISOString() };
  const previousRange = { from: previousStart.toISOString(), to: previousEnd.toISOString() };
  const periodNoun = granularity === "week" ? "week" : granularity === "month" ? "month" : "quarter";

  const current = { ...period, ...window, label: explicitFrom ? period.label : chosen.label, days: elapsedDays };
  const previous = { ...period, ...previousRange, label: chosen.previous.label, days: Math.round((previousEnd.getTime() - previousStart.getTime()) / DAY_MS) + 1 };

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
    if (change !== null) highlights.push(`Ticket volume ${change >= 0 ? "rose" : "fell"} ${Math.abs(change)}% against ${previous.label} (${volume.total} vs ${priorVolume.total}).`);
  } else {
    watchItems.push(`No tickets were logged in ${previous.label}, so there is no volume comparison to make.`);
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
    highlights.push(`$${revenue.invoicedInPeriod.toLocaleString()} invoiced and $${revenue.collectedInPeriod.toLocaleString()} collected (${revenue.collectionRate}% collection rate)${change !== null ? `, ${change >= 0 ? "up" : "down"} ${Math.abs(change)}% on ${previous.label}` : ""}.`);
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
    period: { ...current, label: current.label, periodLabel: chosen.label, previousLabel: previous.label, granularity },
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
    granularity,
    /** The picker's list, so the screen and the report agree about which periods exist. */
    periodOptions: plan.options,
    /** Kept under its quarter-era name so a saved report written before the cadences existed still reads it. */
    quarters: plan.options,
    reviewedPeriod: chosen.label,
    reviewedQuarter: chosen.label,
    comparedWith: previous.label,
    notes: [
      `Reviewed ${chosen.label} against ${previous.label}${partial ? `, over the same ${elapsedDays} days because the ${periodNoun} is not finished` : ""}.`,
      "Every figure is computed from the same sources as the standard reports, so the pack and the console cannot disagree.",
    ],
  };
}

/** The three cadences, as thin wrappers so each report has its own endpoint and its own card. */
export const weeklyReviewReport = (user: AuthUser | undefined, period: ReportPeriod) => businessReviewReport(user, period, "week");
export const monthlyReviewReport = (user: AuthUser | undefined, period: ReportPeriod) => businessReviewReport(user, period, "month");
export const qbrReport = (user: AuthUser | undefined, period: ReportPeriod) => businessReviewReport(user, period, "quarter");

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
    where: { isActive: true, ...companySelfFilter(period) },
    select: { id: true, name: true, industry: true, serviceLevel: true, createdAt: true },
    orderBy: { name: "asc" },
  });
  if (clients.length === 0) {
    return {
      period,
      totals: { clients: 0, tickets: 0, hoursLogged: 0, invoiced: 0, outstanding: 0, recurringAnnualValue: 0 },
      clients: [],
      note: "No active clients in scope.",
    };
  }

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

// ═══════════════════════════════════════════════════════════════════
//  Microsoft 365 inactive accounts
// ═══════════════════════════════════════════════════════════════════

/**
 * Inactive Microsoft 365 accounts across every connected tenant, per client.
 *
 * This is the reporting half of the M365 sync: the accounts arrive with the sync, and what an MSP
 * needs from them is "which clients are paying for seats nobody signs in to, and which of those
 * accounts have already been dealt with". The panel that used to sit on CloudConnect answered it for
 * one workspace by eye; this answers it for the whole book, with the filters the question actually
 * has — a threshold rather than a fixed 90 days, one client or all of them, one tenant or all of
 * them, and whether to include accounts that are already disabled.
 *
 * The honesty rule from `services/m365Inactivity.ts` is carried over deliberately: **an account with
 * no sign-in data is unknown, never dormant.** Azure only reports sign-in activity with Entra ID P1
 * and `AuditLog.Read.All`, and a report that quietly funds a licence-cleanup by counting "we do not
 * know" as "nobody signs in" is a report that gets live accounts disabled. Unknown accounts are shown
 * as their own state, counted separately, and can be excluded outright.
 */
export interface M365InactiveOptions {
  /** How long without a sign-in makes an account inactive. */
  inactiveDays: number;
  includeUnknown: boolean;
  includeDisabled: boolean;
  tenantId: string | null;
}

export function m365InactiveOptions(query: Record<string, unknown> = {}): M365InactiveOptions {
  const days = Number(asString(query.inactiveDays) ?? 90);
  const flag = (value: unknown, fallback: boolean) => {
    const text = asString(value);
    if (text === null) return fallback;
    return !["false", "0", "no", "off"].includes(text.toLowerCase());
  };
  return {
    inactiveDays: Number.isFinite(days) ? Math.min(Math.max(Math.round(days), 1), 730) : 90,
    includeUnknown: flag(query.includeUnknown, true),
    includeDisabled: flag(query.includeDisabled, true),
    tenantId: asString(query.tenantId),
  };
}

export async function m365InactiveAccountsReport(user: AuthUser | undefined, period: ReportPeriod, query: Record<string, unknown> = {}) {
  const options = m365InactiveOptions(query);
  const now = Date.now();

  const users = await prisma.m365User.findMany({
    where: options.tenantId ? { integrationId: options.tenantId } : undefined,
    orderBy: { displayName: "asc" },
  });

  const integrationIds = [...new Set(users.map(u => u.integrationId))];
  const integrations = integrationIds.length
    ? await prisma.integration.findMany({ where: { id: { in: integrationIds } }, select: { id: true, name: true } })
    : [];
  const integrationNameById = new Map(integrations.map(i => [i.id, i.name]));

  // The only link a tenant user has to a client is the contact the sync matched it to, so a user
  // nobody has mapped is reported as unmapped rather than attributed to somebody.
  const contactIds = [...new Set(users.map(u => u.contactId).filter((id): id is string => !!id))];
  const contacts = contactIds.length
    ? await prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, companyId: true, company: { select: { name: true } } } })
    : [];
  const contactById = new Map(contacts.map(c => [c.id, c]));

  type State = "inactive" | "disabled" | "unknown" | "active";
  interface Row {
    id: string; displayName: string; userPrincipalName: string; jobTitle: string | null; department: string | null;
    accountEnabled: boolean; lastSignInAt: string | null; daysSinceSignIn: number | null; state: State;
    clientId: string | null; clientName: string; tenantId: string; tenantName: string;
  }

  const all: Row[] = users.map(user => {
    const contact = user.contactId ? contactById.get(user.contactId) : undefined;
    const daysSinceSignIn = user.lastSignInAt ? Math.floor((now - user.lastSignInAt.getTime()) / 86400000) : null;
    // Disabled comes first: an account that is already switched off has been dealt with, and calling
    // it "inactive" would put it in the same list as the accounts that still need a decision.
    const state: State = !user.accountEnabled
      ? "disabled"
      : daysSinceSignIn === null
        ? "unknown"
        : daysSinceSignIn >= options.inactiveDays
          ? "inactive"
          : "active";
    return {
      id: user.id,
      displayName: user.displayName,
      userPrincipalName: user.userPrincipalName,
      jobTitle: user.jobTitle,
      department: user.department,
      accountEnabled: user.accountEnabled,
      lastSignInAt: user.lastSignInAt ? user.lastSignInAt.toISOString() : null,
      daysSinceSignIn,
      state,
      clientId: contact?.companyId ?? null,
      clientName: contact?.company?.name ?? "Not mapped to a client",
      tenantId: user.integrationId,
      tenantName: integrationNameById.get(user.integrationId) ?? "Unknown tenant",
    };
  });

  // A client filter is a scope, not a convenience: `parsePeriod` has already applied the account's
  // own restriction, so a client who may only see themselves cannot ask for somebody else.
  const scoped = period.clientId ? all.filter(row => row.clientId === period.clientId) : all;
  const rows = scoped.filter(row =>
    row.state === "unknown" ? options.includeUnknown : row.state === "disabled" ? options.includeDisabled : true);

  const byClient = new Map<string, { clientId: string | null; clientName: string; accounts: number; inactive: number; disabled: number; unknown: number; active: number; days: number[] }>();
  for (const row of rows) {
    const key = row.clientId ?? "unmapped";
    if (!byClient.has(key)) byClient.set(key, { clientId: row.clientId, clientName: row.clientName, accounts: 0, inactive: 0, disabled: 0, unknown: 0, active: 0, days: [] });
    const group = byClient.get(key)!;
    group.accounts++;
    if (row.state === "inactive") group.inactive++;
    else if (row.state === "disabled") group.disabled++;
    else if (row.state === "unknown") group.unknown++;
    else group.active++;
    if (row.daysSinceSignIn !== null) group.days.push(row.daysSinceSignIn);
  }

  const byTenant = new Map<string, { tenantId: string; tenantName: string; accounts: number; inactive: number; unknown: number }>();
  for (const row of rows) {
    if (!byTenant.has(row.tenantId)) byTenant.set(row.tenantId, { tenantId: row.tenantId, tenantName: row.tenantName, accounts: 0, inactive: 0, unknown: 0 });
    const group = byTenant.get(row.tenantId)!;
    group.accounts++;
    if (row.state === "inactive") group.inactive++;
    if (row.state === "unknown") group.unknown++;
  }

  const count = (state: State) => rows.filter(row => row.state === state).length;
  const withSignInData = rows.filter(row => row.lastSignInAt).length;
  const withoutSignInData = rows.length - withSignInData;
  const signInDataUnavailable = rows.length > 0 && withSignInData === 0;

  // Worst first: the longest silence, then accounts with nothing to go on, then the disabled ones
  // that are already handled, then the accounts that are fine.
  const stateOrder: State[] = ["inactive", "unknown", "disabled", "active"];
  const sorted = [...rows].sort((a, b) =>
    stateOrder.indexOf(a.state) - stateOrder.indexOf(b.state)
    || (b.daysSinceSignIn ?? -1) - (a.daysSinceSignIn ?? -1)
    || a.displayName.localeCompare(b.displayName));

  const notes: string[] = [];
  if (signInDataUnavailable) {
    notes.push("No sign-in activity is stored for any account in scope, so nothing can be called dormant. Reading it needs Entra ID P1 and the AuditLog.Read.All permission on the app registration, plus a sync afterwards.");
  } else if (withoutSignInData > 0) {
    notes.push(`${withoutSignInData} of ${rows.length} accounts have no sign-in activity recorded; they are counted as unknown rather than inactive.`);
  }
  if (scoped.length === 0) {
    notes.push(options.tenantId || period.clientId ? "No accounts match this client and tenant." : "No Microsoft 365 accounts have been synced yet — connect a tenant under CloudConnect and run a sync.");
  } else if (rows.length === 0) {
    notes.push("No accounts match these options. Widen the threshold or include disabled and unknown accounts.");
  }

  return {
    period,
    options,
    optionsLabel: `Inactive after ${options.inactiveDays} days`
      + (options.includeDisabled ? " · disabled accounts included" : " · disabled accounts excluded")
      + (options.includeUnknown ? " · unknown sign-in included" : " · unknown sign-in excluded"),
    scopeLabel: period.clientName ?? "All clients",
    coverage: {
      tenants: new Set(rows.map(row => row.tenantId)).size,
      accountsSynced: scoped.length,
      accountsListed: rows.length,
      withSignInData,
      withoutSignInData,
      signInDataUnavailable,
    },
    totals: {
      accounts: rows.length,
      inactive: count("inactive"),
      disabled: count("disabled"),
      unknown: count("unknown"),
      active: count("active"),
      mapped: rows.filter(row => row.clientId).length,
      unmapped: rows.filter(row => !row.clientId).length,
      clients: byClient.size,
    },
    byClient: [...byClient.values()]
      .map(group => ({
        ...group,
        oldestDays: group.days.length ? Math.max(...group.days) : null,
        averageDays: group.days.length ? Math.round(group.days.reduce((sum, d) => sum + d, 0) / group.days.length) : null,
      }))
      .sort((a, b) => b.inactive - a.inactive || b.accounts - a.accounts || a.clientName.localeCompare(b.clientName)),
    byTenant: [...byTenant.values()].sort((a, b) => b.inactive - a.inactive || a.tenantName.localeCompare(b.tenantName)),
    accounts: sorted.slice(0, 500).map(row => ({
      ...row,
      lastSignInDisplay: row.lastSignInAt ? new Date(row.lastSignInAt).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "Never recorded",
      stateLabel: row.state === "inactive" ? `Over ${options.inactiveDays} days` : row.state === "disabled" ? "Disabled" : row.state === "unknown" ? "Unknown" : "Active",
    })),
    truncated: sorted.length > 500,
    notes,
  };
}

// ═══════════════════════════════════════════════════════════════════
//  Billing screen reports: receivables ageing, tax summary, forecast
// ═══════════════════════════════════════════════════════════════════

/**
 * Accounts receivable ageing for the Billing screen.
 *
 * This answers "who owes what, and how late is it", so it is a point-in-time report rather than a
 * period one: everything still open is aged as of today, and the shared client filter still applies.
 * The buckets come from the same `ageingBuckets` the revenue summary uses, so `totals.outstanding`
 * here equals `revenue.totalOutstanding` for the same scope and a bucket boundary cannot drift
 * between the two screens.
 */
export async function billingAgingReport(user: AuthUser | undefined, period: ReportPeriod) {
  const now = new Date();
  const scope = companyFilter(period);
  const outstanding = await prisma.invoice.findMany({
    where: { status: { in: OPEN_INVOICE_STATUSES }, ...scope },
    select: {
      invoiceNumber: true, status: true, total: true, currency: true, issueDate: true, dueDate: true,
      companyId: true, company: { select: { name: true } },
    },
  });

  const buckets = ageingBuckets(outstanding, now);
  const totalOutstanding = money(outstanding.reduce((s, i) => s + i.total, 0));
  const notYetDue = buckets.find(b => b.key === "current")?.amount ?? 0;

  const clientRows = [...new Set(outstanding.map(i => i.companyId))].map(id => {
    const theirs = outstanding.filter(i => i.companyId === id);
    const byKey = new Map(ageingBuckets(theirs, now).map(b => [b.key, b.amount]));
    return {
      client: theirs[0]?.company?.name ?? "—",
      invoices: theirs.length,
      outstanding: money(theirs.reduce((s, i) => s + i.total, 0)),
      current: byKey.get("current") ?? 0,
      days1to30: byKey.get("1-30") ?? 0,
      days31to60: byKey.get("31-60") ?? 0,
      days61to90: byKey.get("61-90") ?? 0,
      days90plus: byKey.get("over-90") ?? 0,
      overdue: money(theirs.filter(i => daysOverdue(i.dueDate, now) > 0).reduce((s, i) => s + i.total, 0)),
      oldestOverdueDays: theirs.length ? Math.max(0, Math.round(Math.max(...theirs.map(i => daysOverdue(i.dueDate, now))))) : 0,
    };
  }).sort((a, b) => b.outstanding - a.outstanding);

  const largest = outstanding
    .slice()
    .sort((a, b) => b.total - a.total)
    .slice(0, 25)
    .map(i => {
      const days = Math.round(daysOverdue(i.dueDate, now));
      return {
        invoiceNumber: i.invoiceNumber,
        client: i.company?.name ?? "—",
        status: i.status,
        amount: money(i.total),
        issued: i.issueDate.toISOString().slice(0, 10),
        due: i.dueDate.toISOString().slice(0, 10),
        daysOverdue: Math.max(0, days),
        bucket: bucketFor(days).label,
      };
    });

  const currencies = [...new Set(outstanding.map(i => i.currency))];

  return {
    period,
    asOf: now.toISOString().slice(0, 10),
    buckets,
    totals: {
      invoices: outstanding.length,
      outstanding: totalOutstanding,
      overdue: money(totalOutstanding - notYetDue),
      notYetDue,
      clients: clientRows.length,
      averageInvoice: money(outstanding.length ? totalOutstanding / outstanding.length : 0),
    },
    basis: {
      measure: "Days past the invoice's due date, as of today",
      bucketRule: "A bucket is min < days ≤ max, so an invoice due today is current and one due exactly 30 days ago sits in the 1–30 band.",
      openStatuses: OPEN_INVOICE_STATUSES,
      currencies,
    },
    clients: clientRows,
    largest,
    notes: [
      "Receivables ageing is a point-in-time figure: the period filter is not applied, so the total is everything open right now.",
      "Only invoices in a status of sent, partial or overdue are counted as owed; drafts have not been issued and paid invoices owe nothing.",
      ...(currencies.length > 1 ? [`Invoices in ${currencies.length} currencies are summed as recorded; no conversion is applied.`] : []),
    ],
  };
}

/**
 * Tax collected and taxable revenue, for compliance reporting.
 *
 * The schema records a tax rate and a tax total on each invoice but **has no jurisdiction column**,
 * so jurisdiction is derived from the client's billing address (falling back to its primary address)
 * and the payload says so rather than implying a tax engine decided it. Draft invoices are excluded —
 * tax is a liability once an invoice is issued, and a draft has not been. Invoices whose recorded tax
 * does not equal `subtotal × rate` are counted and named in `dataQuality`, so a reconciliation does
 * not have to guess why the totals differ. A 0% rate may be a genuine exempt supply or simply not
 * recorded; the two are indistinguishable here and the payload says that too.
 */
export async function billingTaxSummaryReport(user: AuthUser | undefined, period: ReportPeriod) {
  const scope = companyFilter(period);
  const inPeriod = dateRange("issueDate", period);
  const [invoices, drafts] = await Promise.all([
    prisma.invoice.findMany({
      where: { ...scope, ...inPeriod, status: { not: "draft" } },
      select: {
        invoiceNumber: true, status: true, issueDate: true, subtotal: true, taxRate: true, taxTotal: true, total: true, currency: true,
        companyId: true,
        company: { select: { name: true, taxId: true, billingState: true, billingCountry: true, state: true, country: true } },
        payments: { select: { amount: true } },
      },
    }),
    prisma.invoice.aggregate({ _count: { _all: true }, _sum: { taxTotal: true }, where: { ...scope, ...inPeriod, status: "draft" } }),
  ]);

  type TaxInvoice = (typeof invoices)[number];
  const paid = (i: TaxInvoice) => i.payments.reduce((s, p) => s + p.amount, 0);
  const totalsOf = (rows: TaxInvoice[]) => {
    const taxableRevenue = rows.reduce((s, i) => s + i.subtotal, 0);
    const taxCollected = rows.reduce((s, i) => s + i.taxTotal, 0);
    const invoiced = rows.reduce((s, i) => s + i.total, 0);
    const collected = rows.reduce((s, i) => s + paid(i), 0);
    return {
      invoices: rows.length,
      taxableRevenue: money(taxableRevenue),
      taxCollected: money(taxCollected),
      invoiced: money(invoiced),
      collected: money(collected),
      outstanding: money(invoiced - collected),
      effectiveRatePct: taxableRevenue > 0 ? +((taxCollected / taxableRevenue) * 100).toFixed(4) : 0,
    };
  };

  /** The nearest thing the data has to a jurisdiction: the client's billing address. */
  const jurisdictionOf = (company: TaxInvoice["company"]) => {
    const country = company?.billingCountry || company?.country || "";
    const state = company?.billingState || company?.state || "";
    return [country, state].filter(Boolean).join(" · ") || "Not recorded";
  };
  /**
   * `taxRate` is written two ways in this database: invoices carry a percentage (8.5) while service
   * agreements carry a fraction (0.085). No tax rate is 100% or more, so a value above 1 is read as a
   * percentage and one at or below 1 as a fraction — and the payload says so, because guessing
   * silently would misstate a compliance figure by a factor of a hundred.
   */
  const ratePercent = (rate: number) => +((rate > 1 ? rate : rate * 100)).toFixed(4);
  const rateLabel = (rate: number) => `${ratePercent(rate)}%`;

  const group = <T,>(rows: TaxInvoice[], keyOf: (i: TaxInvoice) => T) => {
    const map = new Map<T, TaxInvoice[]>();
    for (const i of rows) {
      const key = keyOf(i);
      map.set(key, [...(map.get(key) ?? []), i]);
    }
    return map;
  };

  const byRate = [...group(invoices, i => ratePercent(i.taxRate)).entries()]
    .map(([rate, rows]) => ({ rate, rateLabel: rateLabel(rate), ...totalsOf(rows) }))
    .sort((a, b) => b.taxCollected - a.taxCollected);

  const byJurisdiction = [...group(invoices, i => jurisdictionOf(i.company)).entries()]
    .map(([jurisdiction, rows]) => ({
      jurisdiction,
      rates: [...new Set(rows.map(i => rateLabel(i.taxRate)))].sort().join(", "),
      ...totalsOf(rows),
    }))
    .sort((a, b) => b.taxCollected - a.taxCollected);

  const byClient = [...group(invoices, i => i.companyId).entries()]
    .map(([, rows]) => {
      const first = rows[0]!;
      return {
        client: first.company?.name ?? "—",
        taxId: first.company?.taxId ?? "",
        jurisdiction: jurisdictionOf(first.company),
        ...totalsOf(rows),
      };
    })
    .sort((a, b) => b.taxCollected - a.taxCollected);

  const mismatched = invoices
    .map(i => ({ invoice: i, expected: money((i.subtotal * ratePercent(i.taxRate)) / 100) }))
    .filter(row => Math.abs(row.invoice.taxTotal - row.expected) > 0.01);

  const currencies = [...new Set(invoices.map(i => i.currency))];

  return {
    period,
    totals: totalsOf(invoices),
    byRate,
    byJurisdiction,
    byClient: byClient.slice(0, 50),
    dataQuality: {
      invoicesWithoutRate: invoices.filter(i => !i.taxRate).length,
      invoicesMissingJurisdiction: invoices.filter(i => jurisdictionOf(i.company) === "Not recorded").length,
      taxMismatch: mismatched.length,
      mismatched: mismatched.slice(0, 10).map(row => ({
        invoiceNumber: row.invoice.invoiceNumber,
        client: row.invoice.company?.name ?? "—",
        rate: rateLabel(row.invoice.taxRate),
        recorded: money(row.invoice.taxTotal),
        expected: row.expected,
      })),
      draftsExcluded: drafts._count._all,
      draftTaxExcluded: money(drafts._sum.taxTotal ?? 0),
      currencies,
    },
    basis: {
      period: "Invoices by issue date",
      taxableRevenue: "Sum of each invoice's subtotal",
      taxCollected: "Sum of each invoice's recorded tax total",
      jurisdiction: "The client's billing country and state, falling back to its primary address; the schema has no tax-jurisdiction column of its own",
      rateConvention: "An invoice rate above 1 is read as a percentage (8.5 = 8.5%) and one at or below 1 as a fraction (0.085 = 8.5%); the two conventions share one column and the report states which it used",
      paid: "Payments recorded against the invoice",
      outstanding: "Invoice total less payments recorded against it",
      drafts: "Draft invoices are excluded",
    },
    notes: [
      "Tax rates are stored two ways in this database — invoices as a percentage (8.5) and service agreements as a fraction (0.085) — so a rate above 1 is read as a percentage and one at or below 1 as a fraction. A rate entered in the wrong convention in one of those columns would be counted here at its face value.",
      "Jurisdiction is derived from the client's address, not from a tax engine: if a client's billing address is missing, its invoices are grouped as \"Not recorded\" rather than guessed.",
      "A 0% rate may be an exempt or zero-rated supply or simply a rate nobody entered — the two cannot be told apart here, so both appear as 0%.",
      "Outstanding is the invoice total less payments recorded against it, so a part-paid invoice shows only what is left and an overpayment shows as a negative.",
      ...(drafts._count._all ? [drafts._count._all === 1
        ? `1 draft invoice (${money(drafts._sum.taxTotal ?? 0)} of tax) was left out because it has not been issued.`
        : `${plural(drafts._count._all, "draft invoice")} (${money(drafts._sum.taxTotal ?? 0)} of tax) were left out because they have not been issued.`] : []),
      ...(mismatched.length ? [mismatched.length === 1
        ? "1 invoice carries a tax total that does not equal subtotal × rate; it is listed under data quality and its recorded figure is what the totals above use."
        : `${mismatched.length} invoices carry tax totals that do not equal subtotal × rate; they are listed under data quality and their recorded figures are what the totals above use.`] : []),
      ...(currencies.length > 1 ? [`Invoices in ${currencies.length} currencies are summed as recorded; no conversion is applied.`] : []),
    ],
  };
}

/** How many months a billing period is, for stepping an agreement's schedule forward. */
const FORECAST_CADENCE_MONTHS: Record<string, number> = { monthly: 1, quarterly: 3, annual: 12, yearly: 12 };

const monthStart = (date: Date, offset = 0) => new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + offset, 1));
const monthKeyOf = (date: Date) => date.toISOString().slice(0, 7);
const monthLabelOf = (date: Date) => date.toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });

/** Keeps the day of the month when stepping a date forward, clamping into a shorter month. */
function addMonthsKeepingDay(date: Date, count: number) {
  const target = monthStart(date, count);
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(date.getUTCDate(), lastDay), date.getUTCHours(), date.getUTCMinutes()));
}

/** The dates an agreement bills on inside a window, its cadence stepped from the anchor date. */
function billingDates(anchor: Date, cadenceMonths: number, windowStart: Date, windowEnd: Date, endDate: Date | null): Date[] {
  let cursor = new Date(anchor.getTime());
  if (cursor < windowStart) {
    const monthsApart = (windowStart.getUTCFullYear() - cursor.getUTCFullYear()) * 12 + (windowStart.getUTCMonth() - cursor.getUTCMonth());
    if (monthsApart > 0) cursor = addMonthsKeepingDay(cursor, Math.floor(monthsApart / cadenceMonths) * cadenceMonths);
  }
  const dates: Date[] = [];
  for (let guard = 0; cursor < windowStart && guard < 400; guard++) cursor = addMonthsKeepingDay(cursor, cadenceMonths);
  for (let guard = 0; cursor <= windowEnd && guard < 400; guard++) {
    if (endDate && cursor > endDate) break;
    dates.push(new Date(cursor.getTime()));
    cursor = addMonthsKeepingDay(cursor, cadenceMonths);
  }
  return dates;
}

export interface BillingForecastOptions { months: number }

/** The one option the forecast asks for: how far forward to look. */
export function billingForecastOptions(query: Record<string, unknown> = {}): BillingForecastOptions {
  const months = Number(asString(query.months) ?? 6);
  return { months: Number.isFinite(months) ? Math.min(Math.max(Math.round(months), 1), 24) : 6 };
}

/**
 * Projected revenue forward from active service agreements and recurring invoices.
 *
 * The projection is deliberately literal: each active agreement is repeated at the amount and
 * cadence already recorded against it, and each recurring invoice at its own rule. Nothing is
 * assumed to grow, expire early or be renewed, and work that is not booked — hourly and overage
 * time — is left out entirely rather than estimated. The assumptions are returned in the payload as
 * `assumptions`, because a forecast whose basis is not printed beside it is a number pretending to
 * be a fact.
 */
export async function billingForecastReport(user: AuthUser | undefined, period: ReportPeriod, query: Record<string, unknown> = {}) {
  const { months } = billingForecastOptions(query);
  const scope = companyFilter(period);
  const now = new Date();
  const windowStart = monthStart(now, 1);
  const horizonMonths = Array.from({ length: months }, (_, i) => monthStart(windowStart, i));
  const lastMonth = horizonMonths[horizonMonths.length - 1]!;
  const windowEnd = new Date(Date.UTC(lastMonth.getUTCFullYear(), lastMonth.getUTCMonth() + 1, 0, 23, 59, 59, 999));

  const [agreements, recurringInvoices, latestAgreementInvoices] = await Promise.all([
    prisma.serviceAgreement.findMany({
      where: { isActive: true, ...scope },
      select: {
        id: true, name: true, companyId: true, agreementType: true, billingPeriod: true, billingAmount: true,
        currency: true, taxRate: true, hourlyRate: true, blockHoursIncluded: true, startDate: true, endDate: true, nextInvoiceDate: true,
        company: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    prisma.invoice.findMany({
      where: { isRecurring: true, nextGenerationDate: { not: null }, ...scope },
      select: {
        invoiceNumber: true, total: true, currency: true, recurrenceRule: true, nextGenerationDate: true, agreementId: true,
        company: { select: { name: true } },
      },
    }),
    prisma.serviceAgreement.findMany({
      where: { isActive: true, ...scope },
      select: { id: true, invoices: { select: { total: true, issueDate: true }, orderBy: { issueDate: "desc" }, take: 1 } },
    }),
  ]);

  const latestByAgreement = new Map(latestAgreementInvoices.map(a => [a.id, a.invoices[0] ?? null]));
  const activeAgreementIds = new Set(agreements.map(a => a.id));

  const rows = horizonMonths.map(month => ({ key: monthKeyOf(month), label: monthLabelOf(month), agreements: new Set<string>(), recurring: 0, total: 0 }));

  const agreementRows = agreements.map(a => {
    const cadence = FORECAST_CADENCE_MONTHS[a.billingPeriod] ?? 0;
    const anchor = a.nextInvoiceDate ?? a.startDate;
    const dates = cadence ? billingDates(anchor, cadence, windowStart, windowEnd, a.endDate) : [];
    for (const date of dates) {
      const row = rows.find(r => r.key === monthKeyOf(date));
      if (!row) continue;
      row.agreements.add(a.id);
      row.total += a.billingAmount;
    }
    const billedMonths = [...new Set(dates.map(d => monthKeyOf(d)))];
    const latest = latestByAgreement.get(a.id) ?? null;
    return {
      agreement: a.name,
      client: a.company?.name ?? "—",
      type: a.agreementType,
      billingPeriod: a.billingPeriod,
      billingAmount: money(a.billingAmount),
      annualisedValue: money(annualise(a.billingAmount, a.billingPeriod)),
      currency: a.currency,
      nextInvoiceDate: anchor.toISOString().slice(0, 10),
      scheduledMonths: billedMonths,
      occurrences: dates.length,
      horizonValue: money(dates.length * a.billingAmount),
      endDate: a.endDate ? a.endDate.toISOString().slice(0, 10) : null,
      hoursBased: a.agreementType === "block" || a.agreementType === "spot" || a.agreementType === "cyberCare",
      latestInvoice: latest ? { total: money(latest.total), issued: latest.issueDate.toISOString().slice(0, 10) } : null,
      billingAmountMatchesLatestInvoice: latest ? Math.abs(latest.total - a.billingAmount) <= 0.01 : null,
      projected: cadence > 0 && dates.length > 0,
      reason: cadence === 0
        ? `No billing cadence is recorded ("${a.billingPeriod}"), so nothing is projected.`
        : dates.length === 0
          ? (a.endDate && a.endDate < windowStart ? "The agreement ends before the forecast window." : "Nothing falls due in the forecast window.")
          : null,
    };
  });

  const recurringRows: Array<{ invoiceNumber: string; client: string; amount: number; currency: string; recurrenceRule: string; nextGenerationDate: string; occurrences: number; horizonValue: number; reason: string | null }> = [];
  for (const invoice of recurringInvoices) {
    const rule = (invoice.recurrenceRule ?? "").toLowerCase();
    const cadence = FORECAST_CADENCE_MONTHS[rule] ?? 0;
    const next = invoice.nextGenerationDate!;
    // An invoice that belongs to an active agreement is already counted through that agreement.
    const viaAgreement = invoice.agreementId ? activeAgreementIds.has(invoice.agreementId) : false;
    const dates = cadence && !viaAgreement ? billingDates(next, cadence, windowStart, windowEnd, null) : [];
    for (const date of dates) {
      const row = rows.find(r => r.key === monthKeyOf(date));
      if (!row) continue;
      row.recurring += invoice.total;
      row.total += invoice.total;
    }
    recurringRows.push({
      invoiceNumber: invoice.invoiceNumber,
      client: invoice.company?.name ?? "—",
      amount: money(invoice.total),
      currency: invoice.currency,
      recurrenceRule: invoice.recurrenceRule ?? "Not recorded",
      nextGenerationDate: next.toISOString().slice(0, 10),
      occurrences: dates.length,
      horizonValue: money(dates.length * invoice.total),
      reason: viaAgreement
        ? "Belongs to an active agreement, so it is counted once through that agreement."
        : cadence === 0
          ? `No recurrence rule is recorded ("${invoice.recurrenceRule ?? "none"}"), so nothing is projected.`
          : dates.length === 0 ? "Nothing falls due in the forecast window." : null,
    });
  }

  const monthSeries = rows.map(r => ({ key: r.key, label: r.label, agreements: r.agreements.size, recurring: money(r.recurring), total: money(r.total) }));

  const expiring = agreements
    .filter(a => a.endDate && a.endDate >= now && a.endDate <= windowEnd)
    .map(a => ({
      agreement: a.name,
      client: a.company?.name ?? "—",
      endDate: a.endDate!.toISOString().slice(0, 10),
      month: monthLabelOf(monthStart(a.endDate!)),
      daysToExpiry: Math.round((a.endDate!.getTime() - now.getTime()) / 86400000),
      billingAmount: money(a.billingAmount),
      annualisedValue: money(annualise(a.billingAmount, a.billingPeriod)),
    }))
    .sort((a, b) => a.endDate.localeCompare(b.endDate));

  const annualisedRunRate = money(agreements.reduce((s, a) => s + annualise(a.billingAmount, a.billingPeriod), 0));
  const mismatchedAmounts = agreementRows.filter(r => r.billingAmountMatchesLatestInvoice === false);
  const notProjected = agreementRows.filter(r => !r.projected);
  const currencies = [...new Set([...agreements.map(a => a.currency), ...recurringInvoices.map(i => i.currency)])];

  return {
    period,
    generatedAt: now.toISOString().slice(0, 10),
    horizon: {
      months,
      from: monthKeyOf(windowStart),
      to: monthKeyOf(lastMonth),
      label: `${monthLabelOf(windowStart)} – ${monthLabelOf(lastMonth)}`,
    },
    totals: {
      activeAgreements: agreements.length,
      projectedAgreements: agreementRows.filter(r => r.projected).length,
      recurringInvoices: recurringRows.filter(r => r.occurrences > 0).length,
      nextMonth: monthSeries[0]?.total ?? 0,
      followingMonths: money(monthSeries.slice(1).reduce((s, m) => s + m.total, 0)),
      horizonTotal: money(monthSeries.reduce((s, m) => s + m.total, 0)),
      annualisedRunRate,
      runRateNextMonth: money(annualisedRunRate / 12),
      expiringInHorizon: expiring.length,
      expiringAnnualValue: money(expiring.reduce((s, e) => s + e.annualisedValue, 0)),
    },
    months: monthSeries,
    agreements: agreementRows.sort((a, b) => b.horizonValue - a.horizonValue),
    expiring,
    recurring: recurringRows.sort((a, b) => b.horizonValue - a.horizonValue),
    dataQuality: {
      agreementsNotProjected: notProjected.map(r => ({ agreement: r.agreement, client: r.client, reason: r.reason })),
      billingAmountDiffersFromLatestInvoice: mismatchedAmounts.map(r => ({
        agreement: r.agreement, client: r.client, billingAmount: r.billingAmount, latestInvoice: r.latestInvoice,
      })),
      currencies,
    },
    assumptions: [
      `The window is the next ${months} months, ${monthLabelOf(windowStart)} to ${monthLabelOf(lastMonth)}.`,
      "Each active service agreement is repeated at the billing amount and cadence already recorded on it, anchored on its next invoice date — or its start date when no next date is set.",
      "An agreement with an end date stops billing after it: a renewal that has not been recorded is not assumed.",
      "Hourly, overage and time-and-materials work is not booked ahead, so it is not projected; a block or spot agreement contributes only its flat recorded amount.",
      "Recurring invoices are projected by their own recurrence rule from their next generation date, and an invoice that belongs to an active agreement is counted once, through the agreement.",
      "Amounts are before tax; the agreement's tax rate is not applied.",
      "No growth, churn, price change or currency conversion is assumed — the projection repeats today's recorded amounts as they stand.",
    ],
    notes: [
      ...(notProjected.length ? [notProjected.length === 1
        ? "1 agreement cannot be projected and contributes nothing: see data quality for the reason."
        : `${notProjected.length} agreements cannot be projected and contribute nothing: see data quality for the reason on each.`] : []),
      ...(mismatchedAmounts.length ? [mismatchedAmounts.length === 1
        ? "1 agreement bills an amount that differs from the total of its most recent invoice; the projection uses the recorded billing amount, not the invoice."
        : `${mismatchedAmounts.length} agreements bill amounts that differ from the totals of their most recent invoices; the projection uses the recorded billing amounts, not the invoices.`] : []),
      ...(currencies.length > 1 ? [`Amounts in ${currencies.length} currencies are summed as recorded; no conversion is applied.`] : []),
      "Recurring invoices appear only when they carry a recurrence rule and a next generation date; a recurring invoice with neither is listed with the reason it was left out.",
    ],
  };
}
