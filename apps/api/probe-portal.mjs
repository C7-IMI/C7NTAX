/**
 * Customer portal (PLAN-013 #3).
 *
 * The invariants under test:
 *   1. A customer sees their own tickets — not their colleagues', not their client's.
 *   2. Internal notes and billing never cross the boundary.
 *   3. A portal token is worthless on a staff route, and a staff token is worthless here.
 *   4. Sign-in cannot enumerate customers, codes are single-use, expire, and are attempt-limited.
 *
 * Requires `PORTAL_ENABLED=true` on the API process, and no SMTP (delivery failures are logged
 * and do not change the answer — the probe reads the code from the database, as the mailbox would).
 *
 * Run from apps/api:  node probe-portal.mjs
 * Companion:          PORTAL_ENABLED unset  →  node probe-portal-off.mjs
 */
import { createHash } from "node:crypto";
import { PrismaClient } from "@prisma/client";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";
const prisma = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

async function call(method, path, { token, csrf, body, cookies } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(csrf ? { "x-portal-csrf": csrf } : {}),
      ...(cookies ? { cookie: cookies } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, setCookie: res.headers.getSetCookie?.() ?? [] };
}

async function staffSignIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return data.token;
}

/** Reads the live code out of the database, standing in for the customer's inbox. */
async function latestCode(contactId) {
  const row = await prisma.portalLoginCode.findFirst({
    where: { contactId, consumedAt: null },
    orderBy: { createdAt: "desc" },
    select: { id: true, codeHash: true, expiresAt: true, attempts: true, createdAt: true },
  });
  return row;
}

/** The code is only ever stored hashed, so a brute-force over six digits recovers it here. */
function crack(hash) {
  for (let i = 0; i < 1_000_000; i++) {
    const candidate = String(i).padStart(6, "0");
    if (createHash("sha256").update(candidate).digest("hex") === hash) return candidate;
  }
  return null;
}

async function main() {
  const stamp = Date.now()
  // A client number nothing else is using, so the probe can run repeatedly without colliding.
  const highest = await prisma.company.aggregate({ _max: { clientId: true } });
  const clientId = (highest._max.clientId ?? 200000) + 1;
  const staffToken = await staffSignIn("persona.admin@c7ntax.local");
  check(!!staffToken, "a staff account signed in");

  const adminUser = await prisma.user.findUnique({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } });
  const board = await prisma.serviceBoard.findFirst({ where: { isActive: true }, select: { id: true } });

  const mkClient = (name, portalEnabled) => prisma.company.create({
    data: {
      name, companyType: "Client", portalEnabled,
      portalAccentColor: "#0ea5e9", portalLogoUrl: "https://example.invalid/logo.png",
    },
    select: { id: true, name: true },
  });
  const client = await mkClient(`Portal Probe ${stamp}`, true);
  const closedClient = await mkClient(`Portal Probe Closed ${stamp}`, false);
  // A real client-number series, so the ticket number the portal produces is the one a person
  // would recognise rather than the connector's fallback shape.
  await prisma.company.update({ where: { id: client.id }, data: { clientId, clientType: "MSP" } });

  const mkContact = (companyId, first, email) => prisma.contact.create({
    data: { firstName: first, lastName: "Probe", email, companyId, isActive: true },
    select: { id: true, email: true },
  });
  const alice = await mkContact(client.id, "Alice", `portal.alice.${stamp}@example.invalid`);
  const bob = await mkContact(client.id, "Bob", `portal.bob.${stamp}@example.invalid`);
  const outsider = await mkContact(closedClient.id, "Carol", `portal.carol.${stamp}@example.invalid`);

  const mkTicket = (contactId, number, status, extra = {}) => prisma.ticket.create({
    data: {
      ticketNumber: number,
      title: `${number} probe`,
      description: "Probe ticket",
      boardId: board.id,
      companyId: client.id,
      contactId,
      priority: "medium",
      status,
      source: "portal",
      createdById: adminUser.id,
      ...extra,
    },
    select: { id: true },
  });
  const aliceTicket = await mkTicket(alice.id, `PRT-${stamp}-1`, "open");
  const bobTicket = await mkTicket(bob.id, `PRT-${stamp}-2`, "open");
  const closedTicket = await mkTicket(alice.id, `PRT-${stamp}-3`, "closed");
  // One customer-visible note and one internal note on Alice's ticket.
  await prisma.ticketComment.create({ data: { ticketId: aliceTicket.id, body: "Visible answer", authorId: adminUser.id, isInternal: false } });
  await prisma.ticketComment.create({ data: { ticketId: aliceTicket.id, body: "INTERNAL: do not show", authorId: adminUser.id, isInternal: true } });

  console.log("\nrequesting a code never says who is a customer");
  const unknown = await call("POST", "/api/portal/auth/request", { body: { email: `nobody.${stamp}@example.invalid` } });
  const known = await call("POST", "/api/portal/auth/request", { body: { email: alice.email } });
  check(unknown.status === 202, `an unknown address answers 202 (${unknown.status})`);
  check(known.status === 202, `a known contact answers 202 (${known.status})`);
  check(JSON.stringify(unknown.data) === JSON.stringify(known.data), "with byte-identical bodies, so neither is a customer list");
  check(!("code" in known.data) && !/\b\d{6}\b/.test(JSON.stringify(known.data)), "and the code is never in the response");

  const offClient = await call("POST", "/api/portal/auth/request", { body: { email: outsider.email } });
  check(offClient.status === 202, `a contact of a client with the portal off also answers 202 (${offClient.status})`);
  const outsiderCodes = await prisma.portalLoginCode.count({ where: { contactId: outsider.id } });
  check(outsiderCodes === 0, `but no code is issued for them (${outsiderCodes})`);

  console.log("\nthe code is stored hashed, single-use, and rate-limited");
  const issued = await latestCode(alice.id);
  check(!!issued, "a code row exists for the requesting contact");
  const code = crack(issued.codeHash);
  check(!!code, "the stored value is a hash of a six-digit code, not the code");
  check(/^\d{6}$/.test(code), `the code is six digits (${code?.length})`);

  const asked = [];
  for (let i = 0; i < 3; i++) asked.push(await call("POST", "/api/portal/auth/request", { body: { email: alice.email } }));
  const codesNow = await prisma.portalLoginCode.count({ where: { contactId: alice.id, consumedAt: null } });
  check(asked.every(r => r.status === 202), "further requests still answer 202");
  check(codesNow === 1, `but only the newest code is live (${codesNow}), so a stale mailbox cannot be used`);
  const overLimit = await prisma.portalLoginCode.count({ where: { contactId: alice.id } });
  check(overLimit >= 3, `the earlier codes were retired rather than left usable (${overLimit} rows kept for the audit)`);

  const current = await latestCode(alice.id);
  const liveCode = crack(current.codeHash);

  console.log("\nverifying a code");
  const wrong = await call("POST", "/api/portal/auth/verify", { body: { email: alice.email, code: "000000" === liveCode ? "111111" : "000000" } });
  check(wrong.status === 401, `a wrong code is refused (${wrong.status})`);
  const attempts = await prisma.portalLoginCode.findUnique({ where: { id: current.id }, select: { attempts: true } });
  check(attempts.attempts === 1, `and the attempt is counted against the code (${attempts.attempts})`);

  const verified = await call("POST", "/api/portal/auth/verify", { body: { email: alice.email, code: liveCode } });
  check(verified.status === 200, `the real code signs the contact in (${verified.status})`);
  check(!!verified.data.token && !!verified.data.csrfToken, "returning a session and CSRF token");
  check(verified.data.company?.accentColor === "#0ea5e9", `with the client's branding (${verified.data.company?.accentColor})`);
  check(verified.data.company?.logoUrl === "https://example.invalid/logo.png", `and logo (${verified.data.company?.logoUrl})`);
  check(verified.data.contact?.email === alice.email, `and the contact (${verified.data.contact?.email})`);
  const portalToken = verified.data.token;
  const portalCsrf = verified.data.csrfToken;

  const cookies = (verified.setCookie || []).map(c => c.split(";")[0]);
  check(cookies.some(c => c.startsWith("c7_portal=")), "the session cookie is set");
  const csrfCookie = (verified.setCookie || []).find(c => c.startsWith("c7_portal_csrf="));
  check(!!csrfCookie, "the CSRF cookie is set");
  check((verified.setCookie || []).some(c => /HttpOnly/i.test(c) && c.startsWith("c7_portal=")), "the session cookie is HttpOnly");

  const reused = await call("POST", "/api/portal/auth/verify", { body: { email: alice.email, code: liveCode } });
  check(reused.status === 401, `the same code cannot be used twice (${reused.status})`);

  console.log("\nexpiry and attempt limits");
  const expiring = await call("POST", "/api/portal/auth/request", { body: { email: bob.email } });
  check(expiring.status === 202, "a code was requested for the second contact");
  const bobCodeRow = await latestCode(bob.id);
  await prisma.portalLoginCode.update({ where: { id: bobCodeRow.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
  const expired = await call("POST", "/api/portal/auth/verify", { body: { email: bob.email, code: crack(bobCodeRow.codeHash) } });
  check(expired.status === 401 && /expired/i.test(expired.data?.error?.message || ""), `an expired code is refused as expired (${expired.status})`);

  await call("POST", "/api/portal/auth/request", { body: { email: bob.email } });
  const bobFresh = await latestCode(bob.id);
  await prisma.portalLoginCode.update({ where: { id: bobFresh.id }, data: { attempts: 5 } });
  const burned = await call("POST", "/api/portal/auth/verify", { body: { email: bob.email, code: crack(bobFresh.codeHash) } });
  check(burned.status === 429, `a code out of attempts is refused as such (${burned.status})`);

  console.log("\nthe portal token is not a staff token, and vice versa");
  const portalOnStaff = await call("GET", "/api/tickets?limit=1", { token: portalToken });
  check(portalOnStaff.status === 401, `a portal token is refused on a staff route (${portalOnStaff.status})`);
  const staffOnPortal = await call("GET", "/api/portal/me", { token: staffToken });
  check(staffOnPortal.status === 401, `a staff token is refused on the portal (${staffOnPortal.status})`);
  const noToken = await call("GET", "/api/portal/me");
  check(noToken.status === 401, `and no token is refused (${noToken.status})`);

  console.log("\nthe customer sees their tickets and nobody else's");
  const me = await call("GET", "/api/portal/me", { token: portalToken });
  check(me.status === 200, `the account answers (${me.status})`);
  check(me.data?.contact?.email === alice.email, "with the signed-in contact");
  check(me.data?.company?.name === client.name, "and their client");
  check(me.data?.openTickets === 1, `and their open ticket count, which excludes the closed one (${me.data?.openTickets})`);

  const tickets = await call("GET", "/api/portal/tickets", { token: portalToken });
  const numbers = (tickets.data?.data || []).map(t => t.ticketNumber);
  check(tickets.status === 200, `the ticket list answers (${tickets.status})`);
  check(numbers.includes(`PRT-${stamp}-1`), "it includes the contact's own ticket");
  check(numbers.includes(`PRT-${stamp}-3`), "and their closed one");
  check(!numbers.includes(`PRT-${stamp}-2`), `but not their colleague's ticket in the same client (${numbers.join(", ")})`);
  check(!("description" in (tickets.data?.data?.[0] ?? {})), "and the list is a summary, not the full thread");

  const colleague = await call("GET", `/api/portal/tickets/${bobTicket.id}`, { token: portalToken });
  check(colleague.status === 404, `a colleague's ticket reads as not found rather than forbidden (${colleague.status})`);
  const otherClient = await prisma.ticket.findFirst({ where: { companyId: { not: client.id } }, select: { id: true } });
  if (otherClient) {
    const foreign = await call("GET", `/api/portal/tickets/${otherClient.id}`, { token: portalToken });
    check(foreign.status === 404, `another client's ticket also reads as not found (${foreign.status})`);
  }

  const detail = await call("GET", `/api/portal/tickets/${aliceTicket.id}`, { token: portalToken });
  const bodies = (detail.data?.comments || []).map(c => c.body);
  check(detail.status === 200, `the ticket detail answers (${detail.status})`);
  check(bodies.includes("Visible answer"), "a customer-visible note is included");
  check(!bodies.some(b => b.includes("INTERNAL")), "an internal note is not");
  check(detail.data?.assignedToName === null || typeof detail.data?.assignedToName === "string", "the assignee is a name, not an id");
  check(!("invoices" in detail.data) && !("timeEntries" in detail.data), "and no billing or time data is present");

  console.log("\nraising a ticket from the portal");
  const noCsrf = await call("POST", "/api/portal/tickets", { token: portalToken, body: { title: "Bearer without CSRF", description: "Should be accepted" } });
  check(noCsrf.status === 201, `a bearer write needs no CSRF header — nothing attaches it automatically (${noCsrf.status})`);
  const cookieNoCsrf = await call("POST", "/api/portal/tickets", { cookies: cookies.join("; "), body: { title: "No CSRF", description: "x" } });
  check(cookieNoCsrf.status === 403, `but a cookie-authenticated write without it is refused (${cookieNoCsrf.status})`);
  const cookieWrongCsrf = await call("POST", "/api/portal/tickets", { cookies: cookies.join("; "), csrf: "deadbeef", body: { title: "Wrong CSRF", description: "x" } });
  check(cookieWrongCsrf.status === 403, `and so is one carrying the wrong token (${cookieWrongCsrf.status})`);
  const cookieGoodCsrf = await call("POST", "/api/portal/tickets", { cookies: cookies.join("; "), csrf: portalCsrf, body: { title: "Cookie write", description: "Accepted with both halves" } });
  check(cookieGoodCsrf.status === 201, `while the real cookie plus its token is accepted (${cookieGoodCsrf.status})`);

  const badBody = await call("POST", "/api/portal/tickets", { token: portalToken, csrf: portalCsrf, body: { title: "  ", description: "x" } });
  check(badBody.status === 400, `a blank summary is refused (${badBody.status})`);
  const badBody2 = await call("POST", "/api/portal/tickets", { token: portalToken, csrf: portalCsrf, body: { title: "Printer is down" } });
  check(badBody2.status === 400, `and so is a missing description (${badBody2.status})`);

  const created = await call("POST", "/api/portal/tickets", {
    token: portalToken, csrf: portalCsrf,
    body: { title: "Portal-raised ticket", description: "The printer is on fire", priority: "high" },
  });
  check(created.status === 201, `the ticket is created (${created.status})`);
  // The series continues from the client's highest existing number, so the probe asserts the
  // shape and the client, not a literal 1001 (a leftover probe client would make that fragile).
  check(new RegExp(`^MSP-${clientId}-\\d+$`).test(created.data?.ticketNumber || ""), `with a number from the client's own series (${created.data?.ticketNumber})`);

  const raisedRow = await prisma.ticket.findUnique({
    where: { id: created.data.id },
    select: { companyId: true, contactId: true, source: true, status: true, priority: true, title: true, createdBy: { select: { email: true } }, comments: { select: { body: true, isInternal: true, fromEmail: true } } },
  });
  check(raisedRow.companyId === client.id, "it belongs to the contact's client");
  check(raisedRow.contactId === alice.id, "and to the contact");
  check(raisedRow.source === "portal", `its source records where it came from (${raisedRow.source})`);
  check(raisedRow.status === "new", `a staff member has to triage it (${raisedRow.status})`);
  check(raisedRow.priority === "high", `the priority the customer chose is kept (${raisedRow.priority})`);
  check(raisedRow.createdBy.email.startsWith("portal@"), `it is attributed to the portal actor, not a person (${raisedRow.createdBy.email})`);
  check(raisedRow.comments.length === 1 && raisedRow.comments[0].isInternal === false, "the customer's words are in the thread");
  check(raisedRow.comments[0].body === "The printer is on fire", "verbatim, not paraphrased");
  check(raisedRow.comments[0].fromEmail === alice.email, "with the customer as the sender");

  const visibleAfterCreate = await call("GET", "/api/portal/tickets", { token: portalToken });
  check((visibleAfterCreate.data?.data || []).some(t => t.id === created.data.id), "and it appears in their own list immediately");

  console.log("\nreplying, and reopening");
  const replyLogged = await call("POST", `/api/portal/tickets/${aliceTicket.id}/reply`, { token: portalToken, csrf: portalCsrf, body: { body: "Any update on this?" } });
  check(replyLogged.status === 201, `a reply on an open ticket is accepted (${replyLogged.status})`);
  check(replyLogged.data?.reopened === false, "and does not claim to have reopened it");
  const openStatus = await prisma.ticket.findUnique({ where: { id: aliceTicket.id }, select: { status: true } });
  check(openStatus.status === "open", `the status is left alone (${openStatus.status})`);

  const replyClosed = await call("POST", `/api/portal/tickets/${closedTicket.id}/reply`, { token: portalToken, csrf: portalCsrf, body: { body: "This is not fixed" } });
  check(replyClosed.status === 201 && replyClosed.data?.reopened === true, `a reply on a closed ticket reopens it (${replyClosed.status}/${replyClosed.data?.reopened})`);
  const reopened = await prisma.ticket.findUnique({ where: { id: closedTicket.id }, select: { status: true, closedAt: true } });
  check(reopened.status === "new", `the status returns to new (${reopened.status})`);
  check(reopened.closedAt === null, "and the close timestamp is cleared");
  const replyComment = await prisma.ticketComment.findFirst({ where: { ticketId: closedTicket.id, fromEmail: alice.email }, select: { isInternal: true } });
  check(replyComment?.isInternal === false, "the reply is visible to the provider");
  const foreignReply = await call("POST", `/api/portal/tickets/${bobTicket.id}/reply`, { token: portalToken, csrf: portalCsrf, body: { body: "Not mine" } });
  check(foreignReply.status === 404, `replying to a colleague's ticket is refused (${foreignReply.status})`);

  console.log("\naccess is re-checked on every request, and ends when it should");
  await prisma.company.update({ where: { id: client.id }, data: { portalEnabled: false } });
  const afterOff = await call("GET", "/api/portal/me", { token: portalToken });
  check(afterOff.status === 401, `switching the portal off ends live sessions (${afterOff.status})`);
  await prisma.company.update({ where: { id: client.id }, data: { portalEnabled: true } });
  const backOn = await call("GET", "/api/portal/me", { token: portalToken });
  check(backOn.status === 200, `and switching it back on restores the same session (${backOn.status})`);

  await prisma.contact.update({ where: { id: alice.id }, data: { isActive: false } });
  const afterDeactivate = await call("GET", "/api/portal/me", { token: portalToken });
  check(afterDeactivate.status === 401, `deactivating the contact ends their sessions (${afterDeactivate.status})`);
  await prisma.contact.update({ where: { id: alice.id }, data: { isActive: true } });

  console.log("\ndevices are capped rather than one-per-customer");
  const deviceTokens = [];
  for (let i = 0; i < 6; i++) {
    // The code rate limit is per window; backdate the earlier code rows so this loop tests the
    // session cap rather than the mail throttle.
    await prisma.portalLoginCode.updateMany({
      where: { contactId: bob.id },
      data: { createdAt: new Date(Date.now() - 20 * 60 * 1000) },
    });
    await call("POST", "/api/portal/auth/request", { body: { email: bob.email } });
    const row = await latestCode(bob.id);
    const verifiedDevice = await call("POST", "/api/portal/auth/verify", { body: { email: bob.email, code: crack(row.codeHash) } });
    check(verifiedDevice.status === 200, `device ${i + 1} signed in (${verifiedDevice.status})`);
    deviceTokens.push(verifiedDevice.data.token);
  }
  const liveSessions = await prisma.portalSession.count({ where: { contactId: bob.id, invalidatedAt: null } });
  check(liveSessions === 5, `exactly five sessions stay live (${liveSessions})`);
  const oldestDevice = await call("GET", "/api/portal/me", { token: deviceTokens[0] });
  check(oldestDevice.status === 401, `the oldest device was signed out to make room (${oldestDevice.status})`);
  const newestDevice = await call("GET", "/api/portal/me", { token: deviceTokens[5] });
  check(newestDevice.status === 200, `and the newest is live (${newestDevice.status})`);

  const loggedOut = await call("POST", "/api/portal/auth/logout", { token: portalToken, csrf: portalCsrf });
  check(loggedOut.status === 200, `signing out answers (${loggedOut.status})`);
  const afterLogout = await call("GET", "/api/portal/me", { token: portalToken });
  check(afterLogout.status === 401, `and the token is dead afterwards (${afterLogout.status})`);

  console.log("\nthe branding a customer sees is validated where it is set");
  const badColour = await call("PATCH", `/api/clients/${client.id}`, { token: staffToken, body: { portalAccentColor: "orange" } });
  check(badColour.status === 400, `a colour that is not a hex value is refused (${badColour.status})`);
  const badLogo = await call("PATCH", `/api/clients/${client.id}`, { token: staffToken, body: { portalLogoUrl: "javascript:alert(1)" } });
  check(badLogo.status === 400, `and so is a logo URL that is not http(s) or an API path (${badLogo.status})`);
  const goodBranding = await call("PATCH", `/api/clients/${client.id}`, { token: staffToken, body: { portalAccentColor: "#123456", portalLogoUrl: "/uploads/logo.png" } });
  check(goodBranding.status === 200 && goodBranding.data?.portalAccentColor === "#123456", `a valid colour is stored (${goodBranding.data?.portalAccentColor})`);
  check(goodBranding.data?.portalLogoUrl === "/uploads/logo.png", `and so is a relative logo path (${goodBranding.data?.portalLogoUrl})`);

  await prisma.portalLoginCode.deleteMany({ where: { contactId: { in: [alice.id, bob.id, outsider.id] } } });
  await prisma.portalSession.deleteMany({ where: { contactId: { in: [alice.id, bob.id, outsider.id] } } });
  await prisma.ticketComment.deleteMany({ where: { ticket: { companyId: { in: [client.id, closedClient.id] } } } });
  await prisma.ticket.deleteMany({ where: { companyId: { in: [client.id, closedClient.id] } } });
  await prisma.contact.deleteMany({ where: { id: { in: [alice.id, bob.id, outsider.id] } } });
  await prisma.company.deleteMany({ where: { id: { in: [client.id, closedClient.id] } } });
  await prisma.userSession.deleteMany({ where: { userId: adminUser.id } });
  await prisma.$disconnect();
  console.log("  note  probe clients, contacts, tickets, codes and sessions removed; portal@c7ntax.local is the portal's system actor and is left in place");

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
