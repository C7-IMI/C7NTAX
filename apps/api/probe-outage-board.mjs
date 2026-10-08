/**
 * Social (X) reports as a Service Alerts source — PLAN-015 Phase B #8.
 *
 * The plan asks for "an aggregated outage board ... plus a Twitter/X source behind env config".
 * The board is the UI half (browser-verified); this probe covers the half that can get an MSP into
 * trouble: a social source must be **configured or absent**, must never be able to raise an outage
 * on its own, and must not silently resolve a real incident when its credentials stop working.
 *
 * Run the API with:
 *   EGRESS_ALLOW_PRIVATE=true X_BEARER_TOKEN=probe-token X_API_BASE_URL=http://127.0.0.1:<STUB_PORT>
 * then from apps/api:  node probe-outage-board.mjs
 */
import { createServer } from "node:http";

const BASE = "http://127.0.0.1:4000";
const STUB_PORT = Number(process.env.PROBE_STUB_PORT || 4123);
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

/** The X recent-search endpoint, answering whatever the current phase says it should. */
function startStub() {
  const received = [];
  let mode = { kind: "complaint" };
  const server = createServer((req, res) => {
    received.push({ url: req.url, auth: req.headers.authorization });
    const reply = () => {
      if (mode.kind === "unauthorised") { res.writeHead(401, { "content-type": "application/json" }); return res.end(JSON.stringify({ title: "Unauthorized" })); }
      if (mode.kind === "rate_limited") { res.writeHead(429, { "content-type": "application/json" }); return res.end(JSON.stringify({ title: "Too Many Requests" })); }
      if (mode.kind === "server_error") { res.writeHead(503); return res.end("nope"); }
      const data = mode.kind === "complaint"
        ? [{ id: "1900000000000000001", text: `${mode.serviceName} is down again, nothing loads`, created_at: new Date().toISOString() }]
        : mode.kind === "restored"
          ? [{ id: "1900000000000000002", text: `${mode.serviceName} outage resolved, back to normal`, created_at: new Date().toISOString() }]
          // A complaint about something else entirely: the recent-search endpoint is free to answer
          // with posts that only share the words of the query, and a base URL pointed somewhere it
          // should not be answers with anything at all.
          : mode.kind === "foreign"
            ? [{ id: "1900000000000000003", text: "SomeOtherProduct is down again, nothing loads", created_at: new Date().toISOString() }]
            : [];
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify({ data, meta: { result_count: data.length } }));
    };
    reply();
  });
  return new Promise(resolve => server.listen(STUB_PORT, "127.0.0.1", () => resolve({
    server,
    received,
    setMode: next => { mode = next; },
  })));
}

async function main() {
  const stub = await startStub();
  const stamp = Date.now().toString(36);
  const serviceName = `ProbeSocial ${stamp}`;
  let serviceId = null;

  try {
    const admin = await signIn("persona.admin@c7ntax.local");
    check(admin.status === 200, `administrator signed in (${admin.status})`);
    if (admin.status !== 200) return;

    // A probe service with no other source at all: whatever is observed about it came from X, which
    // is what makes the severity assertions below mean something.
    const created = await call("POST", "/api/service-alerts/services", {
      token: admin.token,
      body: { name: serviceName, category: "other", description: "probe", monitorEnabled: true, enabled: true },
    });
    check(created.status === 201, `a probe service with only a social source was created (${created.status})`);
    serviceId = created.data?.id;
    await prisma.serviceAlert.deleteMany({ where: { serviceId } });

    console.log("\na post that does not name the service is not evidence about it");
    stub.setMode({ kind: "foreign" });
    const foreign = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const foreignSource = ((foreign.data?.sourceStatus?.[serviceId]?.sources) || []).find(s => s.source === "social");
    check(foreignSource?.verdict === "clear", `a complaint about another product reads as clear for this service (${foreignSource?.verdict})`);
    check(/0 naming/.test(foreignSource?.detail || ""), `and the detail reports that no post named it (${foreignSource?.detail})`);
    const raisedFromForeign = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!raisedFromForeign, "and no notice was raised from it");

    console.log("\na configured social source is read, and a complaint is only ever a notice");
    stub.setMode({ kind: "complaint", serviceName });
    const first = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    check(first.status === 200, `the monitor ran (${first.status})`);
    const status = first.data?.sourceStatus?.[serviceId];
    check(!!status, "the probe service reported its sources");
    const socialSource = (status?.sources || []).find(s => s.source === "social");
    check(!!socialSource, `the social source was read (${(status?.sources || []).map(s => s.source).join(", ")})`);
    check(socialSource?.verdict === "problem", `the complaint was seen as a problem (${socialSource?.verdict})`);
    check(socialSource?.detail && /recent post/.test(socialSource.detail), `with an honest detail line (${socialSource?.detail})`);
    check(stub.received.some(r => /\/2\/tweets\/search\/recent/.test(r.url)), "the recent-search endpoint was called");
    check(stub.received.every(r => r.auth === "Bearer probe-token"), `with the configured bearer token (${stub.received[0]?.auth})`);
    check(stub.received.some(r => /is%3Aretweet/.test(r.url) && /lang%3Aen/.test(r.url)), "and a query that excludes retweets");
    check(/%22ProbeSocial/.test(stub.received[0]?.url || "") || /%22ProbeSocial/.test(decodeURIComponent(stub.received[0]?.url || "")), "naming the service");

    const alert = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!alert, "an alert was raised from the social report");
    check(alert?.severity === "informational", `and it is a notice, never an outage (${alert?.severity})`);
    check(alert?.source === "social", `attributed to the social source (${alert?.source})`);
    check(!!alert?.sourceUrl && /x\.com/.test(alert.sourceUrl), `with a link back to the post (${alert?.sourceUrl})`);
    check(/Social reports/.test(alert?.title || ""), `and a title that says where it came from (${alert?.title})`);

    console.log("\nan all-clear needs two polls in a row, and never on the poll that raised it");
    stub.setMode({ kind: "clear", serviceName });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const afterOne = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!afterOne, "one clear poll does not retire it (anti-flap)");
    // Pin the alert's age before the second poll. The rule under test is about age, and a poll sweeps
    // every configured service — so on a slow network the first assertion's own sweep can age the
    // alert past the floor and the second poll would legitimately retire it. Re-pinning keeps the
    // assertion about the rule rather than about how long the internet took.
    await prisma.serviceAlert.updateMany({ where: { serviceId, status: "active" }, data: { detectedAt: new Date() } });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    // The second clear poll is still inside the minimum age, so the alert is held: that floor is what
    // stops an incident being raised and retired by the same pair of polls.
    const young = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!young, "nor does the second, while the alert is younger than the poll interval");
    await prisma.serviceAlert.updateMany({ where: { serviceId, status: "active" }, data: { detectedAt: new Date(Date.now() - 10 * 60 * 1000) } });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const afterAge = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!afterAge, "once it is old enough, two consecutive clears retire it");

    console.log("\na resolution posted publicly can retire it");
    stub.setMode({ kind: "complaint", serviceName });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const raised = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!raised, "the complaint raised a fresh notice");
    // The anti-flap rule never resolves on the poll that created the alert, so give it one poll to age.
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    stub.setMode({ kind: "restored", serviceName });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const afterRestored = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!afterRestored, "a post saying it is resolved retired the notice");

    console.log("\ncredentials that stop working are unknown, and unknown never means all-clear");
    stub.setMode({ kind: "complaint", serviceName });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const live = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!live, "a notice is active before the credentials break");
    stub.setMode({ kind: "unauthorised", serviceName });
    const unauthorised = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const unauthorisedSource = ((unauthorised.data?.sourceStatus?.[serviceId]?.sources) || []).find(s => s.source === "social");
    check(unauthorisedSource?.verdict === "unknown", `a rejected token reads as unknown (${unauthorisedSource?.verdict})`);
    check(/credential/i.test(unauthorisedSource?.detail || ""), `and says why (${unauthorisedSource?.detail})`);
    const stillActive = await prisma.serviceAlert.findFirst({ where: { serviceId, status: "active" } });
    check(!!stillActive, "the alert is kept — an unreadable source cannot resolve an incident");

    stub.setMode({ kind: "rate_limited", serviceName });
    const limited = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const limitedSource = ((limited.data?.sourceStatus?.[serviceId]?.sources) || []).find(s => s.source === "social");
    check(limitedSource?.verdict === "unknown" && /rate limit/i.test(limitedSource?.detail || ""), `a rate limit is reported as such (${limitedSource?.detail})`);

    stub.setMode({ kind: "server_error", serviceName });
    const broken = await call("POST", "/api/service-alerts/refresh", { token: admin.token });
    const brokenSource = ((broken.data?.sourceStatus?.[serviceId]?.sources) || []).find(s => s.source === "social");
    check(brokenSource?.verdict === "unknown" && /HTTP 503/.test(brokenSource?.detail || ""), `an HTTP error is reported, not swallowed (${brokenSource?.detail})`);
    check((broken.data?.errors || []).some(e => /ProbeSocial/.test(e) && /503/.test(e)), "and lands in the run's error list");

    console.log("\nthe board's data is on the endpoints the page already uses");
    const services = await call("GET", "/api/service-alerts/services", { token: admin.token });
    const probe = (services.data?.data || []).find(s => s.id === serviceId) || {};
    check(services.status === 200, `the services endpoint answers (${services.status})`);
    check(!!probe.sourceStatus?.sources?.some(s => s.source === "social"), "the probe service carries its social verdict for the board to render");
    check(typeof probe.sourceStatus?.checkedAt === "string", "and when it was checked");
    const resolvedList = await call("GET", "/api/service-alerts", { token: admin.token });
    check(resolvedList.status === 200 && Array.isArray(resolvedList.data?.resolved), `resolved history is available for the board's last-incident column (${resolvedList.status})`);

  } finally {
    // Cleanup runs even when an assertion throws halfway. A probe that dies part-way leaves a
    // service on the board, and a board carrying ProbeSocial services is the worse failure.
    if (serviceId) {
      await prisma.serviceAlert.deleteMany({ where: { serviceId } });
      await prisma.serviceAlertService.deleteMany({ where: { id: serviceId } });
    }
    const personaIds = (await prisma.user.findMany({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } })).map(u => u.id);
    await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
    const leftovers = await prisma.serviceAlertService.count({ where: { name: { startsWith: "ProbeSocial" } } });
    check(leftovers === 0, `the probe cleaned up after itself (${leftovers} services left)`);
    stub.server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();