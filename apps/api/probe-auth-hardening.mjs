/**
 * Auth hardening behind `AUTH_HARDENING_ENABLED` (PLAN-013 #8, SOC 2 backlog item 11).
 *
 * Three claims the plan makes and nothing has ever tested:
 *   1. a legacy password hash is upgraded to bcrypt cost 12 on the next sign-in, and the
 *      password still works afterwards;
 *   2. with the switch on, the issued JWT lives 15 minutes rather than the dev 12 hours;
 *   3. with the switch on, five wrong passwords lock an account (and a sixth sign-in is refused
 *      as locked rather than as wrong credentials) — and the switch off leaves all of it alone.
 *
 * Run the API with `AUTH_HARDENING_ENABLED=true`, then:
 *   AUTH_HARDENING_ENABLED=true node probe-auth-hardening.mjs
 * and once more with the switch off to prove the other direction.
 *
 * Only a throwaway fixture account is used: locking a persona would break every other suite.
 */
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";

const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const PW = "Hardening-Probe-2026!";
const HARDENING = process.env.AUTH_HARDENING_ENABLED === "true";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function signIn(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function main() {
  const stamp = Date.now();
  const email = `hardening.probe.${stamp}@c7ntax.local`;
  const role = await prisma.role.findFirst({ where: { systemRole: "technician" } }) ?? await prisma.role.findFirst();

  // A legacy hash: cost 10, which is what every account created before the hardening pass holds.
  const user = await prisma.user.create({
    data: {
      email,
      firstName: "Hardening",
      lastName: "Probe",
      isActive: true,
      emailVerified: true,
      mustChangePassword: false,
      mfaEnabled: false,
      roleId: role.id,
      passwordHash: bcrypt.hashSync(PW, 10),
    },
    select: { id: true },
  });
  console.log(`\nAUTH_HARDENING_ENABLED is ${HARDENING ? "on" : "off"}`);

  console.log("\na legacy hash signs in, and is upgraded while it does");
  const first = await signIn(email, PW);
  check(first.status === 200 && !!first.data?.token, `the fixture signs in with its cost-10 hash (${first.status})`);
  const afterSignIn = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
  if (HARDENING) {
    // bcryptjs spells cost 12 `$2a$12$`; the cost is the claim, not the vendor's letter.
    check(/^\$2[aby]\$12\$/.test(afterSignIn.passwordHash), `the stored hash is now cost 12 (${afterSignIn.passwordHash.slice(0, 7)})`);
    check(await bcrypt.compare(PW, afterSignIn.passwordHash), "and it still validates the same password");
    const second = await signIn(email, PW);
    check(second.status === 200, `so the next sign-in works too (${second.status})`);
    const unchanged = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });
    check(unchanged.passwordHash === afterSignIn.passwordHash, "and a hash already at cost 12 is left alone rather than re-hashed on every sign-in");
  } else {
    check(/^\$2[aby]\$10\$/.test(afterSignIn.passwordHash), `with hardening off the hash is left as it was (${afterSignIn.passwordHash.slice(0, 7)})`);
  }

  console.log("\nthe token's lifetime follows the switch");
  const payload = JSON.parse(Buffer.from(String(first.data.token).split(".")[1], "base64url").toString("utf8"));
  const ttlMinutes = Math.round((payload.exp - payload.iat) / 60);
  check(payload.iat && payload.exp, "the token carries issued-at and expiry claims");
  if (HARDENING) check(ttlMinutes === 15, `it lives fifteen minutes (${ttlMinutes})`);
  else check(ttlMinutes === 720, `it lives the development twelve hours (${ttlMinutes} minutes)`);

  console.log("\nfive wrong passwords lock the account, when the switch is on");
  await prisma.user.update({ where: { id: user.id }, data: { loginAttempts: 0, isLocked: false } });
  const statuses = [];
  for (let i = 0; i < 5; i++) statuses.push((await signIn(email, "not-the-password")).status);
  const lockedRow = await prisma.user.findUnique({ where: { id: user.id }, select: { isLocked: true, loginAttempts: true } });
  if (HARDENING) {
    check(statuses.every(s => s === 401), `the first five failures are credential failures (${statuses.join(",")})`);
    check(lockedRow.isLocked && lockedRow.loginAttempts >= 5, `the account is locked after five (attempts ${lockedRow.loginAttempts})`);
    const locked = await signIn(email, PW);
    check(locked.status === 423, `and the correct password is now refused as locked, not as wrong (${locked.status})`);
    check(/locked/i.test(locked.data?.error || ""), `with a message that says so (${String(locked.data?.error).slice(0, 60)})`);
  } else {
    check(lockedRow.isLocked === false, "with hardening off, failures never lock the account");
    check((await signIn(email, PW)).status === 200, "so the same password still works after five failures");
  }

  await prisma.userSession.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
  await prisma.$disconnect();
  console.log("  note  fixture account and its sessions removed");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
