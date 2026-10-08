/**
 * The inactive Microsoft 365 accounts report.
 *
 * The panel this replaced showed one number per bucket and no way to change the question. The report
 * has to be trustworthy in a different way: its options must actually change the answer, its totals
 * must agree with its own rows, and an account whose sign-in activity could not be read must never be
 * counted as dormant — that is the difference between a licence cleanup and disabling live accounts.
 *
 * Run from apps/api:  node probe-m365-inactivity-report.mjs
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

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const ENDPOINT = "/api/reports/data/m365-inactive-accounts";
const admin = await signIn("persona.admin@c7ntax.local");
if (!admin.token) { console.log("could not sign in as the admin persona — is the API running?"); process.exit(1); }

const run = async (query = "", token = admin.token) => {
  const res = await fetch(`${BASE}${ENDPOINT}${query}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  return { status: res.status, data: await res.json().catch(() => null) };
};

console.log("\nThe report answers, and says what it applied");
const base = await run();
check(base.status === 200, `GET returns 200 (${base.status})`);
const payload = base.data ?? {};
check(typeof payload.optionsLabel === "string" && payload.optionsLabel.includes("90 days"), `the payload states the threshold it used: "${payload.optionsLabel}"`);
check(payload.options?.inactiveDays === 90, "the default threshold is 90 days");
check(typeof payload.period?.label === "string", `the period is reported: "${payload.period?.label}"`);
check(Array.isArray(payload.accounts) && Array.isArray(payload.byClient) && Array.isArray(payload.byTenant), "accounts, byClient and byTenant are all present");
check(typeof payload.coverage?.accountsSynced === "number", "coverage reports how many accounts were in scope");

console.log("\nOption: the threshold changes the answer, and is clamped");
const at30 = await run("?inactiveDays=30");
const at365 = await run("?inactiveDays=365");
check(at30.data.totals.inactive >= payload.totals.inactive, `30 days finds at least as many as 90 (${at30.data.totals.inactive} vs ${payload.totals.inactive})`);
check(at365.data.totals.inactive <= payload.totals.inactive, `365 days finds no more than 90 (${at365.data.totals.inactive} vs ${payload.totals.inactive})`);
check(at30.data.options.inactiveDays === 30 && at30.data.optionsLabel.includes("30 days"), "the reported threshold follows the request");
const clampedLow = await run("?inactiveDays=0");
const clampedHigh = await run("?inactiveDays=9999");
check(clampedLow.data.options.inactiveDays === 1, `0 clamps to 1 day (${clampedLow.data.options.inactiveDays})`);
check(clampedHigh.data.options.inactiveDays === 730, `9999 clamps to 730 days (${clampedHigh.data.options.inactiveDays})`);

console.log("\nOption: unknown and disabled accounts can be excluded");
const noUnknown = await run("?includeUnknown=false");
check(noUnknown.data.options.includeUnknown === false, "the request without unknown is honoured");
check(noUnknown.data.totals.unknown === 0 && noUnknown.data.accounts.every(a => a.state !== "unknown"), "unknown accounts are gone from the totals and the rows");
const noDisabled = await run("?includeDisabled=false");
check(noDisabled.data.totals.disabled === 0 && noDisabled.data.accounts.every(a => a.state !== "disabled"), "disabled accounts are gone from the totals and the rows");
check(noUnknown.data.totals.accounts <= payload.totals.accounts, "excluding categories can only shrink the list");

console.log("\nOption: one client, or one tenant");
const clients = await prisma.company.findMany({ select: { id: true, name: true }, take: 40 });
let perClientChecked = 0;
for (const client of clients) {
  const scoped = await run(`?clientId=${client.id}`);
  const rowsOk = scoped.data.accounts.every(a => a.clientId === client.id);
  const nameOk = scoped.data.accounts.every(a => a.clientName === client.name);
  if (!rowsOk || !nameOk) { check(false, `client ${client.name}: every row belongs to that client`); continue; }
  perClientChecked++;
}
check(perClientChecked > 0, `a client filter returns only that client's accounts (checked ${perClientChecked} clients)`);
check((await run(`?clientId=${clients[0].id}`)).data.scopeLabel === clients[0].name, "the payload names the client it was scoped to");

const tenants = await prisma.integration.findMany({ where: { kind: "microsoft365" }, select: { id: true, name: true } });
if (tenants.length) {
  const oneTenant = await run(`?tenantId=${tenants[0].id}`);
  check(oneTenant.data.accounts.every(a => a.tenantId === tenants[0].id), `a tenant filter returns only ${tenants[0].name}`);
  check(oneTenant.data.byTenant.length <= 1, "and the by-tenant table agrees");
} else {
  console.log("  skip  no Microsoft 365 tenant is connected in this database");
}

console.log("\nThe totals agree with the rows");
const totals = payload.totals;
check(totals.accounts === payload.accounts.length || payload.truncated, `listed accounts match the total (${payload.accounts.length} of ${totals.accounts}${payload.truncated ? ", truncated" : ""})`);
check(
  payload.byClient.reduce((sum, c) => sum + c.accounts, 0) === totals.accounts,
  "the by-client table adds up to the total",
);
check(
  payload.byClient.reduce((sum, c) => sum + c.inactive, 0) === totals.inactive
  && payload.byClient.reduce((sum, c) => sum + c.disabled, 0) === totals.disabled
  && payload.byClient.reduce((sum, c) => sum + c.unknown, 0) === totals.unknown,
  "and so does every state column",
);
check(totals.accounts === totals.inactive + totals.disabled + totals.unknown + totals.active, "every account is in exactly one state");

console.log("\nAn account we cannot read is unknown, never dormant");
check(payload.accounts.every(a => a.state !== "inactive" || a.lastSignInAt !== null), "no account is called inactive without a sign-in date");
check(payload.accounts.every(a => a.state !== "unknown" || a.lastSignInAt === null), "unknown really means no sign-in date");
const unusable = payload.coverage.withSignInData === 0 && payload.totals.accounts > 0;
check(!unusable || payload.notes.some(n => /Entra ID P1/.test(n)), "when nothing can be read, the report says why rather than implying dormancy");
check(!payload.coverage.signInDataUnavailable || payload.totals.inactive === 0, `nothing is called inactive while sign-in data is unavailable (${payload.totals.inactive})`);

console.log("\nIt is gated like the data it exposes");
const readonly = await signIn("persona.readonly@c7ntax.local");
if (readonly.token) {
  const refused = await run("", readonly.token);
  check(refused.status === 403 || refused.status === 401, `a persona without integration:view is refused (${refused.status})`);
} else {
  console.log("  skip  no readonly persona available");
}
const anonymous = await run("", null);
check(anonymous.status === 401, `an unauthenticated read is refused (${anonymous.status})`);

await prisma.$disconnect();
console.log(`\n${pass} passing, ${fail} failing`);
process.exit(fail ? 1 : 0);
