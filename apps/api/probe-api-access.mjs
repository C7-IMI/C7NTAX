/**
 * End-to-end check of the surface the new Administration → API access page writes and issues:
 * a key issued the way the page issues one, the event gateway, and the intake board the page saves.
 *
 * Run from apps/api:  node probe-api-access.mjs
 */
import { createRequire } from "node:module";
const require = createRequire("file:///C:/OneDrive/OneDrive%20-%20Cyber%207%20Group/GHRepo/Kun/C7NTAX/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");

const BASE = "http://127.0.0.1:4000";
const ADMIN = { email: "persona.admin@c7ntax.local", password: "Persona-Dev-Only-2026!" };
const INTAKE_BOARD = "81f12ded-6039-4c63-81b5-3d520ea1e854"; // "Infrastructure Desk", saved from the page

const prisma = new PrismaClient();
let pass = 0, fail = 0;
const check = (ok, label, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ""}`); }
};

const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
};

const stamp = Date.now();
const created = { ticketIds: [], keyIds: [], eventIds: [] };

async function main() {
  const signIn = await call("POST", "/api/auth/login", { body: ADMIN });
  const token = signIn.data.token;
  check(Boolean(token), "an administrator can sign in");

  // ── What the page writes: the intake board ────────────────────────────────
  const config = await call("GET", "/api/system/config/eventIntakeBoardId", { token });
  check(config.data.value === INTAKE_BOARD, "the intake board the page saved is stored", JSON.stringify(config.data.value));

  // ── A key issued the way the page issues one ──────────────────────────────
  const catalogue = await call("GET", "/api/api-keys/permissions", { token });
  check(catalogue.data.permissions.includes("ticket:create"), "the permission catalogue lists ticket:create");
  check(catalogue.data.sources.includes("rmm") && catalogue.data.sources.includes("siem"), "the catalogue lists the source kinds the page offers");

  const issued = await call("POST", "/api/api-keys", {
    token,
    body: {
      name: `PROBE api access ${stamp}`,
      sourceKind: "rmm",
      description: "end-to-end probe",
      permissions: ["ticket:create", "ticket:view"],
    },
  });
  const key = issued.data.key;
  check(issued.status === 201 && typeof key === "string" && key.startsWith("c7k_"), "the page's create call issues a c7k_ key");
  check(String(issued.data.warning || "").length > 0, "the issuance response warns that the secret is shown once");
  if (issued.data.id) created.keyIds.push(issued.data.id);

  const listing = await call("GET", "/api/api-keys", { token });
  const summary = (listing.data.data ?? []).find(k => k.id === issued.data.id);
  check(summary && summary.prefix === key.slice(0, key.indexOf(".")), "the list shows the prefix the page renders, and never the secret");
  check(!JSON.stringify(listing.data).includes(key.split(".")[1]), "the list never returns the secret");

  // ── Scope boundary: the key does what its scopes allow, and nothing more ──
  const readTickets = await call("GET", "/api/tickets?limit=1", { token: key });
  check(readTickets.status === 200, "the key can read tickets (ticket:view)");
  const readUsers = await call("GET", "/api/users?limit=1", { token: key });
  check(readUsers.status === 403, "the key cannot read users (no user:manage)", `got ${readUsers.status}`);

  const clients = await call("GET", "/api/clients?limit=1", { token });
  const companyId = (clients.data.data ?? clients.data)?.[0]?.id;
  check(Boolean(companyId), "there is a client to file an event against");

  // ── The event gateway, with the key the page issued ───────────────────────
  const externalId = `probe-apiaccess-${stamp}`;
  const first = await call("POST", "/api/events", {
    token: key,
    body: {
      source: "c7probe",
      externalId,
      severity: "high",
      title: "PROBE api access — disk space low",
      client: { companyId },
      data: { device: "PROBE-01", check: "disk.c", freeGb: 1.2 },
    },
  });
  check(first.status === 201 && first.data.created === true, "the first event opens a ticket", `${first.status} ${JSON.stringify(first.data)}`);
  if (first.data.ticketId) created.ticketIds.push(first.data.ticketId);

  const ticket = await call("GET", `/api/tickets/${first.data.ticketId}`, { token: key });
  check(ticket.data.boardId === INTAKE_BOARD, "the ticket lands on the intake board the page saved", ticket.data.boardId);
  check(ticket.data.priority === "high", "severity high became priority high", ticket.data.priority);
  check(ticket.data.source === "api", "a source of the sender's own naming is filed as an api ticket", ticket.data.source);

  const rmm = await call("POST", "/api/events", {
    token: key,
    body: {
      source: "rmm",
      externalId: `${externalId}-rmm`,
      severity: "low",
      title: "PROBE api access — rmm source",
      client: { companyId },
    },
  });
  if (rmm.data.ticketId) created.ticketIds.push(rmm.data.ticketId);
  const rmmTicket = await call("GET", `/api/tickets/${rmm.data.ticketId}`, { token: key });
  check(rmmTicket.data.source === "monitoring", "a source of rmm is filed as a monitoring ticket", rmmTicket.data.source);

  const again = await call("POST", "/api/events", {
    token: key,
    body: { source: "c7probe", externalId, severity: "high", title: "PROBE api access — still low" },
  });
  check(again.status === 200 && again.data.merged === true && again.data.occurrences === 2,
    "a repeat joins the ticket instead of opening another", `${again.status} ${JSON.stringify(again.data)}`);
  check(again.data.ticketId === first.data.ticketId, "the repeat is the same ticket");

  const thread = await call("GET", `/api/tickets/${first.data.ticketId}`, { token: key });
  const bodies = JSON.stringify(thread.data.comments ?? []);
  check(bodies.includes("occurrence 2"), "the repeat is visible in the thread with its occurrence count", bodies.slice(0, 120));
  check(bodies.includes("freeGb"), "the payload nobody mapped is kept on the ticket as it arrived");

  const recovery = await call("POST", "/api/events", {
    token: key,
    body: { source: "c7probe", externalId, kind: "recovery", title: "PROBE api access — recovered" },
  });
  check(recovery.status === 200 && recovery.data.recovered === true, "the recovery resolves the ticket");
  const resolved = await call("GET", `/api/tickets/${first.data.ticketId}`, { token: key });
  check(resolved.data.status === "resolved", "the ticket is resolved", resolved.data.status);

  const orphan = await call("POST", "/api/events", {
    token: key,
    body: { source: "c7probe", externalId: `${externalId}-noclient`, severity: "low", title: "PROBE api access — no client" },
  });
  check(orphan.status === 400, "an event that names no client is refused rather than guessed at", `got ${orphan.status}`);

  const sources = await call("GET", "/api/events/sources", { token });
  const row = (sources.data.data ?? []).find(s => s.source === "c7probe");
  const event = await prisma.eventRecord.findUnique({ where: { source_externalId: { source: "c7probe", externalId } } });
  check(Boolean(row) && row.total === 1 && row.recovered === 1,
    "the sources report counts one event row for the condition, now recovered", JSON.stringify(row));
  check(event?.occurrences === 3, "the event row counted every repeat", String(event?.occurrences));

  // ── What the page shows after use, and what revoking does ─────────────────
  const afterUse = (await call("GET", "/api/api-keys", { token })).data.data.find(k => k.id === issued.data.id);
  check(afterUse.requestCount >= 5 && Boolean(afterUse.lastUsedAt), "usage is counted against the key the table displays");

  const rotated = await call("POST", `/api/api-keys/${issued.data.id}/rotate`, { token });
  check(rotated.data.key !== key, "rotating issues a different secret");
  check((await call("GET", "/api/tickets?limit=1", { token: key })).status === 401, "the old secret stops working after a rotation");
  check((await call("GET", "/api/tickets?limit=1", { token: rotated.data.key })).status === 200, "the new secret works");

  const revoked = await call("DELETE", `/api/api-keys/${issued.data.id}`, { token, body: { reason: "probe cleanup" } });
  check(revoked.status === 200 && revoked.data.state === "revoked", "revoking marks the key revoked");
  check((await call("GET", "/api/tickets?limit=1", { token: rotated.data.key })).status === 401, "a revoked key stops working");
  check(String(revoked.data.description || "").includes("probe cleanup"), "the revocation reason is kept on the record");

  const hidden = await call("GET", "/api/api-keys", { token });
  check(!(hidden.data.data ?? []).some(k => k.id === issued.data.id), "a revoked key is hidden from the default list, as the page's checkbox implies");

  const audit = await call("GET", "/api/system/audit-logs?limit=50", { token });
  const actions = JSON.stringify(audit.data);
  check(actions.includes("api_key.created") && actions.includes("api_key.rotated") && actions.includes("api_key.revoked"),
    "issuance, rotation and revocation are all in the audit trail");
}

async function cleanup() {
  await prisma.eventRecord.deleteMany({ where: { source: { in: ["c7probe", "rmm"] }, externalId: { startsWith: "probe-apiaccess" } } });
  for (const id of created.ticketIds) {
    await prisma.ticketComment.deleteMany({ where: { ticketId: id } });
    await prisma.ticket.delete({ where: { id } }).catch(() => {});
  }
  if (created.keyIds.length) await prisma.apiKey.deleteMany({ where: { id: { in: created.keyIds } } });
  console.log(`cleaned up: ${created.ticketIds.length} ticket(s), ${created.keyIds.length} key(s)`);
}

try {
  await main();
} catch (e) {
  fail++;
  console.log(`  FAIL  threw: ${e.message}`);
} finally {
  try { await cleanup(); } catch (e) { console.log(`  cleanup problem: ${e.message}`); }
  console.log(`\n${pass} passed, ${fail} failed`);
  await prisma.$disconnect();
  process.exit(fail ? 1 : 0);
}
