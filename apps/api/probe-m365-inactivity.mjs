/**
 * Microsoft 365 inactivity reporting and offboarding (PLAN-015 Phase B #12).
 *
 * The dangerous half of "find the dormant accounts" is that a report which cannot read sign-in
 * activity must not look the same as a report that found none. These assertions cover the buckets,
 * the unknown-vs-dormant distinction, per-client grouping, and offboarding raising a checklist
 * rather than disabling an account.
 *
 * Run from apps/api:  node probe-m365-inactivity.mjs
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

const STAMP = Date.now().toString(36);
const daysAgo = n => new Date(Date.now() - n * 86400000);

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  check(admin.status === 200 && tech.status === 200, `admin (${admin.status}) and technician (${tech.status}) signed in`);

  const company = await prisma.company.create({ data: { name: `Probe M365 client ${STAMP}` } });
  const otherCompany = await prisma.company.create({ data: { name: `Probe M365 other ${STAMP}` } });
  const adminUser = await prisma.user.findFirstOrThrow({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const integration = await prisma.integration.create({
    data: { kind: "microsoft365", name: `Probe M365 tenant ${STAMP}`, enabled: true, credentials: { tenantId: "t", clientId: "c", clientSecret: "s" }, settings: {} },
  });

  const contactA = await prisma.contact.create({ data: { firstName: "Probe", lastName: `Active ${STAMP}`, email: `active.${STAMP}@probe.invalid`, companyId: company.id } });
  const contactB = await prisma.contact.create({ data: { firstName: "Probe", lastName: `Dormant ${STAMP}`, email: `dormant.${STAMP}@probe.invalid`, companyId: company.id } });
  const contactC = await prisma.contact.create({ data: { firstName: "Probe", lastName: `Recent ${STAMP}`, email: `recent.${STAMP}@probe.invalid`, companyId: otherCompany.id } });

  const makeUser = (suffix, contactId, lastSignInAt, accountEnabled = true) => prisma.m365User.create({
    data: {
      integrationId: integration.id,
      azureObjectId: `probe-${STAMP}-${suffix}`,
      userPrincipalName: `probe.${suffix}.${STAMP}@probe.invalid`,
      displayName: `Probe ${suffix} ${STAMP}`,
      accountEnabled,
      lastSignInAt,
      contactId,
    },
  });

  const active = await makeUser("active", contactA.id, daysAgo(3));
  const mid = await makeUser("mid", contactA.id, daysAgo(45));
  const old = await makeUser("old", contactA.id, daysAgo(75));
  const dormant = await makeUser("dormant", contactB.id, daysAgo(220));
  const disabledDormant = await makeUser("disabled", contactB.id, daysAgo(400), false);
  const unmapped = await makeUser("unmapped", null, daysAgo(150));
  const unknown = await makeUser("unknown", contactC.id, null);

  console.log("\naccounts are bucketed by what the tenant actually reported");
  const report = await call("GET", "/api/cloudconnect/m365/inactivity", { token: admin.token });
  check(report.status === 200, `the report answers (${report.status})`);
  const body = report.data || {};
  check(body.totals?.active >= 1, `an account seen 3 days ago is active (${body.totals?.active})`);
  check(body.totals?.["30_60"] >= 1, `45 days lands in 30–60 (${body.totals?.["30_60"]})`);
  check(body.totals?.["60_90"] >= 1, `75 days lands in 60–90 (${body.totals?.["60_90"]})`);
  check(body.totals?.dormant >= 2, `150 and 220 days are dormant (${body.totals?.dormant})`);
  check(body.totals?.unknown >= 1, `an account with no sign-in stamp is unknown, not dormant (${body.totals?.unknown})`);
  check(body.withSignInData >= 5 && body.withoutSignInData >= 1, `the report separates what it knows from what it does not (${body.withSignInData} known / ${body.withoutSignInData} unknown)`);
  check(body.signInDataUnavailable === false, "and does not claim sign-in data is unavailable when some of it exists");
  check(body.disabledAccounts >= 1, `disabled accounts are counted (${body.disabledAccounts})`);

  const findUser = id => (body.clients || []).flatMap(c => c.users).find(u => u.id === id);
  check(findUser(dormant.id)?.bucket === "dormant", `the dormant account is reported dormant (${findUser(dormant.id)?.bucket})`);
  check(findUser(dormant.id)?.daysSinceSignIn >= 200, `with its age (${findUser(dormant.id)?.daysSinceSignIn} days)`);
  check(findUser(unknown.id)?.bucket === "unknown", `the account with no stamp is unknown (${findUser(unknown.id)?.bucket})`);
  check(findUser(unknown.id)?.lastSignInAt === null, "and carries no invented timestamp");
  check(findUser(disabledDormant.id)?.accountEnabled === false, "a disabled account is reported as disabled");

  console.log("\nthe report is grouped by client, with the unmapped kept separate");
  const ours = (body.clients || []).find(c => c.clientName === `Probe M365 client ${STAMP}`);
  const theirs = (body.clients || []).find(c => c.clientName === `Probe M365 other ${STAMP}`);
  const unmappedGroup = (body.clients || []).find(c => c.clientName === "Not mapped to a client");
  check(!!ours && !!theirs && !!unmappedGroup, "each client has its own group and unmapped accounts have theirs");
  check((ours?.counts.dormant ?? 0) === 2, `our client's dormant count is right (${ours?.counts.dormant})`);
  check(!!theirs?.users.find(u => u.id === unknown.id), "the unknown account sits with its own client");
  check(!!unmappedGroup?.users.find(u => u.id === unmapped.id), "and the unmapped account is not attributed to anybody");
  check((body.clients || []).every(c => c.users.length > 0), "no empty groups are returned");
  const order = (ours?.users || []).map(u => u.bucket);
  check(JSON.stringify(order) === JSON.stringify([...order].sort((a, b) => ["dormant", "unknown", "60_90", "30_60", "active"].indexOf(a) - ["dormant", "unknown", "60_90", "30_60", "active"].indexOf(b))),
    `dormant accounts come first inside a client (${order.join(", ")})`);

  console.log("\noffboarding raises a checklist, and disables nothing");
  const offboard = await call("POST", `/api/cloudconnect/m365/users/${dormant.id}/offboard`, { token: admin.token });
  check(offboard.status === 201, `a checklist was raised (${offboard.status})`);
  check(offboard.data?.tasks >= 6, `with the standard tasks (${offboard.data?.tasks})`);
  check(offboard.data?.clientName === `Probe M365 client ${STAMP}`, `filed against the right client (${offboard.data?.clientName})`);
  check(/dormant/i.test(offboard.data?.name || ""), `named after the account (${offboard.data?.name})`);
  const checklist = await prisma.checklist.findUnique({ where: { id: offboard.data?.checklistId }, include: { tasks: true } });
  check(!!checklist && checklist.tasks.length >= 6, `the checklist has its tasks in the database (${checklist?.tasks.length})`);
  check(!!checklist && checklist.tasks.some(t => /licence/i.test(t.title)), "including reclaiming the licence");
  check(!!checklist && checklist.tasks.some(t => /revoke|sign the user out/i.test(t.title)), "and revoking the sessions first");
  const afterOffboard = await prisma.m365User.findUnique({ where: { id: dormant.id }, select: { accountEnabled: true } });
  check(afterOffboard?.accountEnabled === true, "the account itself was not touched — the checklist is the output");

  const again = await call("POST", `/api/cloudconnect/m365/users/${dormant.id}/offboard`, { token: admin.token });
  check(again.status === 409, `a second checklist for the same account is refused (${again.status})`);

  const unmappedOffboard = await call("POST", `/api/cloudconnect/m365/users/${unmapped.id}/offboard`, { token: admin.token });
  check(unmappedOffboard.status === 409, `an account with no client is refused (${unmappedOffboard.status})`);
  check(/not mapped/i.test(unmappedOffboard.data?.error?.message || ""), `with the reason (${unmappedOffboard.data?.error?.message})`);

  const unknownUser = await call("POST", "/api/cloudconnect/m365/users/00000000-0000-0000-0000-000000000000/offboard", { token: admin.token });
  check(unknownUser.status === 404, `an unknown synced user is a 404 (${unknownUser.status})`);

  console.log("\npermissions");
  const techOffboard = await call("POST", `/api/cloudconnect/m365/users/${active.id}/offboard`, { token: tech.token });
  check(techOffboard.status === 403, `a technician cannot raise an offboarding checklist (${techOffboard.status})`);
  const anon = await call("GET", "/api/cloudconnect/m365/inactivity");
  check(anon.status === 401, `an unauthenticated read of the report is refused (${anon.status})`);

  // Clean up: users, contacts, checklists (with their tasks), integrations and the two clients.
  const userIds = [active.id, mid.id, old.id, dormant.id, disabledDormant.id, unmapped.id, unknown.id];
  const checklists = await prisma.checklist.findMany({ where: { companyId: { in: [company.id, otherCompany.id] } }, select: { id: true } });
  await prisma.checklistTask.deleteMany({ where: { checklistId: { in: checklists.map(c => c.id) } } });
  await prisma.checklist.deleteMany({ where: { id: { in: checklists.map(c => c.id) } } });
  await prisma.m365User.deleteMany({ where: { id: { in: userIds } } });
  await prisma.contact.deleteMany({ where: { id: { in: [contactA.id, contactB.id, contactC.id] } } });
  await prisma.integration.deleteMany({ where: { id: integration.id } });
  await prisma.company.deleteMany({ where: { id: { in: [company.id, otherCompany.id] } } });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.m365User.count({ where: { id: { in: userIds } } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} users left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
