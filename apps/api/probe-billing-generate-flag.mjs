/**
 * The BILLING_FROM_TICKETS_ENABLED kill switch (PLAN-013 #5).
 *
 * Run the API with `BILLING_FROM_TICKETS_ENABLED=false`, then:
 *   node probe-billing-generate-flag.mjs
 *
 * The switch hides the feature rather than refusing it, so a client does not learn that the
 * endpoint exists on this deployment.
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const res = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "persona.admin@c7ntax.local", password: PW }),
});
const { token } = await res.json();
check(res.status === 200 && !!token, `administrator signed in (${res.status})`);

const post = await fetch(`${BASE}/api/billing/invoices/generate-from-tickets`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
  body: JSON.stringify({ companyId: "00000000-0000-0000-0000-000000000000" }),
});
const body = await post.json().catch(() => ({}));
check(post.status === 404, `the endpoint reports itself missing (${post.status})`);
check(/disabled/i.test(body?.error?.message || body?.error || ""), `with a reason the operator can act on (${body?.error?.message || body?.error})`);

const preview = await fetch(`${BASE}/api/billing/invoices/unbilled/00000000-0000-0000-0000-000000000000`, {
  headers: { authorization: `Bearer ${token}` },
});
check(preview.status === 404, `the preview of an unknown client is also 404 (${preview.status})`);

const sessions = await fetch(`${BASE}/api/auth/logout`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
check(sessions.status < 500, `the session is closed again (${sessions.status})`);

const list = await fetch(`${BASE}/api/billing/invoices?limit=1`, { headers: { authorization: `Bearer ${token}` } });
check(list.status === 200, `billing itself is untouched by the flag (${list.status})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
