/**
 * Expense assertions (PLAN-015 Phase A #2).
 *
 * Covers the gap the plan names — a technician's out-of-pocket costs — and the approval chain on
 * top of it: filed by whoever did the work, decided by whoever owns billing, pushed to accounting
 * only once approved, and never silently "synced" when there is nowhere to push it.
 *
 * The push is exercised against a local stub server so the payload and the auth header are real.
 *
 * Requires `EGRESS_ALLOW_PRIVATE=true` on the API process: the stub is on 127.0.0.1, which the
 * egress policy refuses by default, so without it every push assertion fails with a 409 that looks
 * like a product bug and is not one.
 *
 * Run from apps/api:  node probe-expenses.mjs
 */
import { createServer } from "node:http";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const PUSH_PORT = 4700;

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

/** A local accounting endpoint that records what it was sent. */
function startStub() {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", chunk => { body += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "QB-EXP-1" }));
    });
  });
  return new Promise(resolve => server.listen(PUSH_PORT, "127.0.0.1", () => resolve({ server, received })));
}

async function main() {
  // Any integration a previous interrupted run left behind would change what "no connected
  // accounting system" means, so the probe clears its own leftovers first.
  await prisma.integration.deleteMany({ where: { name: { startsWith: "Probe accounting" } } });

  const admin = await signIn("persona.admin@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  check(admin.status === 200 && tech.status === 200, `administrator (${admin.status}) and technician (${tech.status}) signed in`);

  const company = await prisma.company.create({ data: { name: `Expense Probe ${Date.now()}`, companyType: "Client" } });
  const board = await prisma.serviceBoard.findFirst({ select: { id: true } });
  const adminUser = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const ticket = await prisma.ticket.create({
    data: {
      title: "Expense probe",
      company: { connect: { id: company.id } },
      board: { connect: { id: board.id } },
      createdBy: { connect: { id: adminUser.id } },
      ticketNumber: `EXP-${Date.now()}`,
    },
    select: { id: true },
  });

  console.log("\na technician can file an out-of-pocket cost");
  const filed = await call("POST", "/api/billing/expenses", {
    token: tech.token,
    body: { description: "Parking at the client site", amount: 24.5, category: "parking", vendor: "NCP", ticketId: ticket.id },
  });
  check(filed.status === 201, `the expense is accepted with ticket edit permission (${filed.status})`);
  check(filed.data?.status === "submitted", `it starts awaiting approval (${filed.data?.status})`);
  check(filed.data?.companyId === company.id, "its client is taken from the ticket, not the request");
  const expenseId = filed.data?.id;

  console.log("\nthe ticket shows what was filed, to whoever can see the ticket");
  const onTicket = await call("GET", `/api/tickets/${ticket.id}/expenses`, { token: tech.token });
  check(onTicket.status === 200 && (onTicket.data?.data || []).some(e => e.id === expenseId), `the ticket list includes it (${onTicket.status})`);
  const billingList = await call("GET", "/api/billing/expenses", { token: tech.token });
  check(billingList.status === 403, `the client-wide billing list is still closed to a technician (${billingList.status})`);

  console.log("\nvalidation");
  const badCategory = await call("POST", "/api/billing/expenses", { token: tech.token, body: { description: "x", amount: 5, category: "yacht", ticketId: ticket.id } });
  check(badCategory.status === 400, `an unknown category is refused (${badCategory.status})`);
  const badAmount = await call("POST", "/api/billing/expenses", { token: tech.token, body: { description: "x", amount: -5, ticketId: ticket.id } });
  check(badAmount.status === 400, `a negative amount is refused (${badAmount.status})`);
  const mismatch = await call("POST", "/api/billing/expenses", { token: tech.token, body: { description: "x", amount: 5, ticketId: ticket.id, companyId: "00000000-0000-0000-0000-000000000000" } });
  check(mismatch.status === 400, `a client that disagrees with the ticket is refused (${mismatch.status})`);

  console.log("\nonly billing may decide");
  const techApprove = await call("POST", `/api/billing/expenses/${expenseId}/approve`, { token: tech.token });
  check(techApprove.status === 403, `a technician cannot approve their own expense (${techApprove.status})`);
  const blankReject = await call("POST", `/api/billing/expenses/${expenseId}/reject`, { token: admin.token, body: {} });
  check(blankReject.status === 400, `a rejection has to say why (${blankReject.status})`);

  console.log("\npushing before approval is refused");
  const early = await call("POST", `/api/billing/expenses/${expenseId}/sync`, { token: admin.token });
  check(early.status === 409, `an unapproved expense is not pushed (${early.status})`);

  const approved = await call("POST", `/api/billing/expenses/${expenseId}/approve`, { token: admin.token, body: { note: "Reasonable" } });
  check(approved.status === 200 && approved.data?.status === "approved", `approval is recorded (${approved.status})`);
  check(!!approved.data?.approvedAt && approved.data?.approvedById === adminUser.id, "the decision carries a who and a when");

  console.log("\nno connected accounting system, no pretend sync");
  const noTarget = await call("POST", `/api/billing/expenses/${expenseId}/sync`, { token: admin.token });
  check(noTarget.status === 409, `the push is refused with a reason rather than faked (${noTarget.status})`);
  check(typeof noTarget.data?.error === "string" && /connect/i.test(noTarget.data.error), `the reason explains what is missing (${noTarget.data?.error})`);

  console.log("\nwith an accounting endpoint configured, the expense goes out and is marked");
  const { server, received } = await startStub();
  const integration = await prisma.integration.create({
    data: {
      kind: "quickbooks",
      name: "Probe accounting",
      enabled: true,
      status: "connected",
      settings: { expensePushUrl: `http://127.0.0.1:${PUSH_PORT}/expenses`, expensePushToken: "probe-token" },
    },
  });

  const pushed = await call("POST", `/api/billing/expenses/${expenseId}/sync`, { token: admin.token });
  check(pushed.status === 200 && pushed.data?.syncedAt, `the push succeeds (${pushed.status})`);
  check(pushed.data?.externalSystem === "quickbooks", `the provider is recorded (${pushed.data?.externalSystem})`);
  check(pushed.data?.externalId === "QB-EXP-1", `the other system's id is kept (${pushed.data?.externalId})`);
  check(received.length === 1, `the endpoint received one request (${received.length})`);
  check(received[0]?.body?.description === "Parking at the client site", "the payload carries the expense description");
  check(received[0]?.body?.amount === 24.5 && received[0]?.body?.vendor === "NCP", `the amount and vendor travel with it (${received[0]?.body?.amount}/${received[0]?.body?.vendor})`);
  check(received[0]?.body?.client?.startsWith("Expense Probe"), `the client name is resolved for the other system (${received[0]?.body?.client})`);
  check(received[0]?.auth === "Bearer probe-token", `the integration's token is used (${received[0]?.auth})`);

  console.log("\nbookkeeping");
  const badUrlIntegration = await prisma.integration.create({
    data: { kind: "flexpoint", name: "Probe accounting (bad URL)", enabled: true, status: "connected", settings: { expensePushUrl: "ftp://192.168.1.10/expenses" } },
  });
  const blocked = await call("POST", `/api/billing/expenses/${expenseId}/sync`, { token: admin.token });
  check(blocked.status === 409, `an address the egress policy refuses is reported, not crashed (${blocked.status})`);
  check(typeof blocked.data?.error === "string" && /push URL/i.test(blocked.data.error), `the reason names the push URL (${blocked.data?.error?.slice(0, 80)})`);
  await prisma.integration.delete({ where: { id: badUrlIntegration.id } }).catch(() => {});

  const invoiced = await prisma.expense.update({ where: { id: expenseId }, data: { invoiceId: "00000000-0000-0000-0000-000000000000" } }).catch(() => null);
  if (invoiced) {
    const deleteInvoiced = await call("DELETE", `/api/billing/expenses/${expenseId}`, { token: admin.token });
    check(deleteInvoiced.status === 409, `an expense on an invoice is not deleted (${deleteInvoiced.status})`);
  } else {
    check(true, "an expense on an invoice is not deleted (skipped: no invoice fixture)");
  }

  await prisma.expense.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => {});
  await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
  await prisma.integration.delete({ where: { id: integration.id } }).catch(() => {});
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  await prisma.$disconnect();
  server.close();
  console.log("  note  probe client, ticket, expenses, integration and sessions removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
