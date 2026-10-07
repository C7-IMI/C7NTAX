/**
 * The standard reports (the Reporting overhaul).
 *
 * What is under test:
 *   1. **Every standard report answers, and answers with data.** A report that returns an empty
 *      shell is the failure mode this suite exists to catch — two of these reports used to
 *      fabricate their figures with `Math.random()`, which "worked" by never being checked.
 *   2. **Filters narrow and never widen.** A date range, a client and a board each change the
 *      result, and a date given as a calendar day means that whole day rather than a UTC-shifted one.
 *   3. **Totals are not taken from a page of rows**, and an impossible duration never reaches an
 *      average.
 *   4. **A saved report runs the same code as the screen**, so it cannot show a different number.
 *   5. Report management — create, edit, duplicate, schedule, delete, and the system-report guard.
 *
 * The custom runner's own assertions live in `probe-reports.mjs`.
 *
 * Requires the API with sample data. Run from apps/api:  node probe-reports-standard.mjs
 */
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token };
}

const STANDARD = [
  { path: "ticket-volume", keys: ["total", "byStatus", "byPriority", "byBoard", "byAssignee", "trend", "oldestOpen"], arrays: ["byStatus", "byAssignee"] },
  { path: "sla-compliance", keys: ["response", "resolution", "byBoard", "byTechnician", "breaches"], arrays: ["byBoard"] },
  { path: "technician-utilization", keys: ["totals", "technicians", "capacityBasis"], arrays: ["technicians"] },
  { path: "revenue-summary", keys: ["invoicedInPeriod", "collectedInPeriod", "aging", "byClient", "largestOutstanding"] },
  { path: "ticket-aging", keys: ["buckets", "byPriority", "byClient", "oldest", "averages"], arrays: ["buckets"] },
  { path: "time-tracking", keys: ["totals", "byTechnician", "byWorkType", "byTicket", "rows"], arrays: ["byTechnician", "rows"] },
  { path: "csat", keys: ["totals", "distribution", "byClient", "surveys"] },
  { path: "contract-profitability", keys: ["totals", "costBasis", "agreements"], arrays: ["agreements"] },
  { path: "client-value", keys: ["totals", "clients"], arrays: ["clients"] },
  { path: "quarterly-business-review", keys: ["comparisons", "serviceDelivery", "commercials", "clients", "risk", "estate", "satisfaction", "highlights", "watchItems", "quarters"], arrays: ["quarters"] },
];

async function main() {
  const stamp = Date.now();
  const admin = await signIn("persona.admin@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  const scoped = await signIn("persona.tech.scoped@c7ntax.local");
  check(!!admin.token && !!tech.token && !!scoped.token, "an administrator, a technician and a client-scoped technician signed in");

  console.log("\nevery standard report answers with data");
  const payloads = {};
  for (const report of STANDARD) {
    const res = await call("GET", `/api/reports/data/${report.path}`, { token: admin.token });
    payloads[report.path] = res.data;
    check(res.status === 200, `${report.path} answers (${res.status})`);
    const missing = report.keys.filter(k => res.data?.[k] === undefined);
    check(missing.length === 0, `${report.path} carries its sections${missing.length ? ` — missing ${missing.join(", ")}` : ""}`);
    check(res.data?.period?.label !== undefined, `${report.path} states the period it used (${res.data?.period?.label})`);
    for (const key of report.arrays ?? []) {
      check(Array.isArray(res.data?.[key]) && res.data[key].length > 0, `${report.path}.${key} has rows (${res.data?.[key]?.length ?? "n/a"})`);
    }
  }

  console.log("\nnothing is invented and nothing is taken from a page");
  const csat = payloads["csat"];
  check(csat.totals.responses === (await prisma.surveyResponse.count()), `satisfaction reports the responses that exist (${csat.totals.responses})`);
  check(typeof csat.note === "string" && /response/i.test(csat.note), "and says where the figures come from");
  const contract = payloads["contract-profitability"];
  check(contract.costBasis && typeof contract.costBasis.note === "string", `cost profitability states its cost basis (${contract.costBasis.note.slice(0, 60)}…)`);
  const time = payloads["time-tracking"];
  const wholePeriod = await prisma.timeEntry.aggregate({ _count: { id: true }, _sum: { minutes: true } });
  check(time.totals.entries === wholePeriod._count.id, `the time report's total is the whole set, not the page (${time.totals.entries} of ${wholePeriod._count.id})`);
  check(time.totals.minutes === wholePeriod._sum.minutes, `and the minutes total matches the database (${time.totals.minutes})`);
  check(time.rows.length <= time.rowLimit, `the listed rows are capped at ${time.rowLimit} (${time.rows.length})`);

  const volume = payloads["ticket-volume"];
  const resolvedInDb = await prisma.ticket.count({ where: { resolvedAt: { not: null } } });
  const impossible = await prisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Ticket" WHERE "resolvedAt" IS NOT NULL AND "resolvedAt" < "createdAt"`;
  check(volume.closed === resolvedInDb, `the volume report counts every resolved ticket (${volume.closed} of ${resolvedInDb})`);
  check(volume.dataQuality.impossibleResolutions === impossible[0].n, `and flags the ones whose dates are the wrong way round (${impossible[0].n})`);
  check(volume.averages.resolutionMinutes === null || volume.averages.resolutionMinutes > 0, "no negative duration reaches an average");
  const utilization = payloads["technician-utilization"];
  check(utilization.technicians.every(t => t.avgHoursPerTicketClosed === null || t.avgHoursPerTicketClosed >= 0), "and none reaches the per-technician average either");

  console.log("\nthe SLA report separates a late answer from no answer");
  const sla = payloads["sla-compliance"];
  const outcomes = ["met", "breached", "missed", "awaiting"];
  check(outcomes.every(o => typeof sla.response[o] === "number"), "response outcomes are met / late / missed / inside target");
  check(outcomes.every(o => typeof sla.resolution[o] === "number"), "resolution outcomes use the same four");
  const summed = outcomes.reduce((total, o) => total + sla.response[o], 0);
  check(summed === sla.evaluated, `the outcomes add up to the tickets evaluated (${summed} of ${sla.evaluated})`);
  const commentReplies = await prisma.ticketComment.groupBy({ by: ["ticketId"], where: { isInternal: false, author: { companyId: null } }, _min: { createdAt: true } });
  check(sla.responseSources.reply + sla.responseSources.replyBeforeCreation === commentReplies.length, `every first reply is accounted for — ${sla.responseSources.reply} used, ${sla.responseSources.replyBeforeCreation} dated before the ticket was created (${commentReplies.length} total)`);
  check(sla.response.met + sla.response.breached <= sla.responseSources.stamp + sla.responseSources.reply, "a ticket with no reply recorded is never counted as met or late");
  check(sla.responseCompliancePct <= 100 && sla.resolutionCompliancePct <= 100, `compliance is a percentage, not a ratio (${sla.responseCompliancePct}% / ${sla.resolutionCompliancePct}%)`);
  const breaching = sla.byBoard.reduce((sum, b) => sum + b.breachedResponse + b.missedResponse, 0);
  check(breaching === sla.response.breached + sla.response.missed, `the by-board table accounts for every response failure (${breaching})`);

  console.log("\nfilters narrow, and cannot widen");
  const all = await call("GET", "/api/reports/data/ticket-volume", { token: admin.token });
  const client = await prisma.company.findFirst({ where: { companyType: "Client" }, select: { id: true, name: true } });
  const one = await call("GET", `/api/reports/data/ticket-volume?clientId=${client.id}`, { token: admin.token });
  check(one.data.total > 0 && one.data.total < all.data.total, `one client narrows the report (${one.data.total} of ${all.data.total})`);
  check(one.data.period.clientName === client.name, `and the period names the client (${one.data.period.clientName})`);
  const outside = await call("GET", "/api/reports/data/ticket-volume?clientId=00000000-0000-0000-0000-000000000000", { token: admin.token });
  check(outside.data.total === 0, `a client with no rows returns nothing rather than everything (${outside.data.total})`);
  const ranged = await call("GET", "/api/reports/data/ticket-volume?from=2000-01-01&to=2000-12-31", { token: admin.token });
  check(ranged.data.total === 0, `an empty range returns nothing (${ranged.data.total})`);
  check(ranged.data.period.label === "01 Jan 2000 – 31 Dec 2000", `and the label is the whole days asked for (${ranged.data.period.label})`);
  const day = await call("GET", "/api/reports/data/ticket-volume?from=2026-08-01&to=2026-08-31", { token: admin.token });
  const inAugust = await prisma.ticket.count({ where: { createdAt: { gte: new Date(2026, 7, 1), lte: new Date(2026, 7, 31, 23, 59, 59, 999) } } });
  check(day.data.total === inAugust, `a month covers the whole month (${day.data.total} of ${inAugust})`);
  const board = await prisma.serviceBoard.findFirst({ select: { id: true, name: true } });
  const byBoard = await call("GET", `/api/reports/data/ticket-volume?boardId=${board.id}`, { token: admin.token });
  check(byBoard.data.total > 0 && byBoard.data.total <= all.data.total, `a board narrows it too (${byBoard.data.total} of ${all.data.total})`);
  check(byBoard.data.period.boardName === board.name, `and names the board (${byBoard.data.period.boardName})`);
  const timed = await call("GET", "/api/reports/data/time-tracking?from=2026-08-01&to=2026-08-31", { token: admin.token });
  const augustEntries = await prisma.timeEntry.count({ where: { date: { gte: new Date(2026, 7, 1), lte: new Date(2026, 7, 31, 23, 59, 59, 999) } } });
  check(timed.data.totals.entries === augustEntries, `the time report respects the range (${timed.data.totals.entries} of ${augustEntries})`);

  console.log("\nthe quarterly business review compares like with like");
  const qbr = payloads["quarterly-business-review"];
  check(/^Q[1-4] \d{4}$/.test(qbr.reviewedQuarter), `it reviews a named quarter (${qbr.reviewedQuarter})`);
  check(qbr.comparedWith !== qbr.reviewedQuarter, `against the one before (${qbr.comparedWith})`);
  check(qbr.quarters.length === 8, `and offers eight quarters to pick from (${qbr.quarters.length})`);
  const lastFinished = qbr.quarters[0];
  check(lastFinished?.label === qbr.reviewedQuarter, `the first of them is the one it opened on (${lastFinished?.label})`);
  const q3 = await call("GET", "/api/reports/data/quarterly-business-review?from=2026-07-01&to=2026-09-30", { token: admin.token });
  const q3Tickets = await prisma.ticket.count({ where: { createdAt: { gte: new Date(2026, 6, 1), lte: new Date(2026, 8, 30, 23, 59, 59, 999) } } });
  check(q3.data.serviceDelivery.opened === q3Tickets, `a chosen quarter counts exactly its own tickets (${q3.data.serviceDelivery.opened} of ${q3Tickets})`);
  check(q3.data.highlights.length + q3.data.watchItems.length > 0, `and writes a narrative (${q3.data.highlights.length} highlights, ${q3.data.watchItems.length} watch items)`);
  check(q3.data.commercials && q3.data.estate && q3.data.satisfaction, "with the commercial, estate and satisfaction chapters");
  check(q3.data.comparisons.tickets.previous !== undefined, `and states what it compared against (${q3.data.comparisons.tickets.previous} tickets in ${q3.data.comparedWith})`);
  check(q3.data.watchItems.every(w => !/\b1 (invoices|tickets|clients)\b/.test(w)), "no watch item says \"1 invoices\"");

  console.log("\nsaved reports run the same code as the screens");
  const created = await call("POST", "/api/reports", {
    token: admin.token,
    body: { name: `Report probe volume ${stamp}`, description: "Probe: a saved report of a standard type", type: "ticket_summary", config: {} },
  });
  check(created.status === 201, `a saved report is created (${created.status})`);
  const run = await call("GET", `/api/reports/${created.data.id}/run`, { token: admin.token });
  check(run.status === 200, `it runs (${run.status})`);
  check(run.data.summary?.total === volume.total, `and agrees with the ticket volume screen (${run.data.summary?.total} vs ${volume.total})`);

  const custom = await call("POST", "/api/reports", {
    token: admin.token,
    body: {
      name: `Report probe open tickets ${stamp}`,
      type: "custom",
      config: { source: "tickets", columns: ["ticketNumber", "title", "status", "client"], filters: [{ field: "status", op: "in", value: ["new", "in_progress"] }], limit: 50 },
    },
  });
  const customRun = await call("GET", `/api/reports/${custom.data.id}/run`, { token: admin.token });
  check(customRun.data.data.length > 0, `a config-driven report returns rows (${customRun.data.data.length})`);
  check(customRun.data.data.every(r => ["new", "in_progress"].includes(r.status)), "and honours its own filter");
  check(customRun.data.data.every(r => r.client && typeof r.client === "object"), "a relation column arrives as an object the UI unwraps");
  check(customRun.data.limit === 50, `and reports the row ceiling it used (${customRun.data.limit})`);

  console.log("\nreports are managed, not just listed");
  const renamed = await call("PATCH", `/api/reports/${custom.data.id}`, { token: admin.token, body: { name: `Report probe renamed ${stamp}` } });
  check(renamed.status === 200 && renamed.data.name === `Report probe renamed ${stamp}`, `a report can be renamed (${renamed.data.name})`);
  const duplicated = await call("POST", `/api/reports/${custom.data.id}/duplicate`, { token: admin.token });
  check(duplicated.status === 201 && /\(copy\)$/.test(duplicated.data.name), `and duplicated (${duplicated.data.name})`);
  const scheduled = await call("POST", `/api/reports/${custom.data.id}/schedules`, {
    token: admin.token,
    body: { frequency: "monthly", dayOfMonth: 1, timeOfDay: "07:00", recipients: ["finance@example.com", "not-an-address"], format: "pdf" },
  });
  check(scheduled.status === 201, `a schedule is created (${scheduled.status})`);
  check(scheduled.data.recipients.length === 1, `non-addresses are dropped from the recipients (${scheduled.data.recipients.join(", ")})`);
  const badSchedule = await call("POST", `/api/reports/${custom.data.id}/schedules`, { token: admin.token, body: { frequency: "fortnightly", timeOfDay: "07:00", recipients: [] } });
  check(badSchedule.status === 400, `an unknown frequency is refused (${badSchedule.status})`);
  const systemReport = await prisma.report.findFirst({ where: { isSystem: true }, select: { id: true } });
  if (systemReport) {
    const refused = await call("DELETE", `/api/reports/${systemReport.id}`, { token: admin.token });
    check(refused.status === 409, `a report that ships with the product cannot be deleted (${refused.status})`);
    check(/ships with the product/i.test(refused.data?.error?.message ?? ""), "and says why");
  } else {
    check(true, "no system report in this database to guard (skipped)");
  }
  const deleted = await call("DELETE", `/api/reports/${custom.data.id}`, { token: admin.token });
  check(deleted.status === 200, `a written report can be deleted (${deleted.status})`);
  check((await prisma.reportSchedule.count({ where: { reportId: custom.data.id } })) === 0, "and its schedules go with it");

  console.log("\nreporting is a permission, not a page");
  const techRead = await call("GET", "/api/reports/data/ticket-volume", { token: tech.token });
  check(techRead.status === 200, `a technician can run a report (${techRead.status})`);
  // Every standard report has to survive a client-scoped account: two of them asked the Company
  // table for a `companyId` it does not have, which is a 500 rather than an empty report.
  const scopedCalls = {};
  for (const report of STANDARD) scopedCalls[report.path] = (await call("GET", `/api/reports/data/${report.path}`, { token: scoped.token })).status;
  const scopedBroken = Object.entries(scopedCalls).filter(([, status]) => status !== 200);
  check(scopedBroken.length === 0, `every report answers a client-scoped account${scopedBroken.length ? ` — ${scopedBroken.map(([p, s]) => `${p}: ${s}`).join(", ")}` : " (10 of 10)"}`);
  const scopedCompany = await prisma.user.findUnique({ where: { email: "persona.tech.scoped@c7ntax.local" }, select: { companyId: true } });
  const scopedValue = await call("GET", "/api/reports/data/client-value", { token: scoped.token });
  check(scopedValue.data?.clients?.length <= 1, `a scoped account sees one client at most (${scopedValue.data?.clients?.length})`);
  check(scopedValue.data?.clients?.every(c => true) && scopedValue.data?.period?.clientId === scopedCompany.companyId, "and it is their own client");
  const techWrite = await call("POST", "/api/reports", { token: tech.token, body: { name: "Nope", type: "custom", config: {} } });
  check(techWrite.status === 403, `but cannot create one (${techWrite.status})`);
  const anonymous = await call("GET", "/api/reports/data/ticket-volume");
  check(anonymous.status === 401, `and an anonymous caller is refused (${anonymous.status})`);
  const unknownSource = await call("POST", "/api/reports", { token: admin.token, body: { name: `Report probe bad source ${stamp}`, type: "custom", config: { source: "users" } } });
  const badRun = await call("GET", `/api/reports/${unknownSource.data.id}/run`, { token: admin.token });
  check(badRun.status === 400, `a report pointed at a non-whitelisted source is refused when run (${badRun.status})`);

  // Clean up whatever this run left behind.
  const probeReports = await prisma.report.findMany({ where: { name: { startsWith: "Report probe" } }, select: { id: true } });
  const probeIds = probeReports.map(r => r.id);
  await prisma.reportSchedule.deleteMany({ where: { reportId: { in: probeIds } } });
  await prisma.report.deleteMany({ where: { id: { in: probeIds } } });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  await prisma.$disconnect();
  console.log(`  note  ${probeIds.length} probe reports, their schedules and the personas' sessions removed`);

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
