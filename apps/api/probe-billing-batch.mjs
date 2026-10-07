/**
 * Bill-through batch invoices (PLAN-015 Phase A #3).
 *
 * The chain under test: weighted time and approved expenses become a preview, the preview becomes
 * draft invoices, approval issues them and offers them to accounting, rejection puts the work back.
 *
 * Requires `INVOICE_BATCH_ENABLED=true` and `TIME_RULES_ENABLED=true` on the API process, and the
 * stub accounting endpoint on 127.0.0.1 so `EGRESS_ALLOW_PRIVATE=true` is needed too.
 *
 * Run from apps/api:  node probe-billing-batch.mjs
 */
import { createServer } from "node:http";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const PUSH_PORT = 4701;

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

const at = (daysAgo, hours, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

function startStub() {
  const received = [];
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      received.push({ url: req.url, body: body ? JSON.parse(body) : null });
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "QB-INV-1" }));
    });
  });
  return new Promise(resolve => server.listen(PUSH_PORT, "127.0.0.1", () => resolve({ server, received })));
}

async function main() {
  await prisma.integration.deleteMany({ where: { name: { startsWith: "Batch probe accounting" } } });

  const admin = await signIn("persona.admin@c7ntax.local");
  check(admin.status === 200, `administrator signed in (${admin.status})`);

  const company = await prisma.company.create({ data: { name: `Batch Probe ${Date.now()}`, companyType: "Client" } });
  const board = await prisma.serviceBoard.findFirst({ select: { id: true } });
  const adminUser = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const ticket = await prisma.ticket.create({
    data: {
      title: "Batch probe",
      company: { connect: { id: company.id } },
      board: { connect: { id: board.id } },
      createdBy: { connect: { id: adminUser.id } },
      ticketNumber: `BAT-${Date.now()}`,
    },
    select: { id: true },
  });
  const agreement = await prisma.serviceAgreement.create({
    data: { name: "Batch probe agreement", companyId: company.id, agreementType: "spot", hourlyRate: 200, startDate: new Date() },
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { serviceAgreementId: agreement.id } });

  console.log("\nthe period holds weighted time and an approved expense");
  const timePost = await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(2, 19, 0), endTime: at(2, 21, 0), description: "Evening work" },
  });
  check(timePost.status === 201 && timePost.data?.billedMinutes === 180, `two evening hours bill as three (${timePost.data?.billedMinutes})`);

  const expense = await prisma.expense.create({
    data: {
      description: "Replacement cable", amount: 45, category: "hardware", companyId: company.id, ticketId: ticket.id,
      createdById: adminUser.id, status: "approved", approvedById: adminUser.id, approvedAt: new Date(), expenseDate: at(2, 9, 0),
    },
  });

  const through = new Date();
  through.setDate(through.getDate() + 1);
  const billThroughDate = through.toISOString().slice(0, 10);

  console.log("\npreview says what would be billed, and writes nothing");
  const preview = await call("POST", "/api/billing/batches/preview", { token: admin.token, body: { billThroughDate, companyIds: [company.id] } });
  check(preview.status === 200, `the preview answers (${preview.status})`);
  const client = (preview.data?.clients || [])[0];
  check(!!client && client.companyId === company.id, "the client appears in the preview");
  check(client?.hours === 3, `the preview uses the weighted hours (${client?.hours})`);
  check(client?.subtotal === 645, `it prices 3 h at the agreement rate plus the expense (${client?.subtotal})`);
  check((client?.lineItems || []).some(li => li.source === "expense" && li.total === 45), "the approved expense is a line of its own");
  check(await prisma.invoice.count({ where: { companyId: company.id } }) === 0, "no invoice was written by the preview");
  check(await prisma.billingBatch.count() === 0, "no batch was written by the preview");

  console.log("\ncreating the batch makes draft invoices");
  const created = await call("POST", "/api/billing/batches", { token: admin.token, body: { billThroughDate, companyIds: [company.id] } });
  check(created.status === 201, `the batch is created (${created.status})`);
  const batchId = created.data?.batch?.id;
  check(created.data?.batch?.status === "preview", `the batch starts as a preview (${created.data?.batch?.status})`);
  const drafts = await prisma.invoice.findMany({ where: { batchId } });
  check(drafts.length === 1, `one draft invoice exists (${drafts.length})`);
  check(drafts[0]?.status === "draft", `it is a draft, not issued (${drafts[0]?.status})`);
  check(drafts[0]?.total === 645, `it carries the previewed total (${drafts[0]?.total})`);
  const claimedTime = await prisma.timeEntry.findFirst({ where: { ticketId: ticket.id }, select: { invoiceId: true } });
  check(claimedTime?.invoiceId === drafts[0]?.id, "the time entry is claimed by the invoice");
  const claimedExpense = await prisma.expense.findUnique({ where: { id: expense.id }, select: { invoiceId: true, status: true } });
  check(claimedExpense?.invoiceId === drafts[0]?.id && claimedExpense?.status === "billed", `the expense is claimed and marked billed (${claimedExpense?.status})`);

  const secondPreview = await call("POST", "/api/billing/batches/preview", { token: admin.token, body: { billThroughDate, companyIds: [company.id] } });
  check((secondPreview.data?.clients || []).length === 0, "nothing is left to bill once the work is claimed");

  console.log("\nrejecting puts the work back");
  const blankReject = await call("POST", `/api/billing/batches/${batchId}/reject`, { token: admin.token, body: {} });
  check(blankReject.status === 400, `a rejection has to say why (${blankReject.status})`);
  const rejected = await call("POST", `/api/billing/batches/${batchId}/reject`, { token: admin.token, body: { reason: "Wrong period" } });
  check(rejected.status === 200 && rejected.data?.discarded === 1, `the draft is discarded (${rejected.data?.discarded})`);
  check(await prisma.invoice.count({ where: { batchId } }) === 0, "the draft invoice is gone");
  const returnedTime = await prisma.timeEntry.findFirst({ where: { ticketId: ticket.id }, select: { invoiceId: true } });
  check(returnedTime?.invoiceId === null, "the time entry is unbilled again");
  const returnedExpense = await prisma.expense.findUnique({ where: { id: expense.id }, select: { invoiceId: true, status: true } });
  check(returnedExpense?.invoiceId === null && returnedExpense?.status === "approved", `the expense is back to approved (${returnedExpense?.status})`);

  console.log("\napproving issues the invoices and offers them to accounting");
  const { server, received } = await startStub();
  const integration = await prisma.integration.create({
    data: {
      kind: "quickbooks", name: "Batch probe accounting", enabled: true, status: "connected",
      settings: { invoicePushUrl: `http://127.0.0.1:${PUSH_PORT}/invoices`, expensePushToken: "batch-token" },
    },
  });

  const again = await call("POST", "/api/billing/batches", { token: admin.token, body: { billThroughDate, companyIds: [company.id] } });
  const secondBatchId = again.data?.batch?.id;
  check(again.status === 201 && !!secondBatchId, `a fresh batch is created (${again.status})`);

  const approved = await call("POST", `/api/billing/batches/${secondBatchId}/approve`, { token: admin.token });
  check(approved.status === 200, `the batch is approved (${approved.status})`);
  check(approved.data?.batch?.status === "approved", `the batch records approval (${approved.data?.batch?.status})`);
  const results = approved.data?.results || [];
  check(results.length === 1 && results[0]?.issued === true, `the invoice was issued (${results.length})`);
  const issued = await prisma.invoice.findUnique({ where: { id: results[0]?.invoiceId }, select: { status: true } });
  check(issued?.status === "sent", `the invoice is sent, not draft (${issued?.status})`);
  check(results[0]?.pushed === true, `the push is reported as done (${results[0]?.pushed})`);
  check(received.length === 1, `the accounting endpoint received one invoice (${received.length})`);
  check(received[0]?.body?.invoiceNumber === results[0]?.invoiceNumber, `the payload carries the invoice number (${received[0]?.body?.invoiceNumber})`);
  check(received[0]?.body?.total === 645, `and the total (${received[0]?.body?.total})`);
  check((received[0]?.body?.lines || []).length === 2, `with both lines (${received[0]?.body?.lines?.length})`);
  const billedThrough = await prisma.company.findUnique({ where: { id: company.id }, select: { billThroughDate: true } });
  check(!!billedThrough?.billThroughDate, "the client's bill-through date moved");

  const twice = await call("POST", `/api/billing/batches/${secondBatchId}/approve`, { token: admin.token });
  check(twice.status === 409, `approving twice is refused (${twice.status})`);
  const rejectApproved = await call("POST", `/api/billing/batches/${secondBatchId}/reject`, { token: admin.token, body: { reason: "Too late" } });
  check(rejectApproved.status === 409, `an approved batch cannot be discarded (${rejectApproved.status})`);

  console.log("\nnothing to bill is not an error");
  const empty = await call("POST", "/api/billing/batches", { token: admin.token, body: { billThroughDate, companyIds: [company.id] } });
  check(empty.status === 200 && empty.data?.batch === null, `an empty period reports nothing to bill (${empty.status})`);

  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { batchId: secondBatchId } } }).catch(() => {});
  await prisma.timeEntry.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.expense.deleteMany({ where: { ticketId: ticket.id } });
  await prisma.invoice.deleteMany({ where: { companyId: company.id } }).catch(() => {});
  await prisma.billingBatch.deleteMany({ where: { createdById: adminUser.id } }).catch(() => {});
  await prisma.ticket.delete({ where: { id: ticket.id } }).catch(() => {});
  await prisma.serviceAgreement.delete({ where: { id: agreement.id } }).catch(() => {});
  await prisma.company.delete({ where: { id: company.id } }).catch(() => {});
  await prisma.integration.delete({ where: { id: integration.id } }).catch(() => {});
  await prisma.userSession.deleteMany({ where: { userId: adminUser.id } });
  await prisma.$disconnect();
  server.close();
  console.log("  note  probe client, agreement, ticket, batch, invoices, integration and sessions removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
