/**
 * Session authentication suite (PLAN-001).
 *
 * Drives the real API with a hand-managed cookie jar, because the whole point is what
 * happens when a *browser* holds the credential:
 *   · sign-in sets an HttpOnly, SameSite=Strict session cookie and the CSRF cookie
 *   · the cookie alone authenticates a request, with no Authorization header
 *   · a write riding on the cookie is refused without the CSRF header and accepted with it
 *   · signing out ends the session server-side, so a replayed cookie stops working
 *   · a second sign-in retires the first session (one live session per account)
 *   · an idle session answers 440 — except for administrators, who are exempt by design
 *   · the bearer-token path is untouched: every non-browser client still works
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};

const cookiesFrom = (res) => {
  const raw = res.headers.getSetCookie ? res.headers.getSetCookie() : [res.headers.get("set-cookie")].filter(Boolean);
  const jar = {};
  for (const line of raw) {
    const [pair] = line.split(";");
    const [name, ...rest] = pair.split("=");
    jar[name.trim()] = rest.join("=");
  }
  return { jar, raw };
};
const header = (jar) => Object.entries(jar).map(([k, v]) => `${k}=${v}`).join("; ");

async function call(method, path, { jar, token, body, csrf, extraHeaders } = {}) {
  const headers = { "content-type": "application/json", ...(extraHeaders || {}) };
  if (jar && Object.keys(jar).length) headers.cookie = header(jar);
  if (token) headers.authorization = `Bearer ${token}`;
  if (csrf) headers["x-csrf-token"] = csrf;
  const res = await fetch(BASE + "/api" + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data, headers: res.headers, ...cookiesFrom(res) };
}

async function signIn(email) {
  const res = await call("POST", "/auth/login", { body: { email, password: PW } });
  return res;
}

console.log("sign-in issues a session");
const admin = await signIn("persona.admin@c7ntax.local");
check(admin.status === 200, `sign-in succeeds (${admin.status})`);
check(!!admin.jar.c7_sid, "session cookie is set");
check(!!admin.jar.c7_csrf, "csrf cookie is set");
const sidLine = (admin.raw || []).find(l => l.startsWith("c7_sid=")) || "";
check(/HttpOnly/i.test(sidLine), `session cookie is HttpOnly (${sidLine.split(";").slice(1).join(";").trim().slice(0, 60)})`);
check(/SameSite=Strict/i.test(sidLine), "session cookie is SameSite=Strict");
check(!/HttpOnly/i.test((admin.raw || []).find(l => l.startsWith("c7_csrf=")) || ""), "csrf cookie is readable by the SPA");
check(typeof admin.data?.token === "string", "a bearer token is still returned for non-browser clients");

console.log("\nthe cookie authenticates on its own");
const session = await call("GET", "/auth/session", { jar: admin.jar });
check(session.status === 200 && session.data?.user?.email === "persona.admin@c7ntax.local", `GET /auth/session resolves the cookie (${session.status})`);
check(typeof session.data?.timeoutMinutes === "number", `session state carries the idle timeout (${session.data?.timeoutMinutes} min)`);
const byCookie = await call("GET", "/tickets?limit=1", { jar: admin.jar });
check(byCookie.status === 200, `a read with only the cookie works (${byCookie.status})`);
const noCredential = await call("GET", "/tickets?limit=1", {});
check(noCredential.status === 401, `no credential is refused (${noCredential.status})`);

console.log("\nCSRF on cookie-authenticated writes");
const withoutCsrf = await call("POST", "/tickets", { jar: admin.jar, body: { title: "session probe — should not exist", boardId: "00000000-0000-0000-0000-000000000000" } });
check(withoutCsrf.status === 403 && withoutCsrf.data?.error?.code === "CSRF_FAILED", `write without the CSRF header is refused (${withoutCsrf.status} ${withoutCsrf.data?.error?.code})`);
// The same guarded route with the token passes the CSRF gate and then fails validation (400),
// which proves the header was accepted without creating a ticket.
const withCsrf = await call("POST", "/tickets", { jar: admin.jar, csrf: admin.jar.c7_csrf, body: { title: "session probe — should not exist", boardId: "00000000-0000-0000-0000-000000000000" } });
check(withCsrf.status !== 403, `write with the CSRF header passes the gate (${withCsrf.status})`);
// Session lifecycle endpoints sit outside the guarded write surface, so they authenticate
// themselves; SameSite=strict means cross-site requests never carry the session cookie anyway.
const extendNoCsrf = await call("POST", "/auth/session/extend", { jar: admin.jar });
check(extendNoCsrf.status === 200, `session endpoints are CSRF-exempt by design (${extendNoCsrf.status})`);
const safeGetWithoutCsrf = await call("GET", "/tickets?limit=1", { jar: admin.jar });
check(safeGetWithoutCsrf.status === 200, "a safe method needs no CSRF token");

console.log("\none live session per account");
const adminSecond = await signIn("persona.admin@c7ntax.local");
check(adminSecond.status === 200, `second sign-in succeeds (${adminSecond.status})`);
const oldSession = await call("GET", "/auth/session", { jar: admin.jar });
check(oldSession.status === 401, `the first cookie stops working (${oldSession.status})`);
const newSession = await call("GET", "/auth/session", { jar: adminSecond.jar });
check(newSession.status === 200, `the newest cookie works (${newSession.status})`);

console.log("\nsign-out ends the session server-side");
const logout = await call("POST", "/auth/logout", { jar: adminSecond.jar, csrf: adminSecond.jar.c7_csrf });
check(logout.status === 200, `logout accepted (${logout.status})`);
const afterLogout = await call("GET", "/tickets?limit=1", { jar: adminSecond.jar });
check(afterLogout.status === 401 || afterLogout.status === 440, `the cookie is dead after logout (${afterLogout.status})`);

console.log("\nthe bearer-token path is untouched");
const byToken = await call("GET", "/tickets?limit=1", { token: admin.data.token });
check(byToken.status === 200, `a token-only request still works (${byToken.status})`);

console.log("\nidle timeout, and the administrator exemption");
const technician = await signIn("persona.tech@c7ntax.local");
check(technician.status === 200 && !!technician.jar.c7_sid, `technician signed in (${technician.status})`);
const adminAgain = await signIn("persona.admin@c7ntax.local");

// Age both sessions past the idle timeout directly in the database.
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();
const aged = new Date(Date.now() - 90 * 60 * 1000);
const aged2 = await prisma.userSession.updateMany({
  where: { invalidatedAt: null, userId: { in: (await prisma.user.findMany({ where: { email: { in: ["persona.tech@c7ntax.local", "persona.admin@c7ntax.local"] } }, select: { id: true } })).map(u => u.id) } },
  data: { lastActivityAt: aged },
});
check(aged2.count >= 2, `aged ${aged2.count} sessions past the idle limit`);

const techIdle = await fetch(BASE + "/api/tickets?limit=1", { headers: { cookie: header(technician.jar) } });
const adminIdle = await fetch(BASE + "/api/tickets?limit=1", { headers: { cookie: header(adminAgain.jar) } });
check(techIdle.status === 440, `an idle technician session is refused with 440 (${techIdle.status})`);
check(adminIdle.status === 200, `an administrator session is exempt from the idle timeout (${adminIdle.status})`);
const techBody = await techIdle.json().catch(() => ({}));
check(techBody?.code === "SESSION_TIMEOUT", `the timeout response carries its reason (${techBody?.code})`);

// The browser must not warn about a timeout the server will not enforce.
const adminSessionInfo = await call("GET", "/auth/session", { jar: adminAgain.jar });
check(adminSessionInfo.data?.idleTimeoutExempt === true && adminSessionInfo.data?.timeoutMinutes === 0, `an exempt session reports no idle timeout (${adminSessionInfo.data?.timeoutMinutes})`);
const freshTech = await signIn("persona.tech@c7ntax.local");
const techSessionInfo = await call("GET", "/auth/session", { jar: freshTech.jar });
check(techSessionInfo.data?.idleTimeoutExempt === false && techSessionInfo.data?.timeoutMinutes > 0, `a normal session reports its timeout (${techSessionInfo.data?.timeoutMinutes} min)`);
const techAfter = await prisma.userSession.findMany({ where: { userId: (await prisma.user.findFirst({ where: { email: "persona.tech@c7ntax.local" }, select: { id: true } })).id }, select: { invalidatedAt: true } });
check(techAfter.some(s => s.invalidatedAt), "the timed-out session is invalidated in the database");

console.log("\npassword change and administrator reset retire sessions");
const tech2 = await signIn("persona.tech@c7ntax.local");
await prisma.user.update({ where: { email: "persona.tech@c7ntax.local" }, data: { mustChangePassword: false } });
const samePassword = await call("POST", "/auth/change-password", {
  jar: tech2.jar, csrf: tech2.jar.c7_csrf,
  body: { currentPassword: PW, newPassword: PW },
});
check(samePassword.status === 400, `reusing the same password is refused (${samePassword.status})`);

// An administrator reset must end the target's live sessions. A temporary account is used
// so the shared verification personas keep their password.
const adminToken = (await signIn("persona.admin@c7ntax.local")).data.token;
const probeEmail = `sessionprobe${Date.now()}@probe.local`;
const created = await call("POST", "/users", {
  token: adminToken,
  body: { email: probeEmail, firstName: "Session", lastName: "Probe", password: PW, role: "technician", credentialMode: "set", requireChange: false },
});
check(created.status === 201 || created.status === 200, `temporary account created (${created.status})`);
const probeLogin = await call("POST", "/auth/login", { body: { email: probeEmail, password: PW } });
check(probeLogin.status === 200 && !!probeLogin.jar.c7_sid, `temporary account signed in (${probeLogin.status})`);
const targetId = created.data?.id ?? created.data?.data?.id;
const reset = await call("POST", `/users/${targetId}/reset-password`, { token: adminToken, body: { requireChange: true } });
check(reset.status === 200, `administrator reset accepted (${reset.status})`);
const afterReset = await call("GET", "/tickets?limit=1", { jar: probeLogin.jar });
check(afterReset.status === 401 || afterReset.status === 440, `the reset ended the live session (${afterReset.status})`);

// Leave nothing behind: the probe account and its sessions go.
if (targetId) await prisma.user.delete({ where: { id: targetId } }).catch(() => {});
const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
console.log("  note  probe account and sessions removed from the database");
await prisma.$disconnect();

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);

