/**
 * Passkey management assertions (PLAN-002 §5.3): the account owner's list, rename and remove,
 * and — just as important — that nobody can touch somebody else's credential.
 *
 * Run from apps/api so the Prisma client resolves:
 *   node probe-passkey.mjs
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
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

async function main() {
  const tech = await signIn("persona.tech@c7ntax.local");
  const other = await signIn("persona.readonly@c7ntax.local");
  check(tech.status === 200 && !!tech.token, `technician signed in (${tech.status})`);
  check(other.status === 200 && !!other.token, `second account signed in (${other.status})`);

  const techUser = await prisma.user.findFirst({ where: { email: "persona.tech@c7ntax.local" }, select: { id: true } });
  const otherUser = await prisma.user.findFirst({ where: { email: "persona.readonly@c7ntax.local" }, select: { id: true } });

  console.log("\nthe management endpoints require a signed-in user");
  for (const [method, path] of [["GET", "/api/auth/webauthn/credentials"], ["PATCH", "/api/auth/webauthn/credentials/x"], ["DELETE", "/api/auth/webauthn/credentials/x"]]) {
    const res = await call(method, path, { body: method === "GET" ? undefined : { deviceName: "nope" } });
    check(res.status === 401, `${method} ${path.replace("/api/auth/webauthn", "")} without a credential is refused (${res.status})`);
  }

  console.log("\nthe list belongs to the caller");
  const list = await call("GET", "/api/auth/webauthn/credentials", { token: tech.token });
  check(list.status === 200 && Array.isArray(list.data), `list answers with an array (${list.status})`);
  check((list.data || []).every(p => !("publicKey" in p) && !("counter" in p)), "key material never leaves the server");

  // A credential that belongs to somebody else, planted directly so the test does not need
  // a second authenticator.
  const planted = await prisma.webauthnCredential.create({
    data: { userId: otherUser.id, credentialId: `probe-${Date.now()}`, publicKey: "AAAA", counter: 0, transports: "[]", deviceName: "Someone else's key" },
  });
  const mine = await prisma.webauthnCredential.create({
    data: { userId: techUser.id, credentialId: `probe-${Date.now() + 1}`, publicKey: "AAAA", counter: 0, transports: "[]", deviceName: "Probe key" },
  });

  console.log("\nrename");
  const blank = await call("PATCH", `/api/auth/webauthn/credentials/${mine.id}`, { token: tech.token, body: { deviceName: "   " } });
  check(blank.status === 400, `a blank name is refused (${blank.status})`);
  const rename = await call("PATCH", `/api/auth/webauthn/credentials/${mine.id}`, { token: tech.token, body: { deviceName: "Renamed by the probe" } });
  check(rename.status === 200 && rename.data?.deviceName === "Renamed by the probe", `rename is accepted (${rename.status})`);
  const persisted = await prisma.webauthnCredential.findUnique({ where: { id: mine.id }, select: { deviceName: true } });
  check(persisted?.deviceName === "Renamed by the probe", "the new name is stored");
  const notMine = await call("PATCH", `/api/auth/webauthn/credentials/${planted.id}`, { token: tech.token, body: { deviceName: "hijacked" } });
  check(notMine.status === 404, `another account's passkey cannot be renamed (${notMine.status})`);
  const renamedOther = await prisma.webauthnCredential.findUnique({ where: { id: planted.id }, select: { deviceName: true } });
  check(renamedOther?.deviceName === "Someone else's key", "the other account's label is untouched");
  const unknown = await call("PATCH", "/api/auth/webauthn/credentials/not-a-real-id", { token: tech.token, body: { deviceName: "x" } });
  check(unknown.status === 404, `an unknown id is not found (${unknown.status})`);

  console.log("\nremove");
  const removeOther = await call("DELETE", `/api/auth/webauthn/credentials/${planted.id}`, { token: tech.token });
  check(removeOther.status === 404, `another account's passkey cannot be removed (${removeOther.status})`);
  const stillThere = await prisma.webauthnCredential.count({ where: { id: planted.id } });
  check(stillThere === 1, "the other account's passkey is still there");
  const removeMine = await call("DELETE", `/api/auth/webauthn/credentials/${mine.id}`, { token: tech.token });
  check(removeMine.status === 200, `removal is accepted (${removeMine.status})`);
  const gone = await prisma.webauthnCredential.count({ where: { id: mine.id } });
  check(gone === 0, "the row is gone");

  console.log("\nsign-in before an options call");
  // A 429 here means an earlier rate-limit check in the same minute; wait it out rather
  // than reporting a failure about the limiter as if it were about the endpoint.
  let noChallenge = await call("POST", "/api/auth/webauthn/login/verify", { body: { userId: techUser.id, response: { id: "x" } } });
  if (noChallenge.status === 429) {
    console.log("  note  the passkey limiter is still tripped — waiting 62s");
    await new Promise(r => setTimeout(r, 62_000));
    noChallenge = await call("POST", "/api/auth/webauthn/login/verify", { body: { userId: techUser.id, response: { id: "x" } } });
  }
  check(noChallenge.status === 400, `verifying without a pending challenge is refused (${noChallenge.status})`);

  // Anything the probe planted goes; the two personas keep the accounts they had.
  await prisma.webauthnCredential.deleteMany({ where: { id: { in: [planted.id, mine.id] } } });
  await prisma.userSession.deleteMany({ where: { userId: { in: [techUser.id, otherUser.id] } } });
  console.log("  note  planted credentials and probe sessions removed");

  await prisma.$disconnect();
  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
