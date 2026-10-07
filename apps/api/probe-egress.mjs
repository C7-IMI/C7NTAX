/**
 * Egress policy end-to-end probe (W0 step E).
 *
 * Drives the real API: a provider endpoint and a monitor URL that point at internal
 * addresses must be refused with a readable message, a legitimate endpoint must still
 * be accepted, and the alert monitor must keep working for the seeded services.
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const errText = (data) => (typeof data?.error === "string" ? data.error : data?.error?.message || JSON.stringify(data));

async function call(method, path, token, body) {
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* 204 etc */ }
  return { status: res.status, data, message: errText(data) };
}

const r = await call("POST", "/auth/login", null, { email: "admin@C7NTAX.com", password: "admin" });
if (!r.data?.token) {
  console.log("could not sign in as the bypass account:", r.status, JSON.stringify(r.data).slice(0, 200));
  process.exit(1);
}
const token = r.data.token;
console.log(`signed in (${r.status})`);

console.log("\ninference provider endpoint");
const blocked = [
  ["http://169.254.169.254/latest/meta-data/", "metadata"],
  ["http://localhost:5432/", "loopback database port"],
  ["https://10.42.0.9/v1/chat/completions", "RFC1918"],
  ["file:///etc/passwd", "file scheme"],
];
for (const [endpoint, why] of blocked) {
  const res = await call("POST", "/inference/providers", token, { name: `probe-${Date.now()}`, provider: "custom", apiEndpoint: endpoint, isActive: false });
  check(res.status === 400 && /endpoint rejected/i.test(res.message), `create refused (${why}) -> ${res.status} ${res.message}`);
}

const created = await call("POST", "/inference/providers", token, { name: `probe-egress-${Date.now()}`, provider: "custom", model: "m", apiEndpoint: "https://api.openai.com/v1/chat/completions", apiKey: "sk-not-a-real-key", isActive: false });
check(created.status === 201, `legitimate endpoint accepted -> ${created.status} ${created.message}`);
const providerId = created.data?.id;
check(created.data && !("apiKey" in created.data), "api key not echoed back");

if (providerId) {
  const patched = await call("PATCH", `/inference/providers/${providerId}`, token, { apiEndpoint: "http://169.254.169.254/" });
  check(patched.status === 400, `update refused -> ${patched.status} ${patched.message}`);
  const after = await call("GET", "/inference/providers", token);
  const row = ((after.data?.data ?? after.data) || []).find(p => p.id === providerId);
  check(row?.apiEndpoint === "https://api.openai.com/v1/chat/completions", `refused update did not persist the blocked value (stored: ${row?.apiEndpoint})`);
  const del = await call("DELETE", `/inference/providers/${providerId}`, token);
  check(del.status === 200, `probe provider removed -> ${del.status}`);
}

console.log("\nservice alert URLs");
const svc = await call("POST", "/service-alerts/services", token, { name: `probe-egress-${Date.now()}`, monitorKind: "website", monitorUrl: "http://169.254.169.254/" });
check(svc.status === 400 && /monitorUrl rejected/i.test(svc.message), `create refused on monitorUrl -> ${svc.status} ${svc.message}`);

const svc2 = await call("POST", "/service-alerts/services", token, { name: `probe-egress-${Date.now()}`, rssUrl: "http://10.0.0.7/feed.xml" });
check(svc2.status === 400 && /rssUrl rejected/i.test(svc2.message), `create refused on rssUrl -> ${svc2.status} ${svc2.message}`);

const services = await call("GET", "/service-alerts/services", token);
const real = ((services.data?.data ?? services.data) || []).find(s => s.rssUrl || s.statusPageUrl || s.monitorUrl);
check(!!real, "seeded services still present");
if (real) {
  const before = { rssUrl: real.rssUrl, monitorUrl: real.monitorUrl, statusPageUrl: real.statusPageUrl };
  const patch = await call("PATCH", `/service-alerts/services/${real.id}`, token, { statusPageUrl: "http://192.168.9.9/" });
  check(patch.status === 400, `update refused on statusPageUrl -> ${patch.status} ${patch.message}`);
  const after = await call("GET", "/service-alerts/services", token);
  const row = ((after.data?.data ?? after.data) || []).find(s => s.id === real.id);
  check(row?.statusPageUrl === before.statusPageUrl && row?.rssUrl === before.rssUrl && row?.monitorUrl === before.monitorUrl,
    `refused update left the row untouched (statusPageUrl: ${row?.statusPageUrl ?? "null"})`);
  check(!((after.data?.data ?? after.data) || []).some(s => /probe-egress/.test(s.name)), "no probe services were created");
}

console.log("\naudit redaction");
{
  const marker = `probe-redact-${Date.now()}`;
  const made = await call("POST", "/inference/providers", token, { name: marker, provider: "custom", model: "m", apiEndpoint: "https://api.openai.com/v1/chat/completions", apiKey: "sk-should-never-be-stored", isActive: false });
  check(made.status === 201, `provider created for the audit check -> ${made.status}`);
  const logs = await call("GET", "/system/audit-logs?limit=50", token);
  const rows = ((logs.data?.data ?? logs.data) || []).filter(r => JSON.stringify(r).includes(marker));
  const row = rows[0];
  check(!!row, "audit row written for the create");
  check(row ? row.changes?.apiKey === "***" : false, `api key redacted in the audit row (stored: ${JSON.stringify(row?.changes?.apiKey)})`);
  check(row ? row.changes?.model === "m" : false, "non-secret fields still recorded");
  if (made.data?.id) await call("DELETE", `/inference/providers/${made.data.id}`, token);
}

console.log("\nalert monitor regression");
const refresh = await call("POST", "/service-alerts/refresh", token);
check(refresh.status === 200, `refresh ran -> ${refresh.status}`);
const status = await call("GET", "/service-alerts/monitor-status", token);
const errors = status.data?.snapshot?.errors || status.data?.errors || [];
const egressErrors = errors.filter(e => /not allowed|only https|Only http|private address|link-local|redirect/i.test(e));
check(egressErrors.length === 0, `no egress refusals for the configured services (${errors.length} source notes)`, JSON.stringify(egressErrors).slice(0, 300));
console.log(`  note  monitor sources: ${JSON.stringify(status.data?.snapshot?.sources || {}).slice(0, 200)}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
