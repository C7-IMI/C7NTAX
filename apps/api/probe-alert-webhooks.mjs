/**
 * Outbound alert webhook delivery — the half that actually sends.
 *
 * The registry and the delivery log existed for a while with nothing behind them: an endpoint could
 * be registered, and then no event ever reached it. This probe covers the delivery contract — one
 * signed POST per event, per-endpoint event filtering, the retry ceiling, the test button, parking
 * an endpoint, and the delivery rows the settings page reads.
 *
 * Run the API with:
 *   EGRESS_ALLOW_PRIVATE=true
 * then from apps/api:  node probe-alert-webhooks.mjs
 *
 * The private-address allowance is what lets the receiver below sit on 127.0.0.1; in a deployment
 * the same policy is what refuses it, which is asserted separately in probe-scoping.
 */
import { createServer } from "node:http";
import crypto from "node:crypto";

const BASE = "http://127.0.0.1:4000";
const PORT = Number(process.env.PROBE_WEBHOOK_PORT || 4125);
const PW = "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

/** The endpoint under test: records everything, and can be told to break. */
function startReceiver() {
  const received = [];
  let broken = false;
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      received.push({ url: req.url, headers: req.headers, body, at: Date.now() });
      if (broken || req.url.startsWith("/broken")) { res.writeHead(500, { "content-type": "text/plain" }); return res.end("nope"); }
      res.writeHead(204);
      res.end();
    });
  });
  return new Promise((resolve) => server.listen(PORT, "127.0.0.1", () => resolve({
    server,
    received,
    setBroken: (next) => { broken = next; },
    hits: (path) => received.filter((r) => r.url.startsWith(path)),
  })));
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Delivery is fire-and-forget, so the assertion waits for the effect rather than assuming it. */
async function waitFor(predicate, timeoutMs = 20000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return true;
    await sleep(250);
  }
  return false;
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const verify = (secret, body, header) =>
  header === `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;

async function main() {
  const receiver = await startReceiver();
  const stamp = Date.now().toString(36);
  const created = { webhooks: [], services: [] };

  try {
    const admin = await signIn("persona.admin@c7ntax.local");
    check(admin.status === 200, `administrator signed in (${admin.status})`);
    if (admin.status !== 200) return;
    const token = admin.token;

    console.log("\nthe event catalogue is the one the dispatcher delivers");
    const listed = await call("GET", "/api/alert-webhooks", { token });
    check(listed.status === 200, `the endpoints endpoint answers (${listed.status})`);
    const catalogue = (listed.data?.events || []).map((e) => e.event);
    check(catalogue.includes("service_alert.raised") && catalogue.includes("service_alert.resolved"),
      `it offers the two alert events (${catalogue.join(", ")})`);
    check(!catalogue.some((e) => /^alert\.(opened|resolved)$/.test(e)),
      "and no longer offers the event names nothing ever emitted");

    console.log("\na registration has to be worth making");
    const noEvents = await call("POST", "/api/alert-webhooks", { token, body: { url: `http://127.0.0.1:${PORT}/ok`, events: [] } });
    check(noEvents.status === 400, `an endpoint subscribed to nothing is refused (${noEvents.status})`);
    const badUrl = await call("POST", "/api/alert-webhooks", { token, body: { url: "ftp://example.com/hook", events: ["service_alert.raised"] } });
    check(badUrl.status === 400, `a non-http endpoint is refused (${badUrl.status})`);
    const badRetries = await call("POST", "/api/alert-webhooks", { token, body: { url: `http://127.0.0.1:${PORT}/ok`, events: ["service_alert.raised"], retryCount: 9 } });
    check(badRetries.status === 400, `a retry count past the ceiling is refused (${badRetries.status})`);

    const raised = await call("POST", "/api/alert-webhooks", {
      token,
      body: { name: `Probe hook ${stamp}`, url: `http://127.0.0.1:${PORT}/ok`, events: ["service_alert.raised"] },
    });
    check(raised.status === 201, `an endpoint registers (${raised.status})`);
    const hook = raised.data;
    created.webhooks.push(hook.id);
    check(typeof hook.secret === "string" && hook.secret.length > 20, "and hands back its signing secret once");

    // A service with monitoring switched off: the manual alert below is the only event it can
    // produce, so this probe never waits on the internet.
    const service = await call("POST", "/api/service-alerts/services", {
      token,
      body: { name: `ProbeWebhook ${stamp}`, category: "other", description: "probe", monitorEnabled: false, enabled: true },
    });
    check(service.status === 201, `a probe service was created (${service.status})`);
    created.services.push(service.data.id);

    console.log("\nan alert that opens is delivered, signed, and logged");
    const alert = await call("POST", "/api/service-alerts", {
      token,
      body: { serviceId: service.data.id, title: `ProbeWebhook ${stamp} is down`, severity: "outage" },
    });
    check(alert.status === 201, `a manual alert was raised (${alert.status})`);

    const arrived = await waitFor(() => receiver.hits("/ok").length > 0);
    check(arrived, "the endpoint was called");
    const delivery = receiver.hits("/ok")[0];
    check(delivery?.headers["x-c7-event"] === "service_alert.raised",
      `with the event in the header (${delivery?.headers["x-c7-event"]})`);
    check(verify(hook.secret, delivery?.body || "", delivery?.headers["x-c7-signature"] || ""),
      "and an HMAC over the exact body that verifies with the signing secret");
    check(!!delivery?.headers["x-c7-delivery"], `carrying the delivery id (${delivery?.headers["x-c7-delivery"]})`);

    let payload = {};
    try { payload = JSON.parse(delivery?.body || "{}"); } catch { /* asserted below */ }
    check(payload.event === "service_alert.raised", `the body names the event (${payload.event})`);
    check(payload.data?.service?.name === `ProbeWebhook ${stamp}`, `and the service it concerns (${payload.data?.service?.name})`);
    check(payload.data?.alert?.status === "active" && payload.data?.alert?.severity === "outage",
      `with the alert's own state (${payload.data?.alert?.status}/${payload.data?.alert?.severity})`);
    check(typeof payload.sentAt === "string", "and when it was sent");

    const logged = await waitFor(async () => {
      const rows = await call("GET", "/api/alert-webhooks/deliveries", { token });
      return (rows.data?.data || []).some((d) => d.webhookId === hook.id && d.event === "service_alert.raised" && d.status === "delivered");
    });
    check(logged, "and the delivery is in the log as delivered");

    console.log("\nan endpoint only hears the events it asked for");
    const resolvedOnly = await call("POST", "/api/alert-webhooks", {
      token,
      body: { name: `Probe hook resolved ${stamp}`, url: `http://127.0.0.1:${PORT}/quiet`, events: ["service_alert.resolved"] },
    });
    created.webhooks.push(resolvedOnly.data.id);
    const second = await call("POST", "/api/service-alerts", {
      token,
      body: { serviceId: service.data.id, title: `ProbeWebhook ${stamp} degraded`, severity: "degraded" },
    });
    check(second.status === 201, `a second alert was raised (${second.status})`);
    await waitFor(() => receiver.hits("/ok").length > 1);
    check(receiver.hits("/quiet").length === 0, "the endpoint subscribed to the other event was not called");

    console.log("\nthe matching event, when it happens, reaches both");
    const resolved = await call("POST", `/api/service-alerts/${second.data.id}/resolve`, { token });
    check(resolved.status === 200, `the alert was resolved (${resolved.status})`);
    const resolvedArrived = await waitFor(() => receiver.hits("/quiet").length > 0);
    check(resolvedArrived, "the resolved event reached the endpoint that wanted it");
    const resolvedDelivery = receiver.hits("/quiet")[0];
    let resolvedBody = {};
    try { resolvedBody = JSON.parse(resolvedDelivery?.body || "{}"); } catch { /* asserted below */ }
    check(resolvedBody.event === "service_alert.resolved", `as the resolved event (${resolvedBody.event})`);
    check(resolvedBody.data?.alert?.status === "resolved" && !!resolvedBody.data?.alert?.resolvedAt,
      `carrying the resolved state (${resolvedBody.data?.alert?.status}/${resolvedBody.data?.alert?.resolvedAt})`);

    console.log("\na failing endpoint is retried, then logged as failed");
    const broken = await call("POST", "/api/alert-webhooks", {
      token,
      body: { name: `Probe hook broken ${stamp}`, url: `http://127.0.0.1:${PORT}/broken`, events: ["service_alert.raised"], retryCount: 2 },
    });
    created.webhooks.push(broken.data.id);
    const third = await call("POST", "/api/service-alerts", {
      token,
      body: { serviceId: service.data.id, title: `ProbeWebhook ${stamp} again`, severity: "degraded" },
    });
    check(third.status === 201, `a third alert was raised (${third.status})`);
    const failed = await waitFor(async () => {
      const rows = await call("GET", "/api/alert-webhooks/deliveries", { token });
      return (rows.data?.data || []).some((d) => d.webhookId === broken.data.id && d.status === "failed");
    }, 30000);
    check(failed, "the delivery was tried and recorded as failed");
    check(receiver.hits("/broken").length === 2, `exactly the retries it was configured for (${receiver.hits("/broken").length} attempts)`);
    const failedRow = (await call("GET", "/api/alert-webhooks/deliveries", { token })).data?.data
      ?.find((d) => d.webhookId === broken.data.id && d.status === "failed");
    check(failedRow?.attempts === 2, `and the row counts them (${failedRow?.attempts})`);

    console.log("\nthe test button proves an endpoint without an incident");
    receiver.setBroken(false);
    const tested = await call("POST", `/api/alert-webhooks/${hook.id}/test`, { token });
    check(tested.status === 200 && tested.data?.status === "delivered", `a test delivery succeeds (${tested.data?.status})`);
    check(tested.data?.attempts === 1, `with a single attempt, so the button answers (${tested.data?.attempts})`);
    const testBody = JSON.parse(receiver.hits("/ok").slice(-1)[0]?.body || "{}");
    check(testBody.event === "webhook.test" && testBody.data?.test === true,
      `and is unmistakably a test (${testBody.event})`);

    console.log("\nthe test reports the endpoint's own answer when it is wrong");
    receiver.setBroken(true);
    const testedBroken = await call("POST", `/api/alert-webhooks/${hook.id}/test`, { token });
    check(testedBroken.data?.status === "failed" && /500/.test(testedBroken.data?.detail || ""),
      `a broken endpoint is reported with its status (${testedBroken.data?.detail})`);
    receiver.setBroken(false);

    console.log("\na parked endpoint keeps its history and receives nothing");
    const parked = await call("PATCH", `/api/alert-webhooks/${hook.id}`, { token, body: { isActive: false } });
    check(parked.status === 200 && parked.data?.isActive === false, `the endpoint was parked (${parked.data?.isActive})`);
    check(!("secret" in (parked.data || {})), "and editing it does not hand the secret back");
    const before = receiver.hits("/ok").length;
    await call("POST", "/api/service-alerts", {
      token,
      body: { serviceId: service.data.id, title: `ProbeWebhook ${stamp} while parked`, severity: "informational" },
    });
    await sleep(2500);
    check(receiver.hits("/ok").length === before, "nothing was delivered while it was parked");
    const resumed = await call("PATCH", `/api/alert-webhooks/${hook.id}`, { token, body: { isActive: true } });
    check(resumed.data?.isActive === true, "and it resumes");

    console.log("\nediting an endpoint changes what it receives");
    const retargeted = await call("PATCH", `/api/alert-webhooks/${hook.id}`, {
      token,
      body: { name: `Probe hook renamed ${stamp}`, url: `http://127.0.0.1:${PORT}/moved`, events: ["service_alert.resolved"] },
    });
    check(retargeted.status === 200 && retargeted.data?.name === `Probe hook renamed ${stamp}`, `the name changed (${retargeted.data?.name})`);
    check(Array.isArray(retargeted.data?.events) && retargeted.data.events.length === 1 && retargeted.data.events[0] === "service_alert.resolved",
      `and the subscription with it (${(retargeted.data?.events || []).join(", ")})`);
    const movedAlert = await call("POST", "/api/service-alerts", {
      token,
      body: { serviceId: service.data.id, title: `ProbeWebhook ${stamp} moved`, severity: "degraded" },
    });
    await call("POST", `/api/service-alerts/${movedAlert.data.id}/resolve`, { token });
    const movedArrived = await waitFor(() => receiver.hits("/moved").length > 0);
    check(movedArrived, "a delivery now goes to the new address");
    check(verify(hook.secret, receiver.hits("/moved")[0]?.body || "", receiver.hits("/moved")[0]?.headers["x-c7-signature"] || ""),
      "still signed with the secret that was handed out once");

    console.log("\nremoving an endpoint takes its delivery history with it");
    const removed = await call("DELETE", `/api/alert-webhooks/${hook.id}`, { token });
    check(removed.status === 200, `the endpoint was removed (${removed.status})`);
    created.webhooks = created.webhooks.filter((id) => id !== hook.id);
    const rowsAfter = await call("GET", "/api/alert-webhooks/deliveries", { token });
    check(!(rowsAfter.data?.data || []).some((d) => d.webhookId === hook.id), "and its deliveries are gone from the log");
  } finally {
    for (const id of created.webhooks) await call("DELETE", `/api/alert-webhooks/${id}`, { token: (await signIn("persona.admin@c7ntax.local")).token });
    await prisma.serviceAlert.deleteMany({ where: { serviceId: { in: created.services } } });
    await prisma.serviceAlertService.deleteMany({ where: { id: { in: created.services } } });
    const personaIds = (await prisma.user.findMany({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } })).map((u) => u.id);
    await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
    const leftovers = await prisma.webhookConfig.count({ where: { name: { startsWith: "Probe hook" } } });
    check(leftovers === 0, `the probe cleaned up after itself (${leftovers} endpoints left)`);
    receiver.server.close();
    await prisma.$disconnect();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
