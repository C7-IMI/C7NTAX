/**
 * Billing from tickets (PLAN-013 #5).
 *
 * The chain under test: unbilled time on a client's tickets is previewed, the preview becomes a
 * draft invoice, and the source tickets stay visible on the invoice from the list onwards. Also
 * checks the scoping rule that stops a company-scoped account billing somebody else's client.
 *
 * Requires `BILLING_FROM_TICKETS_ENABLED` to be unset or not "false" on the API process.
 *
 * Run from apps/api:  node probe-billing-generate.mjs
 * Companion:          BILLING_FROM_TICKETS_ENABLED=false node probe-billing-generate-flag.mjs
 */
import bcrypt from "bcryptjs";
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

async function signIn(email, password = PW) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
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

async function main() {
  const stamp = Date.now();

  const admin = await signIn("persona.admin@c7ntax.local");
  check(admin.status === 200 && !!admin.token, `administrator signed in (${admin.status})`);
  const adminUser = await prisma.user.findUnique({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true, roleId: true } });
  const board = await prisma.serviceBoard.findFirst({ select: { id: true } });

  const mkClient = (name) => prisma.company.create({ data: { name, companyType: "Client" }, select: { id: true, name: true } });
  const clientA = await mkClient(`Generate Probe A ${stamp}`);
  const clientB = await mkClient(`Generate Probe B ${stamp}`);

  const mkTicket = (companyId, prefix) => prisma.ticket.create({
    data: {
      title: `${prefix} probe`,
      company: { connect: { id: companyId } },
      board: { connect: { id: board.id } },
      createdBy: { connect: { id: adminUser.id } },
      ticketNumber: `${prefix}-${stamp}`,
    },
    select: { id: true, ticketNumber: true },
  });
  const ticketA1 = await mkTicket(clientA.id, "GENA1");
  const ticketA2 = await mkTicket(clientA.id, "GENA2");
  const ticketB = await mkTicket(clientB.id, "GENB1");

  const mkAgreement = (companyId, name) => prisma.serviceAgreement.create({
    data: { name, companyId, agreementType: "spot", hourlyRate: 200, billingAmount: 200, startDate: new Date() },
    select: { id: true },
  });
  const agreementA = await mkAgreement(clientA.id, `Generate probe A agreement ${stamp}`);
  const agreementB = await mkAgreement(clientB.id, `Generate probe B agreement ${stamp}`);

  const addTime = (ticketId, minutes, body) => call("POST", `/api/tickets/${ticketId}/time`, {
    token: admin.token,
    body: { minutes, ...body },
  });

  console.log("\na client with nothing unbilled is told so before anything is written");
  const emptyPreview = await call("GET", `/api/billing/invoices/unbilled/${clientA.id}`, { token: admin.token });
  check(emptyPreview.status === 200, `the preview answers (${emptyPreview.status})`);
  check(emptyPreview.data?.entries === 0, `with no entries (${emptyPreview.data?.entries})`);
  check(emptyPreview.data?.amount === 0, `and no amount (${emptyPreview.data?.amount})`);
  check(emptyPreview.data?.agreement?.name === `Generate probe A agreement ${stamp}`, `naming the agreement it would bill (${emptyPreview.data?.agreement?.name})`);

  console.log("\nthe preview counts only billable, chargeable time, at the rates that will be used");
  check((await addTime(ticketA1.id, 90, { description: "Quarterly maintenance" })).status === 201, "90 billable minutes are logged");
  check((await addTime(ticketA2.id, 30, { rate: 250 })).status === 201, "30 minutes at an explicit rate are logged");
  check((await addTime(ticketA2.id, 45, { billable: false })).status === 201, "45 non-billable minutes are logged");
  check((await addTime(ticketA2.id, 60, { noCharge: true })).status === 201, "60 no-charge minutes are logged");
  const preview = await call("GET", `/api/billing/invoices/unbilled/${clientA.id}`, { token: admin.token });
  check(preview.data?.entries === 2, `two entries are unbilled (${preview.data?.entries})`);
  check(preview.data?.minutes === 120, `totalling two hours (${preview.data?.minutes})`);
  // 1.5 h at the agreement's 200 = 300, plus 0.5 h at the entry's own 250 = 125.
  check(preview.data?.amount === 425, `worth $425 (${preview.data?.amount})`);
  check(
    JSON.stringify((preview.data?.tickets || []).map(t => t.ticketNumber)) === JSON.stringify([ticketA1.ticketNumber, ticketA2.ticketNumber].sort()),
    `from both of the client's tickets (${(preview.data?.tickets || []).map(t => t.ticketNumber).join(", ")})`,
  );

  console.log("\nthe draft it writes matches the preview and names its tickets");
  const generated = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: admin.token, body: { companyId: clientA.id } });
  check(generated.status === 201, `the invoice is created (${generated.status})`);
  const invoice = generated.data?.invoice;
  check(/^INV-/.test(invoice?.invoiceNumber || ""), `with an invoice number (${invoice?.invoiceNumber})`);
  check(invoice?.status === "draft", `as a draft (${invoice?.status})`);
  check(invoice?.total === 425, `totalling the previewed amount (${invoice?.total})`);
  check(generated.data?.entriesIncluded === 2, `from two time entries (${generated.data?.entriesIncluded})`);
  check(invoice?.company?.name === clientA.name, `carrying the client (${invoice?.company?.name})`);
  check((invoice?.lineItems || []).length === 2, `with one line per entry (${(invoice?.lineItems || []).length})`);
  check(
    (invoice?.sourceTickets || []).map(t => t.ticketNumber).sort().join(",") === [ticketA1.ticketNumber, ticketA2.ticketNumber].sort().join(","),
    `and both source tickets (${(invoice?.sourceTickets || []).map(t => t.ticketNumber).join(", ")})`,
  );
  check(
    (invoice?.sourceTickets || []).every(t => [ticketA1.id, ticketA2.id].includes(t.id)),
    "the source tickets carry usable ids, so the page can link to them",
  );
  const lines = invoice?.lineItems || [];
  check(lines.some(l => l.description === "Quarterly maintenance"), "a typed description is kept as the line description");
  check(
    lines.some(l => l.description === `Ticket ${ticketA2.ticketNumber}`),
    `an untyped entry is described by its ticket (${lines.map(l => l.description).join(" | ")})`,
  );
  const quantities = lines.map(l => l.quantity).sort((a, b) => a - b);
  check(quantities[0] === 0.5 && quantities[1] === 1.5, `priced by the hour (${quantities.join(", ")})`);

  console.log("\nthe billed time cannot be billed twice");
  const afterPreview = await call("GET", `/api/billing/invoices/unbilled/${clientA.id}`, { token: admin.token });
  check(afterPreview.data?.entries === 0, `the preview is empty again (${afterPreview.data?.entries})`);
  const again = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: admin.token, body: { companyId: clientA.id } });
  check(again.status === 400, `a second generate is refused (${again.status})`);
  check(/no unbilled time/i.test(again.data?.error?.message || ""), `with a reason a person can read (${again.data?.error?.message})`);

  console.log("\nthe invoice list shows where the money came from");
  const listed = await call("GET", `/api/billing/invoices?companyId=${clientA.id}&limit=50`, { token: admin.token });
  check(listed.status === 200, `the list answers (${listed.status})`);
  const row = (listed.data?.data || []).find(i => i.id === invoice?.id);
  check(!!row, "the new invoice is in the list");
  check(
    (row?.sourceTickets || []).map(t => t.ticketNumber).sort().join(",") === [ticketA1.ticketNumber, ticketA2.ticketNumber].sort().join(","),
    `with its source tickets (${(row?.sourceTickets || []).map(t => t.ticketNumber).join(", ")})`,
  );
  check((row?.sourceTickets || []).length === 2, "listed once each, not once per line");

  console.log("\nanother client's unbilled time stays out of it");
  await addTime(ticketB.id, 60, { description: "Other client work" });
  const otherPreview = await call("GET", `/api/billing/invoices/unbilled/${clientB.id}`, { token: admin.token });
  check(otherPreview.data?.entries === 1 && otherPreview.data?.amount === 200, `the other client has its own unbilled hour (${otherPreview.data?.entries} / ${otherPreview.data?.amount})`);
  check((otherPreview.data?.tickets || []).every(t => t.id === ticketB.id), "and only its own ticket");

  console.log("\nthe permission gate and the company scope hold");
  const clientAdmin = await signIn("persona.clientadmin@c7ntax.local");
  check(clientAdmin.status === 200, `the client-scoped persona signed in (${clientAdmin.status})`);
  const forClientAdmin = await call("GET", `/api/billing/invoices/unbilled/${clientB.id}`, { token: clientAdmin.token });
  check(forClientAdmin.status === 403, `a billing:view-only account cannot preview a billable run (${forClientAdmin.status})`);

  const scopedLogin = `generate.probe.${stamp}@c7ntax.local`;
  const scopedUser = await prisma.user.create({
    data: {
      email: scopedLogin,
      firstName: "Generate",
      lastName: "Probe",
      department: "Verification",
      isActive: true,
      emailVerified: true,
      mustChangePassword: false,
      mfaEnabled: false,
      roleId: adminUser.roleId,
      companyId: clientB.id,
      passwordHash: bcrypt.hashSync(PW, 10),
    },
    select: { id: true },
  });
  const scoped = await signIn(scopedLogin);
  check(scoped.status === 200 && !!scoped.token, `an account scoped to the other client signed in (${scoped.status})`);
  const scopedForeignPreview = await call("GET", `/api/billing/invoices/unbilled/${clientA.id}`, { token: scoped.token });
  check(scopedForeignPreview.status === 404, `it cannot preview another client's unbilled time (${scopedForeignPreview.status})`);
  const scopedForeignGenerate = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: scoped.token, body: { companyId: clientA.id } });
  check(scopedForeignGenerate.status === 404, `it cannot bill another client (${scopedForeignGenerate.status})`);
  const scopedOwnPreview = await call("GET", `/api/billing/invoices/unbilled/${clientB.id}`, { token: scoped.token });
  check(scopedOwnPreview.status === 200 && scopedOwnPreview.data?.entries === 1, `it can preview its own client (${scopedOwnPreview.status} / ${scopedOwnPreview.data?.entries})`);
  const scopedOwnGenerate = await call("POST", "/api/billing/invoices/generate-from-tickets", { token: scoped.token, body: { companyId: clientB.id } });
  check(scopedOwnGenerate.status === 201, `and bill its own client (${scopedOwnGenerate.status})`);
  check(scopedOwnGenerate.data?.invoice?.company?.name === clientB.name, `with the client recorded (${scopedOwnGenerate.data?.invoice?.company?.name})`);

  console.log("\nthe legacy generate endpoint keeps working and is scoped too");
  const legacy = await call("POST", "/api/billing/invoices/generate", { token: admin.token, body: { companyId: clientA.id } });
  check(legacy.status === 201, `it still answers (${legacy.status})`);
  check(legacy.data?.invoiceNumber !== undefined && legacy.data?.total === 0, `writing an empty draft, as it always did (${legacy.data?.total})`);
  const legacyForeign = await call("POST", "/api/billing/invoices/generate", { token: scoped.token, body: { companyId: clientA.id } });
  check(legacyForeign.status === 404, `and it no longer crosses the client boundary (${legacyForeign.status})`);

  await prisma.userSession.deleteMany({ where: { userId: { in: [adminUser.id, scopedUser.id] } } });
  await prisma.invoiceLineItem.deleteMany({ where: { invoice: { companyId: { in: [clientA.id, clientB.id] } } } }).catch(() => {});
  await prisma.timeEntry.deleteMany({ where: { ticketId: { in: [ticketA1.id, ticketA2.id, ticketB.id] } } });
  await prisma.ticket.deleteMany({ where: { id: { in: [ticketA1.id, ticketA2.id, ticketB.id] } } });
  await prisma.invoice.deleteMany({ where: { companyId: { in: [clientA.id, clientB.id] } } });
  await prisma.serviceAgreement.deleteMany({ where: { id: { in: [agreementA.id, agreementB.id] } } });
  await prisma.user.delete({ where: { id: scopedUser.id } }).catch(() => {});
  await prisma.company.deleteMany({ where: { id: { in: [clientA.id, clientB.id] } } });
  await prisma.$disconnect();
  console.log("  note  probe clients, agreements, tickets, time, invoices and the scoped account removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
