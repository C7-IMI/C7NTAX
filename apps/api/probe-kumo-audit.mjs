/**
 * Kumo audit trail (PLAN-015 Phase B #6).
 *
 * Kumo holds shared credentials and documents. Before this, "Last changed by" was the whole
 * story: it answered who touched a row last and nothing else — not who revealed the credential,
 * not what the previous editor changed, not that anyone had. These assertions cover the trail
 * being written on create, update, delete and reveal, the field names being recorded without
 * the secret, the read route, its permission gate, and its refusal of unknown items.
 *
 * Run from apps/api:  node probe-kumo-audit.mjs
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

const PERSONAS = ["persona.admin@c7ntax.local", "persona.superadmin@c7ntax.local", "persona.tech@c7ntax.local"];

async function main() {
  const admin = await signIn(PERSONAS[0]);
  const superadmin = await signIn(PERSONAS[1]);
  // The technician persona holds no Kumo permissions at all — the vault is internal-staff only.
  const tech = await signIn(PERSONAS[2]);
  check(admin.status === 200 && superadmin.status === 200 && tech.status === 200,
    `admin (${admin.status}), superadmin (${superadmin.status}) and technician (${tech.status}) signed in`);

  const createdIds = [];
  const stamp = Date.now().toString(36);

  console.log("\na password records who created it");
  const made = await call("POST", "/api/kumo/passwords", {
    token: admin.token,
    body: { label: `Probe vault ${stamp}`, username: "probe", password: "Probe-P@ssw0rd-2026", category: "probe" },
  });
  check(made.status === 201, `the credential was created (${made.status})`);
  const passwordId = made.data?.id;
  if (passwordId) createdIds.push(passwordId);
  const afterCreate = await call("GET", `/api/kumo/audit/password/${passwordId}`, { token: admin.token });
  check(afterCreate.status === 200, `the trail answers (${afterCreate.status})`);
  const createEntry = (afterCreate.data?.data || [])[0] || {};
  check(createEntry.action === "created", `the entry is a create (${createEntry.action})`);
  check(!!createEntry.user?.name, `the acting user is resolved for the panel (${createEntry.user?.name})`);
  check(!!createEntry.summary && createEntry.summary.includes(`Probe vault ${stamp}`), `the summary is human (${createEntry.summary})`);

  console.log("\nan edit names the fields, never the secret");
  const edited = await call("PATCH", `/api/kumo/passwords/${passwordId}`, {
    token: admin.token,
    body: { label: `Probe vault ${stamp} edited`, password: "Different-P@ssw0rd-2026" },
  });
  check(edited.status === 200, `the edit was accepted (${edited.status})`);
  const afterEdit = await call("GET", `/api/kumo/audit/password/${passwordId}`, { token: admin.token });
  const editEntry = (afterEdit.data?.data || [])[0] || {};
  check(editEntry.action === "updated", `the newest entry is the update (${editEntry.action})`);
  check(JSON.stringify(editEntry.details?.fields || []).includes("label"), `the changed fields are listed (${JSON.stringify(editEntry.details?.fields)})`);
  check(JSON.stringify(editEntry.details?.fields || []).includes("password"), "the password field is listed by name");
  check(!(editEntry.details?.fields || []).some(f => /updatedBy|updatedAt/.test(f)), "and the bookkeeping columns are not dressed up as edits");
  check(!JSON.stringify(editEntry).includes("Different-P@ssw0rd-2026") && !JSON.stringify(editEntry).includes("Probe-P@ssw0rd-2026"),
    "no plaintext secret reaches the trail");

  console.log("\na reveal is recorded, and reveals nothing");
  const reveal = await call("POST", `/api/kumo/passwords/${passwordId}/reveal`, { token: admin.token });
  check(reveal.status === 200, `the credential revealed (${reveal.status})`);
  const afterReveal = await call("GET", `/api/kumo/audit/password/${passwordId}`, { token: admin.token });
  const revealEntry = (afterReveal.data?.data || [])[0] || {};
  check(revealEntry.action === "revealed", `the newest entry is the reveal (${revealEntry.action})`);
  check(!JSON.stringify(afterReveal.data).includes(String(reveal.data?.passwordPlaintext ?? "\u0000")), "the trail never carries the revealed password");

  console.log("\nthe trail is newest first and bounded");
  const limited = await call("GET", `/api/kumo/audit/password/${passwordId}?limit=2`, { token: admin.token });
  check((limited.data?.data || []).length === 2, `the limit is honoured (${(limited.data?.data || []).length})`);
  const times = (afterReveal.data?.data || []).map(e => new Date(e.at).getTime());
  check(times.every((t, i) => i === 0 || times[i - 1] >= t), "entries are ordered newest first");
  const huge = await call("GET", `/api/kumo/audit/password/${passwordId}?limit=100000`, { token: admin.token });
  check(huge.status === 200 && (huge.data?.data || []).length <= 200, `an absurd limit is clamped rather than run (${(huge.data?.data || []).length})`);

  console.log("\ndocuments record their own history");
  const doc = await call("POST", "/api/kumo/documents", {
    token: admin.token,
    body: { title: `Probe doc ${stamp}`, content: "first revision" },
  });
  check(doc.status === 201, `the document was created (${doc.status})`);
  const docId = doc.data?.id;
  await call("PATCH", `/api/kumo/documents/${docId}`, {
    token: admin.token,
    body: { content: "second revision", changeLog: "added the runbook step" },
  });
  const docTrail = await call("GET", `/api/kumo/audit/document/${docId}`, { token: admin.token });
  const docEntries = docTrail.data?.data || [];
  check(docEntries.length === 2, `both document events are recorded (${docEntries.length})`);
  check(docEntries.some(e => e.action === "created") && docEntries.some(e => e.action === "updated"), "as a create and an update");
  const docUpdate = docEntries.find(e => e.action === "updated") || {};
  check(!!docUpdate.summary && docUpdate.summary.includes("v2"), `the update names the version (${docUpdate.summary})`);
  check(JSON.stringify(docUpdate.details || {}).includes("added the runbook step"), "the change log is carried into the trail");

  console.log("\ndeactivation is recorded too");
  await call("DELETE", `/api/kumo/passwords/${passwordId}`, { token: admin.token });
  const afterDelete = await call("GET", `/api/kumo/audit/password/${passwordId}`, { token: admin.token });
  check(((afterDelete.data?.data || [])[0] || {}).action === "deleted", "the newest entry is the deactivation");

  console.log("\nthe route is gated and refuses the unknown");
  const anon = await call("GET", `/api/kumo/audit/password/${passwordId}`);
  check(anon.status === 401, `an unauthenticated read is refused (${anon.status})`);
  const techRead = await call("GET", `/api/kumo/audit/password/${passwordId}`, { token: tech.token });
  check(techRead.status === 403, `an account without Kumo permissions cannot read the trail (${techRead.status})`);
  const techReveal = await call("POST", `/api/kumo/passwords/${passwordId}/reveal`, { token: tech.token });
  check(techReveal.status === 403, `nor reveal the credential it belongs to (${techReveal.status})`);
  const unknown = await call("GET", "/api/kumo/audit/password/00000000-0000-0000-0000-000000000000", { token: admin.token });
  check(unknown.status === 404, `an unknown item reads as 404, not an empty trail (${unknown.status})`);
  const badType = await call("GET", `/api/kumo/audit/unicorn/${passwordId}`, { token: admin.token });
  check(badType.status === 404, `an unknown item type is refused (${badType.status})`);

  console.log("\nthe trail names the person who acted, not just \"an admin\"");
  const otherMade = await call("POST", "/api/kumo/passwords", {
    token: admin.token,
    body: { label: `Probe vault shared ${stamp}`, username: "probe2", password: "Probe-P@ssw0rd-2026", category: "probe" },
  });
  const sharedId = otherMade.data?.id;
  if (sharedId) createdIds.push(sharedId);
  const sharedReveal = await call("POST", `/api/kumo/passwords/${sharedId}/reveal`, { token: superadmin.token });
  check(sharedReveal.status === 200, `a second administrator revealed it (${sharedReveal.status})`);
  const sharedTrail = await call("GET", `/api/kumo/audit/password/${sharedId}`, { token: admin.token });
  const byOther = (sharedTrail.data?.data || []).find(e => e.action === "revealed") || {};
  check(!!byOther.user?.name, `the reveal names the actor (${byOther.user?.name})`);
  check(byOther.user?.email === PERSONAS[1], `and it is that administrator's own address (${byOther.user?.email})`);
  check(!sharedTrail.data?.data?.some(e => e.action === "revealed" && e.user?.email === PERSONAS[0]), "the reveal is not attributed to the other administrator");

  await prisma.kumoAuditLog.deleteMany({ where: { itemId: { in: [...createdIds, docId].filter(Boolean) } } });
  await prisma.kumoPasswordAccessLog.deleteMany({ where: { passwordId: { in: createdIds } } }).catch(() => {});
  await prisma.kumoDocumentRevision.deleteMany({ where: { documentId: docId } }).catch(() => {});
  await prisma.kumoDocument.deleteMany({ where: { id: docId } }).catch(() => {});
  await prisma.kumoPassword.deleteMany({ where: { id: { in: createdIds } } }).catch(() => {});
  await prisma.recentlyViewedItem.deleteMany({ where: { entityId: { in: [...createdIds, docId].filter(Boolean) } } }).catch(() => {});
  const personaIds = (await prisma.user.findMany({ where: { email: { in: PERSONAS } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.kumoPassword.count({ where: { label: { contains: "Probe vault" } } });
  const strayAudit = await prisma.kumoAuditLog.count({ where: { itemId: { in: [...createdIds, docId].filter(Boolean) } } });
  check(leftovers === 0 && strayAudit === 0, `the probe cleaned up after itself (${leftovers} credentials, ${strayAudit} audit rows)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
