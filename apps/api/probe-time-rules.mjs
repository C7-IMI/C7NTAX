/**
 * Time-rule assertions (PLAN-015 Phase A #1).
 *
 * Builds a throwaway client, agreement and ticket, then drives real time entries through the
 * API and inspects what was stored — the rules have to be right in the database, not just in
 * the pure functions.
 *
 * `TIME_RULES_ENABLED` must be `true` on the API process for the first half; the flag-off
 * expectations are checked against the same route by the same suite only when the process
 * has the flag off, so this file asserts the ON behaviour and prints the flag it saw.
 *
 * Run from apps/api:  node probe-time-rules.mjs
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
 * The tidy-up used to be the last five statements of the happy path, so an exception anywhere above them
 * (the API down, a check that throws, a `prisma` error) left a "TimeRules Probe …" client in the list with
 * its ticket and agreement attached. Idempotent and name-based, so both paths can call it.
 */
async function sweep() {
  const companies = await prisma.company.findMany({ where: { name: `TimeRules Probe ${STAMP}` }, select: { id: true } });
  for (const company of companies) {
    const tickets = await prisma.ticket.findMany({ where: { companyId: company.id }, select: { id: true } });
    const ticketIds = tickets.map((t) => t.id);
    await prisma.timeEntry.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
    await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
    await prisma.serviceAgreement.deleteMany({ where: { companyId: company.id } });
    await prisma.company.delete({ where: { id: company.id } });
  }
  const adminUser = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  if (adminUser) await prisma.userSession.deleteMany({ where: { userId: adminUser.id } });
  return companies.length;
}

/** A local date at a given clock time, so the cut-off comparison is tested in server-local time. */
const at = (daysAgo, hours, minutes = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(hours, minutes, 0, 0);
  return d;
};

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  check(admin.status === 200, `administrator signed in (${admin.status})`);

  const company = await prisma.company.create({ data: { name: `TimeRules Probe ${STAMP}`, companyType: "Client" } });
  const board = await prisma.serviceBoard.findFirst({ select: { id: true } });
  const techUser = await prisma.user.findFirst({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const ticket = await prisma.ticket.create({
    data: {
      title: "Time rules probe",
      company: { connect: { id: company.id } },
      board: { connect: { id: board.id } },
      createdBy: { connect: { id: techUser.id } },
      ticketNumber: `TRP-${Date.now()}`,
    },
    select: { id: true },
  });

  const agreementPayload = {
    name: "Probe block agreement",
    companyId: company.id,
    agreementType: "block",
    blockHoursIncluded: 10,
    hourlyRate: 250,
    rateTier: "advanced",
  };

  console.log("\nagreement time rules are validated");
  const badType = await call("POST", "/api/billing/agreements", { token: admin.token, body: { ...agreementPayload, agreementType: "nonsense" } });
  check(badType.status === 400, `an unknown agreement type is refused (${badType.status})`);
  const badClock = await call("POST", "/api/billing/agreements", { token: admin.token, body: { ...agreementPayload, overtimeAfter: "25:99" } });
  check(badClock.status === 400, `an impossible cut-off is refused (${badClock.status})`);
  const badMultiplier = await call("POST", "/api/billing/agreements", { token: admin.token, body: { ...agreementPayload, overtimeMultiplier: 9 } });
  check(badMultiplier.status === 400, `a multiplier outside 1–5 is refused (${badMultiplier.status})`);

  const created = await call("POST", "/api/billing/agreements", { token: admin.token, body: agreementPayload });
  check(created.status === 201, `a block agreement is created (${created.status})`);
  const agreement = created.data;
  check(agreement?.agreementType === "block" && agreement?.blockHoursIncluded === 10, `the agreement stores its type and allowance (${agreement?.agreementType}/${agreement?.blockHoursIncluded})`);

  await prisma.ticket.update({ where: { id: ticket.id }, data: { serviceAgreementId: agreement.id } });

  console.log("\novertime weighting — 2h entirely after 18:00 is billed as 3h");
  const evening = await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(1, 19, 0), endTime: at(1, 21, 0), description: "Evening maintenance" },
  });
  check(evening.status === 201, `the evening entry is accepted (${evening.status})`);
  check(evening.data?.minutes === 120, `it stores the plain 120 minutes (${evening.data?.minutes})`);
  check(evening.data?.overtimeMinutes === 120, `all of it counts as overtime (${evening.data?.overtimeMinutes})`);
  check(evening.data?.billedMinutes === 180, `billing minutes are 180 for 1.5:1 (${evening.data?.billedMinutes})`);
  check(evening.data?.agreementId === agreement.id, "the entry records which agreement it belongs to");

  const afterEvening = await prisma.serviceAgreement.findUnique({ where: { id: agreement.id }, select: { blockHoursUsed: true } });
  check(afterEvening?.blockHoursUsed === 3, `the block balance is deducted 3 hours (${afterEvening?.blockHoursUsed})`);

  console.log("\novertime weighting — a split window only weights the evening part");
  const mixed = await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(1, 17, 0), endTime: at(1, 19, 0), description: "Late afternoon work" },
  });
  check(mixed.data?.minutes === 120 && mixed.data?.overtimeMinutes === 60 && mixed.data?.billedMinutes === 150, `17:00–19:00 → 120 minutes, 60 overtime, 150 billed (${mixed.data?.minutes}/${mixed.data?.overtimeMinutes}/${mixed.data?.billedMinutes})`);

  console.log("\na day entry is untouched by the rules");
  const daytime = await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(1, 9, 0), endTime: at(1, 11, 30), description: "Morning work" },
  });
  check(daytime.data?.minutes === 150 && daytime.data?.overtimeMinutes === 0 && daytime.data?.billedMinutes === 150, `09:00–11:30 → 150 minutes, no overtime (${daytime.data?.billedMinutes})`);

  console.log("\nmidnight split — 23:00 to 01:00 becomes two linked entries");
  const overnight = await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(1, 23, 0), endTime: at(0, 1, 0), description: "Overnight cutover" },
  });
  check(overnight.status === 201, `the overnight entry is accepted (${overnight.status})`);
  const split = overnight.data?.split ?? [];
  check(split.length === 1, `one extra row is created (${split.length})`);
  check(overnight.data?.minutes === 60, `the first row keeps the pre-midnight hour (${overnight.data?.minutes})`);
  check(split[0]?.minutes === 60, `the second row carries the post-midnight hour (${split[0]?.minutes})`);
  check(split[0]?.splitFrom === overnight.data?.id, "the second row points back at the first");
  check(!!split[0]?.startTime && new Date(split[0].startTime).getHours() === 0, `the second row starts at midnight (${split[0]?.startTime})`);
  check(new Date(overnight.data.date).getDate() !== new Date(split[0].date).getDate(), "the two rows sit on different work dates");
  check(split[0]?.overtimeMinutes === 60 && split[0]?.billedMinutes === 90, `the post-midnight hour is overnight-weighted (${split[0]?.billedMinutes})`);

  console.log("\nnon-chargeable work does not spend the allowance");
  const before = (await prisma.serviceAgreement.findUnique({ where: { id: agreement.id }, select: { blockHoursUsed: true } }))?.blockHoursUsed;
  await call("POST", `/api/tickets/${ticket.id}/time`, {
    token: admin.token,
    body: { startTime: at(1, 19, 0), endTime: at(1, 21, 0), description: "Goodwill work", noCharge: true },
  });
  const after = (await prisma.serviceAgreement.findUnique({ where: { id: agreement.id }, select: { blockHoursUsed: true } }))?.blockHoursUsed;
  check(before === after, `the balance is unchanged by a no-charge entry (${before} → ${after})`);

  console.log("\nplain minutes with no clock are never weighted");
  const bare = await call("POST", `/api/tickets/${ticket.id}/time`, { token: admin.token, body: { minutes: 90, description: "No clock" } });
  check(bare.data?.billedMinutes === 90 && bare.data?.overtimeMinutes === 0, `90 minutes stays 90 (${bare.data?.billedMinutes})`);

  // Tidy up: the probe's client takes its agreement, ticket and entries with it.
  await sweep();
  console.log("  note  probe client, agreement, ticket and entries removed");

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/*
 * A failure is not a reason to leave the rows behind. The old `void main()` handed an exception straight to
 * Node, so the tidy-up at the end of the happy path never ran and the residue was somebody else's problem —
 * which is what `clean-probe-residue.ts` exists to sweep up after the fact.
 */
main().catch(async (error) => {
  console.error("probe failed:", error.message);
  await sweep().catch(() => undefined);
  process.exit(1);
});
