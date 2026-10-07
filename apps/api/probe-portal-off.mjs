/**
 * The customer portal is absent unless the deployment switches it on (PLAN-013 #3).
 *
 * Run the API without `PORTAL_ENABLED` (or with it set to anything but "true"), then:
 *   node probe-portal-off.mjs
 *
 * A portal that answers "sign in" on a deployment that does not offer one is a support
 * ticket; 404 says the feature is not here, which is the truth.
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "persona.admin@c7ntax.local", password: PW }),
});
const { token } = await login.json();
check(login.status === 200 && !!token, `a staff account signed in (${login.status})`);

const cases = [
  ["POST", "/api/portal/auth/request", { email: "someone@example.invalid" }],
  ["POST", "/api/portal/auth/verify", { email: "someone@example.invalid", code: "123456" }],
  ["GET", "/api/portal/me", undefined],
  ["GET", "/api/portal/tickets", undefined],
];
for (const [method, path, body] of cases) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const payload = await res.json().catch(() => ({}));
  check(res.status === 404, `${method} ${path} reports itself missing (${res.status})`);
  if (res.status === 404) check(/not enabled/i.test(payload?.error || payload?.error?.message || ""), "  with a reason that says so");
}

const staff = await fetch(`${BASE}/api/tickets?limit=1`, { headers: { authorization: `Bearer ${token}` } });
check(staff.status === 200, `staff routes are untouched by the flag (${staff.status})`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
