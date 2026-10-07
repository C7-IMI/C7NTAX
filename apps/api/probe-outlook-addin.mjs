/**
 * The Outlook add-in's ticket path (PLAN-012).
 *
 * The add-in exists to turn a selected email into a ticket without leaving Outlook. What matters is
 * that it does not invent a second way of doing that: the same deduction pipeline, the same
 * contact/client matching, the same dedup key and the same ticket numbering as the monitored
 * mailbox — plus a per-message result, because "3 created" does not tell somebody which of their
 * five messages was already handled.
 *
 * Run from apps/api:  node probe-outlook-addin.mjs
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
const STAMP = Date.now().toString(36);

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  const readonly = await signIn("persona.readonly@c7ntax.local");
  check(admin.status === 200 && readonly.status === 200, `admin (${admin.status}) and read-only (${readonly.status}) signed in`);

  const board = await prisma.serviceBoard.findFirstOrThrow({ where: { isActive: true }, select: { id: true, name: true } });
  const client = await prisma.company.findFirstOrThrow({ where: { name: "Umbrella Corp" }, select: { id: true, name: true } });
  const domain = "umbrellacorp.net";
  const senderEmail = `addin.probe.${STAMP}@${domain}`;
  const existingContact = await prisma.contact.findFirst({ where: { email: senderEmail } });
  const existingTickets = await prisma.ticket.findMany({ where: { title: { contains: `Addin probe ${STAMP}` } }, select: { id: true } });
  await prisma.ticket.deleteMany({ where: { id: { in: existingTickets.map(t => t.id) } } });

  console.log("\nthe taskpane is served from the API's own origin, so the manifest URLs are same-origin");
  const page = await fetch(`${BASE}/addin/taskpane.html`);
  const html = await page.text();
  check(page.status === 200, `the taskpane loads (${page.status})`);
  check(/taskpane\.js/.test(html) && /id="board"/.test(html), "and carries the script and the board selector");
  const styles = await fetch(`${BASE}/addin/styles.css`);
  check(styles.status === 200, `the stylesheet loads (${styles.status})`);
  const icon = await fetch(`${BASE}/addin/assets/icon-32.png`);
  check(icon.status === 200 && (icon.headers.get("content-type") || "").includes("png"), `the manifest icon loads (${icon.status})`);

  console.log("\na selected email becomes a ticket through the same pipeline as the mailbox connector");
  const messageId = `<addin-probe-${STAMP}@probe.invalid>`;
  const created = await call("POST", "/api/outlook-addin/tickets", {
    token: admin.token,
    body: {
      boardId: board.id,
      emails: [{
        internetMessageId: messageId,
        from: `someone@${domain}`,
        fromName: "Addin Probe",
        subject: `Addin probe ${STAMP} — VPN will not connect`,
        bodyText: "Re: Addin probe\n\nHi, the VPN client will not connect since this morning.\n\nOn Mon, someone wrote:\n> original message",
        receivedAt: new Date().toISOString(),
      }],
    },
  });
  check(created.status === 201, `the request was accepted (${created.status})`);
  check(created.data?.created === 1, `one ticket was created (${created.data?.created})`);
  check(created.data?.results?.length === 1 && created.data.results[0].ticketId, "and the result names the ticket rather than only counting it");
  check(!!created.data?.results?.[0]?.ticketNumber, `with its number for the pane to link (${created.data?.results?.[0]?.ticketNumber})`);

  const ticketId = created.data.results[0].ticketId;
  const ticket = await prisma.ticket.findUnique({
    where: { id: ticketId },
    include: { company: { select: { name: true } }, contact: { select: { email: true } }, comments: true },
  });
  check(ticket?.company?.name === client.name, `the ticket landed on the client the sender's domain resolves to (${ticket?.company?.name})`);
  check(!!ticket?.contact, "a contact was matched or created for the sender");
  check(ticket?.status === "new", `it starts as new (${ticket?.status})`);
  check(/Addin probe/i.test(ticket?.title || ""), `the subject became the title (${ticket?.title})`);
  check(!/On Mon, someone wrote|^\s*>/im.test(ticket?.description || ""), `the quoted trailer was stripped (${JSON.stringify((ticket?.description || "").slice(0, 80))})`);
  check((ticket?.description || "").includes("will not connect"), "while the reported problem survived");
  check(!/^Re:/i.test(ticket?.title || ""), `and the title has no reply prefix (${ticket?.title})`);

  console.log("\nthe same message is not ticketed twice, and the pane is told which one was skipped");
  const again = await call("POST", "/api/outlook-addin/tickets", {
    token: admin.token,
    body: { boardId: board.id, emails: [{ internetMessageId: messageId, from: `someone@${domain}`, subject: `Addin probe ${STAMP} — VPN will not connect`, bodyText: "same message again" }] },
  });
  check(again.status === 201 && again.data?.created === 0, `nothing new was created (${again.data?.created})`);
  check(again.data?.results?.[0]?.reason === "already has a ticket", `the skipped message carries the reason (${again.data?.results?.[0]?.reason})`);
  check(!again.data?.results?.[0]?.ticketId, "and does not pretend to have a ticket id");

  console.log("\nseveral selected messages become several tickets, each reported separately");
  const multi = await call("POST", "/api/outlook-addin/tickets", {
    token: admin.token,
    body: {
      boardId: board.id,
      emails: [
        { internetMessageId: `<addin-a-${STAMP}@probe.invalid>`, from: `one@${domain}`, subject: `Addin probe ${STAMP} A — printer offline`, bodyText: "printer is offline" },
        { internetMessageId: `<addin-b-${STAMP}@probe.invalid>`, from: `two@${domain}`, subject: `Addin probe ${STAMP} B — mailbox full`, bodyText: "mailbox is full" },
        { internetMessageId: messageId, from: `someone@${domain}`, subject: `Addin probe ${STAMP} — VPN will not connect`, bodyText: "duplicate" },
      ],
    },
  });
  check(multi.data?.created === 2, `two of the three became tickets (${multi.data?.created})`);
  check(multi.data?.results?.length === 3, "and every message got its own result line");
  check(multi.data.results.filter(r => r.ticketId).length === 2, "two lines carry ticket ids");
  check(multi.data.results.some(r => r.reason === "already has a ticket"), "and the duplicate is called out");

  console.log("\nvalidation and permissions");
  const noBoard = await call("POST", "/api/outlook-addin/tickets", { token: admin.token, body: { emails: [{ subject: "x" }] } });
  check(noBoard.status === 400, `a request with no board is refused (${noBoard.status})`);
  const noEmails = await call("POST", "/api/outlook-addin/tickets", { token: admin.token, body: { boardId: board.id, emails: [] } });
  check(noEmails.status === 400, `and one with no messages is refused (${noEmails.status})`);
  const denied = await call("POST", "/api/outlook-addin/tickets", { token: readonly.token, body: { boardId: board.id, emails: [{ subject: `Addin probe ${STAMP} denied`, bodyText: "should not be created" }] } });
  check(denied.status === 403, `an account without ticket:create is refused (${denied.status})`);
  const anon = await call("POST", "/api/outlook-addin/tickets", { body: { boardId: board.id, emails: [] } });
  check(anon.status === 401, `an unauthenticated call is refused (${anon.status})`);

  console.log("\nthe boards the pane lists are the boards that exist");
  const boards = await call("GET", "/api/boards", { token: admin.token });
  check(boards.status === 200 && Array.isArray(boards.data) && boards.data.length > 0, `the board list answers (${boards.status}, ${boards.data?.length})`);
  check(boards.data.every(b => b.id && b.name), "and each entry carries what the selector needs");

  // Clean up: probe tickets (and their comments), the probe contact, the dedup cursor entry.
  const probeTickets = await prisma.ticket.findMany({ where: { title: { contains: `Addin probe ${STAMP}` } }, select: { id: true } });
  const probeTicketIds = probeTickets.map(t => t.id);
  await prisma.ticketComment.deleteMany({ where: { ticketId: { in: probeTicketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: probeTicketIds } } });
  await prisma.contact.deleteMany({ where: { email: senderEmail } });
  const seenRow = await prisma.systemConfig.findUnique({ where: { key: "outlook-addin-seen" } });
  if (seenRow) {
    const current = (seenRow.value && seenRow.value.seen) ? seenRow.value.seen : [];
    const seen = current.filter(id => !String(id).includes("addin-"));
    await prisma.systemConfig.update({ where: { key: "outlook-addin-seen" }, data: { value: { seen } } });
  }
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.readonly@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.ticket.count({ where: { id: { in: probeTicketIds } } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} tickets left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
