/**
 * The executor: what an approved AI action actually does.
 *
 * The probe that matters here is the one nobody could write before today, because the behaviour it
 * checks did not exist: **approving an action applies it.** Until the executor landed, `decide` set a
 * status and stopped, so a reviewed and approved proposal left the ticket exactly as it was. Every
 * check below is about that, and about the ways it must *not* work — a critical action, an action
 * with no handler, a payload naming a ticket that is not there.
 *
 * It runs against the real API (so the *route* is what performs the write, which is the design) and
 * the real database. Run from apps/api:  node probe-ai-apply.mjs
 */
import { PrismaClient } from "@prisma/client";
import { ASSISTANT_TOOLS } from "./src/services/ai/tools";

const BASE = process.env.C7NTAX_API_BASE || "http://127.0.0.1:4000";
const db = new PrismaClient();

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};
const eq = (actual, expected, label) =>
  check(JSON.stringify(actual) === JSON.stringify(expected), `${label}${JSON.stringify(actual) === JSON.stringify(expected) ? "" : ` — got ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`}`);

async function login() {
  const response = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@C7NTAX.com", password: "admin" }),
  });
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.token) throw new Error(`could not sign in as the development admin (${response.status})`);
  return { token: data.token, userId: data.user.id };
}

async function decide(admin, actionId, decision) {
  const response = await fetch(`${BASE}/api/ai-actions/${actionId}/decide`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${admin.token}` },
    body: JSON.stringify({ decision }),
  });
  return { status: response.status, data: await response.json().catch(() => null) };
}

/** Raise a proposal the way the assistant does, so the probe tests the real row shape. */
async function propose({ kind, payload, tier = "low", title = "Probe proposal", actorId }) {
  return db.aiAction.create({
    data: {
      entityType: "ticket",
      entityId: payload.ticketId ?? null,
      title,
      summary: "Raised by probe-ai-apply",
      riskTier: tier,
      payload: { kind, ...payload },
      status: "pending",
      requestedById: actorId,
      audit: { create: { event: "proposed", userId: actorId, detail: "probe" } },
    },
  });
}

const admin = await login();
const ticket = await db.ticket.findFirst({
  select: { id: true, ticketNumber: true, title: true, companyId: true, _count: { select: { comments: true } } },
});
const contactRows = await db.contact.findMany({ take: 100, select: { id: true, firstName: true, lastName: true, companyId: true, email: true } });
const contact = contactRows.find(row => !!row.email) ?? null;
if (!ticket) {
  console.log("the development database has no ticket to work with — seed it first");
  await db.$disconnect();
  process.exit(1);
}

const createdActions = [];
const createdTicketIds = [];
const createdNoteIds = [];

// ── 1. An internal note, approved, really is added ──────────────────────────────────────────
console.log("\nA note proposal, approved, becomes a note");
const noteText = `Probe note ${Date.now()} — approved from the AI actions screen.`;
const noteAction = await propose({
  kind: "ticket_note",
  payload: { ticketId: ticket.id, note: noteText, internal: true },
  actorId: admin.userId,
});
createdActions.push(noteAction.id);

const before = await db.ticket.findUnique({ where: { id: ticket.id }, select: { _count: { select: { comments: true } } } });
check(before._count.comments === ticket._count.comments, "the ticket has the same number of notes before the approval");

const noteDecision = await decide(admin, noteAction.id, "approve");
check(noteDecision.status === 200, `approving answers 200 (got ${noteDecision.status})`);
eq(noteDecision.data?.status, "executed", "the action is recorded as executed");
check(!!noteDecision.data?.appliedAt, "and carries the moment it was applied");
check(noteDecision.data?.appliedById === admin.userId, "and the person who applied it");
eq(noteDecision.data?.errorMessage, null, "with no error recorded");

const added = await db.ticketComment.findFirst({ where: { ticketId: ticket.id, body: noteText }, select: { id: true, isInternal: true, authorId: true } });
check(!!added, "the note exists on the ticket");
createdNoteIds.push(added?.id);
check(added?.isInternal === true, "as an internal note, so no customer was emailed");
eq(noteDecision.data?.result?.noteId, added?.id, "and the action says which note it produced");
check(noteDecision.data?.before?.notes !== undefined, "the note count as it was is on the record");

const after = await db.ticket.findUnique({ where: { id: ticket.id }, select: { _count: { select: { comments: true } } } });
check(after._count.comments === before._count.comments + 1, "the ticket gained exactly one note");

// ── 2. A client-visible note is honest about what it does ───────────────────────────────────
console.log("\nA client-visible note says so, and goes down the notification path");
const visibleText = `Probe client note ${Date.now()}.`;
const visibleAction = await propose({
  kind: "ticket_note",
  payload: { ticketId: ticket.id, note: visibleText, internal: false },
  tier: "medium",
  actorId: admin.userId,
});
createdActions.push(visibleAction.id);
const visibleDecision = await decide(admin, visibleAction.id, "approve");
eq(visibleDecision.data?.status, "executed", "a medium-tier note is applied on approval too (the tier gates the click, not the authority)");
eq(visibleDecision.data?.result?.customerNotified, true, "and the record says the customer was notified");
const visible = await db.ticketComment.findFirst({ where: { ticketId: ticket.id, body: visibleText }, select: { id: true, isInternal: true } });
createdNoteIds.push(visible?.id);
eq(visible?.isInternal, false, "the note is not internal, which is what triggers the email");

// ── 3. A ticket proposal, approved, creates a real ticket ───────────────────────────────────
console.log("\nA ticket proposal, approved, creates a ticket");
const company = await db.company.findFirst({ select: { id: true, name: true } });
const ticketTitle = `Probe ticket ${Date.now()}`;
const ticketAction = await propose({
  kind: "create_ticket",
  payload: { companyId: company?.id, title: ticketTitle, description: "Raised by probe-ai-apply.", priority: "high", contactId: contact?.id },
  tier: "medium",
  actorId: admin.userId,
});
createdActions.push(ticketAction.id);
const ticketDecision = await decide(admin, ticketAction.id, "approve");
eq(ticketDecision.data?.status, "executed", "the ticket proposal is executed");
const newTicketId = ticketDecision.data?.result?.ticketId;
createdTicketIds.push(newTicketId);
check(!!newTicketId, "the action names the ticket it created");
check(!!ticketDecision.data?.result?.ticketNumber, `and its number (${ticketDecision.data?.result?.ticketNumber})`);

const newTicket = newTicketId
  ? await db.ticket.findUnique({ where: { id: newTicketId }, select: { ticketNumber: true, title: true, companyId: true, boardId: true, source: true, contactId: true, createdById: true } })
  : null;
check(!!newTicket, "the ticket exists");
eq(newTicket?.title, ticketTitle, "with the title the proposal gave it");
eq(newTicket?.companyId, company?.id, "the client it named");
check(!!newTicket?.boardId, "a board, resolved rather than refused (the proposal named none)");
eq(newTicket?.source, "assistant", "and its provenance, in the one field that carries it");
check(!!newTicket?.contactId, "the contact the sentence was about is attached");
check(!!newTicket?.ticketNumber && newTicket.ticketNumber === ticketDecision.data?.result?.ticketNumber, "the number on the ticket is the number the action reports");

// ── 4. The ways it must not work ────────────────────────────────────────────────────────────
console.log("\nThe ways it must not work");
const critical = await propose({ kind: "ticket_note", payload: { ticketId: ticket.id, note: "should never happen" }, tier: "critical", actorId: admin.userId });
createdActions.push(critical.id);
const criticalDecision = await decide(admin, critical.id, "approve");
check(criticalDecision.status >= 400, `a critical action cannot be approved (HTTP ${criticalDecision.status})`);
const criticalRow = await db.aiAction.findUnique({ where: { id: critical.id }, select: { status: true } });
eq(criticalRow?.status, "pending", "and it stays pending, not executed");

const unknownKind = await propose({ kind: "delete_everything", payload: {}, actorId: admin.userId });
createdActions.push(unknownKind.id);
const unknownDecision = await decide(admin, unknownKind.id, "approve");
eq(unknownDecision.data?.status, "failed", "a payload with no handler fails rather than pretending");
check(/cannot carry out/.test(String(unknownDecision.data?.errorMessage)), `with a sentence that says so ("${String(unknownDecision.data?.errorMessage).slice(0, 60)}…")`);

const missingTicket = await propose({ kind: "ticket_note", payload: { ticketId: "no-such-ticket", note: "nowhere" }, actorId: admin.userId });
createdActions.push(missingTicket.id);
const missingDecision = await decide(admin, missingTicket.id, "approve");
eq(missingDecision.data?.status, "failed", "a note for a ticket that does not exist fails");
check(!!missingDecision.data?.errorMessage, `with the route's own reason ("${String(missingDecision.data?.errorMessage).slice(0, 60)}…")`);

const replay = await decide(admin, noteAction.id, "approve");
check(replay.status >= 400, `approving the same action twice is refused (HTTP ${replay.status})`);

const rejectable = await propose({ kind: "ticket_note", payload: { ticketId: ticket.id, note: "rejected before it ran" }, actorId: admin.userId });
createdActions.push(rejectable.id);
const rejection = await decide(admin, rejectable.id, "reject");
eq(rejection.data?.status, "rejected", "a rejection is recorded as rejected");
const rejectedNote = await db.ticketComment.findFirst({ where: { ticketId: ticket.id, body: "rejected before it ran" } });
check(!rejectedNote, "and nothing was written");

const finalCount = await db.ticket.findUnique({ where: { id: ticket.id }, select: { _count: { select: { comments: true } } } });
check(finalCount._count.comments === before._count.comments + 2, `the ticket gained exactly the two approved notes (${before._count.comments} → ${finalCount._count.comments})`);

// ── 5. The sentence the operator actually asked for ───────────────────────────────────────
/*
 * "Create a ticket for David Chen." Not a scripted model — the *functions* a model would call, in the
 * order it would call them, against the real database and then the real approval path. This is the
 * end-to-end answer to the request, and it is the check that would have failed before today: the tools
 * existed, the approval existed, and nothing carried the approval out.
 *
 * The person is whoever is on record in this database rather than a fixture: a probe that only works
 * against one seed is a probe that stops working the first time somebody restores a snapshot.
 */
console.log('\n"Create a ticket for <a person on record>"');
const speaker = contact ?? contactRows[0];
check(!!speaker, "the database has somebody to ask about");
const spokenName = `${speaker?.firstName} ${speaker?.lastName}`.trim();
const caller = { userId: admin.userId, permissions: ["ticket:view", "ticket:edit", "ticket:create", "client:view", "contact:view"] };
const tools = Object.fromEntries(ASSISTANT_TOOLS.map(tool => [tool.name, tool]));

const people = await tools.find_people.run({ query: spokenName }, caller, db);
check(people.ok, `find_people answers a name ("${spokenName}") rather than refusing it`);
const davidId = String(people.content).split("\n").slice(1).find(line => new RegExp(`^[0-9a-f-]{36} \\| ${spokenName}`).test(line))?.split(" | ")[0] ?? "";
check(!!davidId, "and returns that person with the id a ticket needs");
check(String(people.content).includes("("), "along with their client, so an ambiguous name can be told apart");
const surnameOnly = await tools.find_people.run({ query: String(speaker?.lastName ?? "") }, caller, db);
check(/^\d+ contact/.test(surnameOnly.summary), "a surname alone also finds them, which is how people actually type it");

const proposed = await tools.propose_ticket.run(
  { contactId: davidId, title: "Outlook keeps crashing", description: "Reported from a prompt: Outlook closes when opening a shared calendar.", priority: "high" },
  caller,
  db,
);
check(proposed.ok, "propose_ticket accepts a contact with no client given");
const sentenceAction = await db.aiAction.findFirst({
  where: { id: String(proposed.content).match(/Proposal ([0-9a-f-]{36})/)?.[1] ?? "" },
  select: { id: true, payload: true, status: true },
});
check(!!sentenceAction, "the proposal exists");
check((sentenceAction?.payload as any)?.contactId === davidId, "and carries the contact through to the payload");
check(!!(sentenceAction?.payload as any)?.companyId, "with the client taken from the contact, because the prompt named nobody else");
createdActions.push(sentenceAction?.id);

const sentenceDecision = await decide(admin, sentenceAction.id, "approve");
eq(sentenceDecision.data?.status, "executed", "approving it creates the ticket");
const sentenceTicketId = sentenceDecision.data?.result?.ticketId;
createdTicketIds.push(sentenceTicketId);
const sentenceTicket = sentenceTicketId
  ? await db.ticket.findUnique({ where: { id: sentenceTicketId }, select: { ticketNumber: true, title: true, companyId: true, contactId: true, priority: true, source: true } })
  : null;
eq(sentenceTicket?.contactId, davidId, "the ticket is attached to the person the prompt named");
eq(sentenceTicket?.title, "Outlook keeps crashing", "with the title from the sentence");
eq(sentenceTicket?.priority, "high", "and the priority it was given");
check(!!sentenceTicket?.ticketNumber, `and a real ticket number (${sentenceTicket?.ticketNumber})`);

// ── Cleanup ─────────────────────────────────────────────────────────────────────────────────
for (const id of createdNoteIds.filter(Boolean)) await db.ticketComment.delete({ where: { id } }).catch(() => {});
for (const id of createdTicketIds.filter(Boolean)) await db.ticket.delete({ where: { id } }).catch(() => {});
for (const id of createdActions) await db.aiAction.delete({ where: { id } }).catch(() => {});
const leftovers = await db.aiAction.count({ where: { audit: { some: { detail: "probe" } } } });
check(leftovers === 0, "the probe left no actions behind");

console.log(`\n${pass} passed, ${fail} failed`);
await db.$disconnect();
process.exit(fail ? 1 : 0);
