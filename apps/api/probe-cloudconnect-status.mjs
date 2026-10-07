/**
 * Live integration health (PLAN-015 Phase B #9).
 *
 * The point of this endpoint is that a screen never has to say "we think it is fine": the status it
 * shows is a status the server verified, on a throttle it can afford. These assertions cover the
 * three ways that can go wrong — a request that cannot succeed being sent anyway, a vendor being
 * hammered by however many tabs are open, and a chip that disagrees with the row it describes.
 *
 * Run from apps/api:  node probe-cloudconnect-status.mjs
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

const ADMIN = "persona.admin@c7ntax.local";
const READONLY = "persona.readonly@c7ntax.local";
const STAMP = Date.now().toString(36);

async function main() {
  const admin = await signIn(ADMIN);
  const readonly = await signIn(READONLY);
  check(admin.status === 200 && readonly.status === 200, `admin (${admin.status}) and read-only (${readonly.status}) signed in`);

  await prisma.integration.deleteMany({ where: { name: { startsWith: "Probe live " } } });

  /** New integrations default to switched off, so the probe enables them the way the page does. */
  const createEnabled = async (name, credentials) => {
    const created = await call("POST", "/api/cloudconnect", { token: admin.token, body: { kind: "quickbooks", name, credentials, settings: {} } });
    if (created.data?.id) await call("PATCH", `/api/cloudconnect/${created.data.id}`, { token: admin.token, body: { enabled: true } });
    return created;
  };

  console.log("\nan incomplete connection is never called at all");
  const incomplete = await createEnabled(`Probe live incomplete ${STAMP}`, { clientId: "abc", clientSecret: "" });
  check(incomplete.status === 201, `an integration missing a required credential exists (${incomplete.status})`);
  const incompleteId = incomplete.data?.id;

  const first = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  check(first.status === 200 && first.data?.enabled === true, `the status endpoint answers with live checking on (${first.status})`);
  const incompleteRow = (first.data?.data || []).find(r => r.id === incompleteId);
  check(incompleteRow?.health?.state === "unconfigured", `it reads as unconfigured (${incompleteRow?.health?.state})`);
  check(
    JSON.stringify(incompleteRow?.health?.missingFields) === JSON.stringify(["clientSecret", "realmId", "accessToken"]),
    `and names every field it is waiting on (${JSON.stringify(incompleteRow?.health?.missingFields)})`,
  );
  check(/nothing is sent/i.test(incompleteRow?.health?.detail || ""), `with a detail that says no call was made (${incompleteRow?.health?.detail})`);
  check(incompleteRow?.health?.verifiedAt === null, "and no verification timestamp, because none happened");
  check(incompleteRow?.status !== "connected", `the stored status was not moved to connected (${incompleteRow?.status})`);

  console.log("\na complete connection is verified, and the answer is written where the badge reads it");
  const complete = await createEnabled(`Probe live complete ${STAMP}`, { clientId: "probe", clientSecret: "probe", realmId: "probe", accessToken: "probe" });
  const completeId = complete.data?.id;
  check(complete.status === 201, `a fully configured integration exists (${complete.status})`);
  const second = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  const completeRow = (second.data?.data || []).find(r => r.id === completeId);
  check(completeRow?.health?.verifiedAt !== null, `it was verified (${completeRow?.health?.verifiedAt})`);
  check(typeof completeRow?.health?.ageSeconds === "number" && completeRow.health.ageSeconds < 60, `just now (${completeRow?.health?.ageSeconds}s ago)`);
  check(["healthy", "degraded"].includes(completeRow?.health?.state || ""), `and reported as one or the other, never as unconfigured (${completeRow?.health?.state})`);
  check(completeRow?.health?.stale === false, "and not stale, so the number on screen is real");
  const storedRow = await prisma.integration.findUnique({ where: { id: completeId }, select: { status: true } });
  check(storedRow?.status === completeRow?.status, `the stored status and the health state agree (${storedRow?.status})`);

  console.log("\nthe throttle holds: polling does not mean re-checking");
  const before = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  const stampBefore = (before.data?.data || []).find(r => r.id === completeId)?.health?.verifiedAt;
  await new Promise(resolve => setTimeout(resolve, 1200));
  const after = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  const stampAfter = (after.data?.data || []).find(r => r.id === completeId)?.health?.verifiedAt;
  check(stampBefore === stampAfter, `three polls in a row did not re-verify (${stampBefore === stampAfter ? "one check" : "re-checked"})`);

  console.log("\na hand-run test updates the chip immediately");
  const tested = await call("POST", `/api/cloudconnect/${completeId}/test`, { token: admin.token });
  check(tested.status === 200, `the connection test ran (${tested.status})`);
  const statusAfterTest = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  const afterTestRow = (statusAfterTest.data?.data || []).find(r => r.id === completeId);
  check(afterTestRow?.health?.detail?.includes("connection test"), `the chip says a human verified it (${afterTestRow?.health?.detail})`);
  check((afterTestRow?.health?.ageSeconds ?? 999) <= 5, `from just now (${afterTestRow?.health?.ageSeconds}s)`);

  console.log("\ndisabled connections are described, not verified");
  const disabled = await createEnabled(`Probe live disabled ${STAMP}`, { clientId: "probe", clientSecret: "probe", realmId: "probe", accessToken: "probe" });
  await call("PATCH", `/api/cloudconnect/${disabled.data?.id}`, { token: admin.token, body: { enabled: false } });
  const third = await call("GET", "/api/cloudconnect/status", { token: admin.token });
  const disabledRow = (third.data?.data || []).find(r => r.id === disabled.data?.id);
  check(disabledRow?.health?.state === "off", `a switched-off integration reads as off (${disabledRow?.health?.state})`);
  check(disabledRow?.health?.verifiedAt === null, "and is not verified, because it is not in use");
  check(/not being verified/i.test(disabledRow?.health?.detail || ""), `and says so (${disabledRow?.health?.detail})`);

  console.log("\nthe page's own endpoints still carry everything the row needs");
  const list = await call("GET", "/api/cloudconnect", { token: admin.token });
  check(list.status === 200 && Array.isArray(list.data?.data), `the integration list still answers (${list.status})`);
  const rowFromList = (list.data?.data || []).find(r => r.id === completeId);
  check(!!rowFromList?.credentials, "and still carries the credentials the fix dialog edits");
  check(rowFromList?.status === afterTestRow?.status, "with the same status the chip shows");

  console.log("\npermissions");
  // The read-only persona holds no integration permissions at all, so the gate is asserted by
  // comparing the new endpoint with the list it belongs to rather than by assuming a roster.
  const readonlyList = await call("GET", "/api/cloudconnect", { token: readonly.token });
  const readonlyRead = await call("GET", "/api/cloudconnect/status", { token: readonly.token });
  check(readonlyRead.status === readonlyList.status, `the status endpoint is gated exactly like the integration list (${readonlyRead.status} vs ${readonlyList.status})`);
  check(readonlyRead.status === 403, `which for this account is a refusal (${readonlyRead.status})`);
  const anon = await call("GET", "/api/cloudconnect/status");
  check(anon.status === 401, `an unauthenticated read is refused (${anon.status})`);

  await prisma.integration.deleteMany({ where: { name: { startsWith: "Probe live " } } });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: [ADMIN, READONLY] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.integration.count({ where: { name: { startsWith: "Probe live " } } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} integrations left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
