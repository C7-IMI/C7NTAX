/**
 * The social source is absent unless it is configured — the rollback half of PLAN-015 Phase B #8.
 *
 * Run the API with NO X_BEARER_TOKEN (and without SERVICE_ALERTS_SOCIAL_ENABLED), then from
 * apps/api:  node probe-outage-board-social-off.mjs
 *
 * The point of this file: a deployment that has not configured X must not look like it is watching
 * a source it cannot read. There should be no "social" observation at all — not an "unknown" one —
 * so the service cards show only the sources that genuinely exist.
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

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  check(admin.status === 200, `administrator signed in (${admin.status})`);

  const run = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
  check(run.status === 200, `the monitor ran (${run.status})`);

  const services = await call("GET", "/api/service-alerts/services", { token: admin.token });
  const rows = services.data?.data || [];
  check(rows.length > 0, `there are services to inspect (${rows.length})`);
  const socialSources = rows.flatMap(s => (s.sourceStatus?.sources || []).filter(src => src.source === "social").map(src => `${s.name}: ${src.verdict}`));
  check(socialSources.length === 0, `no service reports a social source at all (${socialSources.length} found${socialSources.length ? `: ${socialSources.join("; ")}` : ""})`);

  const observedSources = [...new Set(rows.flatMap(s => (s.sourceStatus?.sources || []).map(src => src.source)))].sort();
  check(!observedSources.includes("social"), `and "social" is not among the sources in use (${observedSources.join(", ")})`);
  check(observedSources.length > 0, "while the real sources are still being read");

  const readFailures = rows.flatMap(s => (s.sourceStatus?.sources || []).filter(src => /X |X rejected|X returned|rate limit for this window/i.test(src.detail || "")).map(src => `${s.name}: ${src.detail}`));
  check(readFailures.length === 0, `nothing claims X failed, because nothing asked it (${readFailures.length} such lines)`);

  const personaIds = (await prisma.user.findMany({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
