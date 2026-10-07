/**
 * Custom report runner and Client Value Report (PLAN-015 Phase B #10).
 *
 * The report builder used to answer an empty array for anything that was not one of its two
 * hardcoded types, which is why "custom" reports looked broken. These assertions cover the
 * whitelist (unknown sources, columns, fields and operators are refused or ignored, never run),
 * the query shapes that matter, client scoping, and the new Client Value rollup.
 *
 * Run from apps/api:  node probe-reports.mjs
 */
const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, token: data.token };
}

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function createReport(token, name, config, type = "custom") {
  const created = await call("POST", "/api/reports", { token, body: { name, type, config } });
  return created.data?.id;
}

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  const scoped = await signIn("persona.tech.scoped@c7ntax.local");
  check(admin.status === 200 && scoped.status === 200, `administrator (${admin.status}) and scoped technician (${scoped.status}) signed in`);

  const created = [];
  const make = async (name, config, type = "custom") => {
    const id = await createReport(admin.token, name, config, type);
    if (id) created.push(id);
    return id;
  };

  console.log("\na custom config actually runs");
  const ticketReport = await make("Probe — tickets by status", {
    source: "tickets",
    columns: ["ticketNumber", "title", "status", "client"],
    filters: [{ field: "status", op: "in", value: ["new", "in_progress"] }],
    sortBy: "createdAt",
    sortDir: "desc",
    limit: 25,
  });
  const run = await call("GET", `/api/reports/${ticketReport}/run`, { token: admin.token });
  check(run.status === 200, `the custom report answers (${run.status})`);
  check(Array.isArray(run.data?.data) && run.data.data.length > 0, `it returns rows (${run.data?.data?.length})`);
  check((run.data?.columns || []).includes("client"), `the requested columns are reported (${(run.data?.columns || []).join(",")})`);
  check((run.data?.data || []).every(r => ["new", "in_progress"].includes(r.status)), "the filter is applied");
  check((run.data?.data || []).every(r => r.client === undefined || typeof r.client === "object" || r.client === null), "the client column resolves through the relation");

  console.log("\ngrouping produces a rollup, not rows");
  const grouped = await make("Probe — tickets grouped", { source: "tickets", groupBy: "status" });
  const groupedRun = await call("GET", `/api/reports/${grouped}/run`, { token: admin.token });
  check(groupedRun.data?.columns?.join(",") === "status,count", `the rollup has two columns (${groupedRun.data?.columns?.join(",")})`);
  check((groupedRun.data?.data || []).every(r => typeof r.count === "number"), "every rollup row counts something");

  console.log("\nthe whitelist is enforced, not trusted");
  const badSource = await make("Probe — bad source", { source: "users; drop table" });
  const badSourceRun = await call("GET", `/api/reports/${badSource}/run`, { token: admin.token });
  check(badSourceRun.status === 400, `an unknown source is refused (${badSourceRun.status})`);
  const badColumn = await make("Probe — bad column", { source: "tickets", columns: ["ticketNumber", "secretHash", "password", "status"] });
  const badColumnRun = await call("GET", `/api/reports/${badColumn}/run`, { token: admin.token });
  check(badColumnRun.data?.columns?.join(",") === "ticketNumber,status", `unknown columns are dropped (${badColumnRun.data?.columns?.join(",")})`);
  check((badColumnRun.data?.notes || []).some(n => /secretHash/.test(n)), "and the drop is reported back");
  const badOperator = await make("Probe — bad operator", { source: "tickets", filters: [{ field: "status", op: "sql", value: "1=1" }] });
  const badOperatorRun = await call("GET", `/api/reports/${badOperator}/run`, { token: admin.token });
  check(badOperatorRun.status === 200 && (badOperatorRun.data?.notes || []).some(n => /operator/.test(n)), "an unknown operator is ignored and said so");
  const badField = await make("Probe — bad filter field", { source: "tickets", filters: [{ field: "passwordHash", op: "equals", value: "x" }] });
  const badFieldRun = await call("GET", `/api/reports/${badField}/run`, { token: admin.token });
  check((badFieldRun.data?.notes || []).some(n => /passwordHash/.test(n)), "an unknown filter field is ignored and said so");

  console.log("\nsources beyond tickets work, and the relation-scoped one is scoped");
  const expenseReport = await make("Probe — expenses", { source: "expenses", columns: ["description", "amount", "status"], limit: 5 });
  const expenseRun = await call("GET", `/api/reports/${expenseReport}/run`, { token: admin.token });
  check(expenseRun.status === 200 && Array.isArray(expenseRun.data?.data), `the expenses source runs (${expenseRun.status})`);
  const timeReport = await make("Probe — time", { source: "time_entries", columns: ["date", "minutes", "billedMinutes"], limit: 5 });
  const timeRun = await call("GET", `/api/reports/${timeReport}/run`, { token: admin.token });
  check(timeRun.status === 200 && Array.isArray(timeRun.data?.data), `the time source runs (${timeRun.status})`);
  const scopedRun = await call("GET", `/api/reports/${timeReport}/run`, { token: scoped.token });
  check(scopedRun.status === 200, `a scoped account can run it (${scopedRun.status})`);
  const scopedTickets = await make("Probe — scoped tickets", { source: "tickets", columns: ["ticketNumber", "client"], limit: 200 });
  const scopedTicketRun = await call("GET", `/api/reports/${scopedTickets}/run`, { token: scoped.token });
  const scopedClients = new Set((scopedTicketRun.data?.data || []).map(r => (r.client && typeof r.client === "object" ? JSON.stringify(r.client) : String(r.client))));
  check(scopedTicketRun.status === 200 && scopedClients.size <= 1, `a scoped account sees one client at most (${scopedClients.size})`);

  console.log("\nthe old types still work");
  const summary = await make("Probe — ticket summary", {}, "ticket_summary");
  const summaryRun = await call("GET", `/api/reports/${summary}/run`, { token: admin.token });
  check(summaryRun.status === 200 && Array.isArray(summaryRun.data?.data), `the built-in ticket summary still runs (${summaryRun.status})`);
  const clientValue = await make("Probe — client value", {}, "client_value");
  const clientValueRun = await call("GET", `/api/reports/${clientValue}/run`, { token: admin.token });
  const rows = clientValueRun.data?.data || [];
  check(clientValueRun.status === 200 && rows.length > 0, `the client value report returns clients (${rows.length})`);
  const first = rows[0] || {};
  check(["client", "ticketsTotal", "open", "resolvedOrClosed", "activePeople", "hoursLogged", "hoursBilled"].every(k => k in first), `the row carries the value columns (${Object.keys(first).slice(0, 5).join(", ")}…)`);
  check(rows.every(r => r.open + r.resolvedOrClosed === r.ticketsTotal), "open plus resolved equals the total for every client");
  check(typeof first.avgFirstReplyMinutes === "number" || first.avgFirstReplyMinutes === null, `first-reply time is present or explicitly absent (${first.avgFirstReplyMinutes})`);

  const endpoint = await call("GET", "/api/reports/data/client-value", { token: admin.token });
  check(endpoint.status === 200 && Array.isArray(endpoint.data), `the client value endpoint answers directly (${endpoint.status})`);

  const scopedValue = await call("GET", "/api/reports/data/client-value", { token: scoped.token });
  check(Array.isArray(scopedValue.data) && scopedValue.data.length <= 1, `a scoped account sees one client at most here too (${scopedValue.data?.length})`);

  await prisma.report.deleteMany({ where: { id: { in: created } } });
  await prisma.reportSchedule.deleteMany({ where: { reportId: { in: created } } }).catch(() => {});
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech.scoped@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  await prisma.$disconnect();
  console.log("  note  probe reports and sessions removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
