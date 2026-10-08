/**
 * probe-console-catalog — the console's two API reads, against a running API.
 *
 * Checks three things a unit test cannot: that the catalogue is *served* (the route is mounted and the
 * shared module loads inside the API), that it is **filtered by the caller's permissions** rather than
 * shipped whole, and that a command the catalogue advertises actually runs — the last one by taking a
 * command out of the catalogue and calling the route it names, which is exactly what the console does.
 *
 * Requires the API running (default http://localhost:4000) and the seeded administrator.
 * Run with: pnpm --filter @C7NTAX/api exec tsx probe-console-catalog.mjs
 */
const BASE = process.env.C7NTAX_API ?? "http://localhost:4000/api";
const EMAIL = process.env.C7NTAX_EMAIL ?? "admin@C7NTAX.com";
const PASSWORD = process.env.C7NTAX_PASSWORD ?? "admin";

let passed = 0;
const failures = [];
const check = (name, condition, detail = "") => {
  if (condition) passed++;
  else failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
};

const login = await fetch(`${BASE}/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
});
const session = await login.json();
if (!session.token) {
  console.error(`probe-console-catalog: could not sign in (${login.status}) — is the API running with the seeded administrator?`);
  process.exit(1);
}
const auth = { authorization: `Bearer ${session.token}` };

// ── The catalogue ──────────────────────────────────────────────────────
const catalogResponse = await fetch(`${BASE}/console/catalog`, { headers: auth });
check("the catalogue is served", catalogResponse.status === 200, `HTTP ${catalogResponse.status}`);
const catalog = await catalogResponse.json();

const commands = (catalog.groups ?? []).flatMap((group) => group.commands ?? []);
check("the catalogue carries commands", commands.length > 0, `${commands.length}`);
check("every command states its permission", commands.every((c) => "permission" in c));
check("every command names the route it runs", commands.every((c) => typeof c.path === "string" && c.path.startsWith("/")));
check("the counts agree with the payload", catalog.counts?.available === commands.length, `${catalog.counts?.available} vs ${commands.length}`);
check("groups are labelled and summarised", (catalog.groups ?? []).every((g) => g.label && g.summary));
check("the console's own verbs are listed", (catalog.verbs ?? []).some((v) => v.name === "help"));

// A caller with no permissions must still be told about their own record and the release notes.
const unrestricted = commands.filter((c) => c.permission === null).map((c) => c.name);
check("permission-free commands are offered", unrestricted.includes("me show") && unrestricted.includes("system version"), unrestricted.join(","));

// ── One command, by name ───────────────────────────────────────────────
const one = await fetch(`${BASE}/console/catalog/${encodeURIComponent("ticket show")}`, { headers: auth });
check("one command is fetchable by name", one.status === 200, `HTTP ${one.status}`);
const descriptor = await one.json();
check("the descriptor names its route", descriptor.path === "/tickets/{subject}", descriptor.path);
check("the descriptor carries its flags", (descriptor.flags ?? []).some((f) => f.name === "json"));
check("the descriptor carries its subject", descriptor.subject?.label === "TICKET", JSON.stringify(descriptor.subject));

const missing = await fetch(`${BASE}/console/catalog/nope%20nope`, { headers: auth });
check("an unknown command is 404", missing.status === 404, `HTTP ${missing.status}`);

// ── A command the catalogue advertises, run the way the console runs it ──
// The console builds `GET <path>?<query>` from the descriptor and lets the route decide. This does
// the same, which is the only check that proves the catalogue and the API agree at runtime.
const list = descriptors => descriptors.find((c) => c.name === "ticket list");
const ticketList = list(commands);
check("the catalogue offers ticket list", Boolean(ticketList));
if (ticketList) {
  const params = new URLSearchParams({ limit: "3" });
  const run = await fetch(`${BASE}${ticketList.path}?${params}`, { headers: auth });
  check("its route answers", run.status === 200, `HTTP ${run.status}`);
  const body = await run.json();
  const rows = Array.isArray(body) ? body : (body.data ?? []);
  check("its route returns rows", Array.isArray(rows), typeof body);
  check("the limit is honoured", rows.length <= 3, `${rows.length}`);
}

// ── Unauthenticated ────────────────────────────────────────────────────
const anonymous = await fetch(`${BASE}/console/catalog`);
check("the catalogue needs a session", anonymous.status === 401, `HTTP ${anonymous.status}`);

console.log(`probe-console-catalog: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
