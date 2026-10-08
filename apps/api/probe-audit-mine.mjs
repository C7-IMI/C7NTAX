/**
 * probe-audit-mine — the two additions the Recent menu depends on.
 *
 * 1. `GET /api/system/audit-logs?mine=true` returns **the caller's own** rows and nobody else's. The
 *    menu reads this, so "mine" answering with a colleague's activity would be a privacy defect rather
 *    than a display bug — which is why the assertion is that every returned row names the caller, not
 *    merely that some rows came back.
 * 2. A **creation names the record it created.** Before this, `POST /api/clients` stored the literal
 *    string `clients` as the row's entity id — there is no `:id` in that path — so nothing could link
 *    to the thing that was made. The middleware now captures the response body, and this asserts the
 *    new row carries the created client's id.
 *
 * Requires the API running with the seeded administrator.
 * Run with: pnpm --filter @C7NTAX/api exec tsx probe-audit-mine.mjs
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
  console.error(`probe-audit-mine: could not sign in (${login.status})`);
  process.exit(1);
}
const auth = { authorization: `Bearer ${session.token}`, "content-type": "application/json" };

const me = await (await fetch(`${BASE}/users/me`, { headers: auth })).json();
check("the caller can be identified", typeof me.id === "string" && me.id.length > 8, JSON.stringify(me.id));

// ── 1. mine=true is the caller's own ───────────────────────────────────
const mineResponse = await fetch(`${BASE}/system/audit-logs?mine=true&limit=25`, { headers: auth });
check("mine=true is served", mineResponse.status === 200, `HTTP ${mineResponse.status}`);
const mine = (await mineResponse.json()).data ?? [];
check("mine=true returns rows", mine.length > 0, `${mine.length}`);
check("every row names the caller", mine.every((row) => row.userId === me.id), `${mine.filter((r) => r.userId !== me.id).length} foreign rows`);
check("the limit is honoured", mine.length <= 25, `${mine.length}`);

const all = (await (await fetch(`${BASE}/system/audit-logs?limit=500`, { headers: auth })).json()).data ?? [];
check("the unfiltered read is still wider than mine", all.length >= mine.length, `${all.length} vs ${mine.length}`);
check("the unfiltered read contains other people", all.some((row) => row.userId !== me.id), "nobody else in the trail");

const ordered = mine.every((row, index) => index === 0 || new Date(mine[index - 1].createdAt) >= new Date(row.createdAt));
check("rows are newest first", ordered);

// ── 2. A creation names the record ─────────────────────────────────────
const stamp = Date.now();
const created = await fetch(`${BASE}/clients`, {
  method: "POST",
  headers: auth,
  body: JSON.stringify({ name: `Probe Audit Client ${stamp}`, companyType: "MSP" }),
});
check("a client can be created", created.status === 201 || created.status === 200, `HTTP ${created.status}`);
const client = await created.json();
check("the creation returns an id", typeof client.id === "string" && client.id.length > 8, JSON.stringify(client.id));

// The audit row is written when the response finishes, so give it a moment rather than assuming.
await new Promise((resolve) => setTimeout(resolve, 900));
const afterCreate = (await (await fetch(`${BASE}/system/audit-logs?mine=true&limit=10`, { headers: auth })).json()).data ?? [];
const creationRow = afterCreate.find((row) => row.entityId === client.id);
check("the creation's audit row names the created record, not the collection", Boolean(creationRow),
  creationRow ? "" : `rows: ${afterCreate.map((r) => `${r.action}/${r.entityId}`).join(", ")}`);
check("that row is attributed to the caller", creationRow?.userId === me.id, String(creationRow?.userId));

// ── Clean up after ourselves ───────────────────────────────────────────
const deleted = await fetch(`${BASE}/clients/${client.id}`, { method: "DELETE", headers: auth });
check("the probe's client can be deleted again", deleted.ok, `HTTP ${deleted.status}`);

console.log(`probe-audit-mine: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
