/**
 * The off-switch for the time rules (PLAN-015 Phase A #1).
 *
 * Run this against an API started with `TIME_RULES_ENABLED=false` (or unset): entries must be
 * stored exactly as they were typed, no split rows appear, and no block balance moves. That is
 * what "off by default" has to mean, so it is checked against a running process rather than
 * assumed from the `if` in the code.
 *
 *   node probe-time-rules-flag.mjs
 */
const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

/**
 * One stamp for the run, carried in the client's name.
 *
 * A name is how the probe finds its rows again: the sweep below cannot hold ids for rows that only exist
 * once `main` has started, and it has to work when `main` throws before it ever assigned them.
 */
const STAMP = Date.now();

/**
 * Everything this probe writes, removed by name — called from the end of `main` and from `catch`.
 *
 * The tidy-up used to be the last statements of the happy path, so an exception above them left a
 * "TimeRules Off Probe …" client in the list with its ticket and agreement attached. Idempotent and
 * name-based, so both paths can call it.
 */
async function sweep() {
  const companies = await prisma.company.findMany({ where: { name: `TimeRules Off Probe ${STAMP}` }, select: { id: true } });
  for (const company of companies) {
    const tickets = await prisma.ticket.findMany({ where: { companyId: company.id }, select: { id: true } });
    const ticketIds = tickets.map((t) => t.id);
    await prisma.timeEntry.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.serviceAgreement.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  const admin = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  if (admin) await prisma.userSession.deleteMany({ where: { userId: admin.id } });
  return companies.length;
}

const at = (daysAgo, hours, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email: "persona.admin@c7ntax.local", password: PW }),
  });
  const { token } = await login.json();
  check(login.status === 200 && !!token, `administrator signed in (${login.status})`);

  const company = await prisma.company.create({ data: { name: `TimeRules Off Probe ${STAMP}`, companyType: "Client" } });
  const board = await prisma.serviceBoard.findFirst({ select: { id: true } });
  const adminUser = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const ticket = await prisma.ticket.create({
    data: {
      title: "Time rules off probe",
      company: { connect: { id: company.id } },
      board: { connect: { id: board.id } },
      createdBy: { connect: { id: adminUser.id } },
      ticketNumber: `TRO-${Date.now()}`,
    },
    select: { id: true },
  });
  const agreement = await prisma.serviceAgreement.create({
    data: { name: "Off-probe block agreement", companyId: company.id, agreementType: "block", blockHoursIncluded: 10, startDate: new Date() },
  });
  await prisma.ticket.update({ where: { id: ticket.id }, data: { serviceAgreementId: agreement.id } });

  const post = (body) => fetch(`${BASE}/api/tickets/${ticket.id}/time`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });

  console.log("\nwith the flag off the entry is stored as typed");
  const evening = await (await post({ startTime: at(1, 19, 0), endTime: at(1, 21, 0), description: "Evening maintenance" })).json();
  check(evening.minutes === 120, `the minutes are stored unchanged (${evening.minutes})`);
  check(evening.overtimeMinutes === 0, `nothing is marked as overtime (${evening.overtimeMinutes})`);
  check(evening.billedMinutes === null, `no weighted total is recorded (${evening.billedMinutes})`);
  check(evening.agreementId === null, `the entry is not tied to the agreement by the rules (${evening.agreementId})`);

  const overnight = await (await post({ startTime: at(1, 23, 0), endTime: at(0, 1, 0), description: "Overnight cutover" })).json();
  check(overnight.split === undefined, "an overnight entry is not split");
  check(overnight.minutes === 120, `it stays one row of 120 minutes (${overnight.minutes})`);

  const balance = await prisma.serviceAgreement.findUnique({ where: { id: agreement.id }, select: { blockHoursUsed: true } });
  check(balance?.blockHoursUsed === 0, `the block balance is untouched (${balance?.blockHoursUsed})`);

  const rows = await prisma.timeEntry.count({ where: { ticketId: ticket.id } });
  check(rows === 2, `two entries exist for two posts (${rows})`);

  await sweep();
  console.log("  note  probe client, agreement, ticket and entries removed");

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/*
 * A failure is not a reason to leave the rows behind: the old `void main()` handed an exception straight to
 * Node, so the tidy-up at the end of the happy path never ran.
 */
main().catch(async (error) => {
  console.error("probe failed:", error.message);
  await sweep().catch(() => undefined);
  process.exit(1);
});
