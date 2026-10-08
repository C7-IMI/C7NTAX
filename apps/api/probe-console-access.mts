/**
 * probe-console-access â€” the four gates that decide whether somebody gets the console.
 *
 * The claim being tested is the operator's: *"The console icon shouldn't even be displayed, if they don't
 * have permissions to it."* An icon is decided in the browser, so the server-side half is proven here and
 * the interface half is walked by hand â€” but what matters for both is that **the permission the API
 * enforces and the permission the interface reads are one value**, and that is what this checks:
 *
 *   1. the role grants `console:use` â†’ the catalogue is served
 *   2. an individual *removal* takes it away (`User.deniedPermissions`)
 *   3. the client's own switch takes it away (`Company.consoleEnabled = false`)
 *   4. the deployment switch takes it away (`app_settings.general.console = false`)
 *
 * The personnel is a throwaway account created and deleted by this run, because the alternative is
 * editing a real person's permissions to test something. Every mutation is undone in a `finally`, and the
 * probe asserts the *effective* set the session reports rather than re-deriving it from the database â€” the
 * session is what the interface is drawn from.
 *
 * Requires the API running (default http://localhost:4000) with the seeded administrator.
 * Run with: pnpm --filter @C7NTAX/api exec tsx probe-console-access.mts
 */
import { PrismaClient } from "@prisma/client";

/*
 * Its own client rather than the API's: importing `src/index.ts` would **start the server**, so the probe
 * would either fight the running API for port 4000 or, worse, appear to pass against a second copy of the
 * application with a different set of modules loaded. A probe measures the deployment that is running; it
 * does not become one.
 */
const prisma = new PrismaClient();

const BASE = process.env.C7NTAX_API ?? "http://localhost:4000/api";
const EMAIL = process.env.C7NTAX_EMAIL ?? "admin@C7NTAX.com";
const PASSWORD = process.env.C7NTAX_PASSWORD ?? "admin";

let passed = 0;
const failures: string[] = [];
const check = (name: string, condition: boolean, detail = ""): void => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` â€” ${detail}` : ""}`);
};

/** The session cookie pair(s) a sign-in sets, so `/auth/session` can be asked with them. */
type Session = { token?: string; permissions?: string[]; cookie?: string };

async function signIn(email: string, password: string): Promise<Session> {
  const response = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const pairs = (response.headers.getSetCookie?.() ?? []).map((value) => value.split(";")[0]);
  const body = await response.json();
  return { ...body, cookie: pairs.join("; ") };
}

/**
 * What the session says it holds â€” the same list the interface draws the header from.
 *
 * The cookie, not the bearer token: `/auth/session` answers from the cookie because the browser calls it
 * on every page load with nothing else, and that is the path under test here. Asking it with a bearer
 * token gets a 401, which reads as "zero permissions" and looks like the revocation working when it is
 * only the question being wrong.
 */
async function sessionPermissions(session: Session): Promise<string[]> {
  const response = await fetch(`${BASE}/auth/session`, { headers: { cookie: session.cookie ?? "" } });
  const body = await response.json();
  return body.permissions ?? [];
}

async function catalogueStatus(token: string): Promise<number> {
  const response = await fetch(`${BASE}/console/catalog`, { headers: { authorization: `Bearer ${token}` } });
  return response.status;
}

const admin = await signIn(EMAIL, PASSWORD);
if (!admin.token) {
  console.error(`probe-console-access: could not sign in as the administrator (is the API running?)`);
  process.exit(1);
}
const adminAuth = { authorization: `Bearer ${admin.token}`, "content-type": "application/json" };

// â”€â”€ A throwaway technician, and a client to place them in â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const stamp = Date.now();
const technicianRole = await prisma.role.findFirst({ where: { systemRole: "technician" }, select: { id: true, name: true } });
check("a technician role exists to test the default grant", Boolean(technicianRole), "no role with systemRole technician");

const client = await prisma.company.findFirst({ where: { consoleEnabled: null }, select: { id: true, name: true } });
check("a client is available to test the per-client switch", Boolean(client), "every client already carries a console setting");

let userId: string | null = null;
const created: string[] = [];

try {
  const create = await fetch(`${BASE}/users`, {
    method: "POST",
    headers: adminAuth,
    body: JSON.stringify({
      email: `probe-console-${stamp}@example.test`,
      firstName: "Probe",
      lastName: "Console",
      password: "Qx7-Vermilion-Turnip-42!",
      // `credentialMode: "set"` is required, not decorative: without it the route *generates* a password
      // and shows it once, so the probe would be asserting against an account it cannot sign in as.
      credentialMode: "set",
      roleId: technicianRole?.id,
      companyId: client?.id,
      requireChange: false,
    }),
  });
  const user = await create.json();
  userId = user.id ?? null;
  check("the probe's account can be created", Boolean(userId), `HTTP ${create.status} ${JSON.stringify(user).slice(0, 160)}`);
  if (!userId) throw new Error("cannot continue without an account");

  const email = user.email as string;

  // â”€â”€ 1. The role's default grant â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const first = await signIn(email, "Qx7-Vermilion-Turnip-42!");
  check("the throwaway account can sign in", Boolean(first.token), JSON.stringify(first).slice(0, 200));
  if (!first.token) throw new Error(`cannot continue without a session: ${JSON.stringify(first).slice(0, 200)}`);

  const held = await sessionPermissions(first);
  check("the technician role grants console:use", held.includes("console:use"), `held ${held.length} permissions`);
  check("the sign-in response publishes the same set", (first.permissions ?? []).includes("console:use"), `held ${(first.permissions ?? []).length}`);
  check("the catalogue is served to them", (await catalogueStatus(first.token)) === 200);

  // â”€â”€ 2. An individual removal â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const deny = await fetch(`${BASE}/users/${userId}`, {
    method: "PATCH",
    headers: adminAuth,
    body: JSON.stringify({ deniedPermissions: ["console:use"] }),
  });
  check("an administrator can remove it for one person", deny.ok, `HTTP ${deny.status} ${(await deny.text()).slice(0, 140)}`);
  created.push("deniedPermissions");

  const afterDeny = await sessionPermissions(first);
  check("the removal reaches the session on the next request", !afterDeny.includes("console:use"), afterDeny.filter((p) => p.startsWith("console")).join(","));
  check("the catalogue is refused to them", (await catalogueStatus(first.token)) === 403);

  const second = await signIn(email, "Qx7-Vermilion-Turnip-42!");
  check("a fresh sign-in does not reinstate it", !(second.permissions ?? []).includes("console:use"), (second.permissions ?? []).filter((p) => p.startsWith("console")).join(","));
  /*
   * One live session per account: signing in again retires the cookie the first one was given, so every
   * check from here on asks with the newest. Reading the old cookie would come back 401 â€” an empty list,
   * which quietly satisfies a `!includes(...)` and fails a `includes(...)` for the wrong reason.
   */
  check("the second sign-in is now the live session, the first is not", (await sessionPermissions({ cookie: first.cookie })).length === 0);
  const technician = second;

  // â”€â”€ 3. The client's own switch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const reGrant = await fetch(`${BASE}/users/${userId}`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ deniedPermissions: [] }) });
  check("the removal can be undone", reGrant.ok, `HTTP ${reGrant.status}`);
  check("the permission is back", (await sessionPermissions(technician)).includes("console:use"));

  const clientOff = await fetch(`${BASE}/clients/${client?.id}`, {
    method: "PATCH",
    headers: adminAuth,
    body: JSON.stringify({ consoleEnabled: false }),
  });
  check("an administrator can switch the console off for a client", clientOff.ok, `HTTP ${clientOff.status} ${(await clientOff.text()).slice(0, 140)}`);
  created.push("client.consoleEnabled");

  const withClientOff = await sessionPermissions(technician);
  check("the client's switch reaches the session", !withClientOff.includes("console:use"), withClientOff.filter((p) => p.startsWith("console")).join(","));
  check("the catalogue is refused while their client has it off", (await catalogueStatus(first.token)) === 403);

  // Another client's staff are unaffected: the switch is per client, not per deployment.
  const elsewhere = await signIn(EMAIL, PASSWORD);
  check("an account outside that client still holds it", (await sessionPermissions(elsewhere)).includes("console:use"));

  // â”€â”€ 4. The deployment switch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  await fetch(`${BASE}/clients/${client?.id}`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ consoleEnabled: null }) });
  const deployOff = await fetch(`${BASE}/configuration/workspace/console`, {
    method: "PATCH",
    headers: adminAuth,
    body: JSON.stringify({ value: false }),
  });
  check("the deployment switch can be turned off", deployOff.ok, `HTTP ${deployOff.status}`);
  created.push("deployment.console");

  const deploymentResponse = await fetch(`${BASE}/console/catalog`, { headers: adminAuth });
  check("the catalogue answers 404 while the console is off", deploymentResponse.status === 404, `HTTP ${deploymentResponse.status}`);

  const deployOn = await fetch(`${BASE}/configuration/workspace/console`, { method: "PATCH", headers: adminAuth, body: JSON.stringify({ value: true }) });
  check("the deployment switch can be turned back on", deployOn.ok, `HTTP ${deployOn.status}`);
  check("the catalogue is served again", (await catalogueStatus(admin.token)) === 200);
} finally {
  /*
   * Put everything back. A probe that leaves a permission revoked, a client switched off or an account
   * behind has changed the deployment it was measuring, which is worse than not having measured.
   */
  if (userId) {
    await prisma.user.delete({ where: { id: userId } }).catch(() => undefined);
  }
  if (client?.id) {
    await prisma.company.update({ where: { id: client.id }, data: { consoleEnabled: null } }).catch(() => undefined);
  }
  const config = await prisma.systemConfig.findUnique({ where: { key: "app_settings" } }).catch(() => null);
  const blob = (config?.value ?? {}) as { general?: Record<string, unknown> };
  if (blob.general && blob.general.console === false) {
    await prisma.systemConfig
      .update({ where: { key: "app_settings" }, data: { value: { ...blob, general: { ...blob.general, console: true } } as object } })
      .catch(() => undefined);
  }
}

// The probe's account is gone; nothing it touched remains.
const leftover = userId ? await prisma.user.findUnique({ where: { id: userId } }) : null;
check("the probe's account was removed", leftover === null);
if (client?.id) {
  const clientRow = await prisma.company.findUnique({ where: { id: client.id }, select: { consoleEnabled: true } });
  check("the client's console setting was restored", clientRow?.consoleEnabled === null, String(clientRow?.consoleEnabled));
}

console.log(`probe-console-access: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  âœ— ${failure}`);
  process.exit(1);
}
await prisma.$disconnect();
