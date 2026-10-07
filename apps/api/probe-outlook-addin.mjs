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
const { rm } = await import("node:fs/promises");
const path = await import("node:path");
const prisma = new PrismaClient();
const STAMP = Date.now().toString(36);

async function main() {
  const admin = await signIn("persona.admin@c7ntax.local");
  const readonly = await signIn("persona.readonly@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  check(
    admin.status === 200 && readonly.status === 200 && tech.status === 200,
    `admin (${admin.status}), read-only (${readonly.status}) and technician (${tech.status}) signed in`,
  );

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
  // The pane renders every screen — including the board selector — from taskpane.js into #body, so
  // the markup carries the mount points and the script carries the controls.
  const script = await fetch(`${BASE}/addin/taskpane.js`);
  const js = await script.text();
  check(
    script.status === 200 && /taskpane\.js/.test(html) && /id="body"/.test(html) && /"panel"/.test(html),
    "and carries the script and the container it renders into",
  );
  check(
    /id="board"/.test(js) && /outlook-addin\/options/.test(js),
    "and the pane asks for the boards it offers",
  );
  check(
    /outlook-addin\/preview/.test(js) && /outlook-addin\/preferences/.test(js),
    "and carries the review and the saved preferences the flow depends on",
  );
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

  console.log("\nthe review shows what would be filed, without filing anything");
  const reviewed = {
    internetMessageId: `<addin-review-${STAMP}@probe.invalid>`,
    from: `reviewer@${domain}`,
    subject: `Addin probe ${STAMP} — laptop will not boot`,
    bodyText: "The laptop will not boot past the vendor logo.",
  };
  const preview = await call("POST", "/api/outlook-addin/preview", { token: admin.token, body: { emails: [reviewed] } });
  const shown = preview.data?.messages?.[0];
  check(preview.status === 200 && preview.data?.messages?.length === 1, `the preview answers (${preview.status})`);
  check(shown?.alreadyHasTicket === false, "and says this message has no ticket yet");
  check(shown?.matchedCompany?.name === "Umbrella Corp", `and names the client the sender resolves to (${shown?.matchedCompany?.name})`);
  check(!!shown?.contactName, `and the contact it will use (${shown?.contactName})`);
  const previewCreated = await prisma.ticket.count({
    where: { title: { contains: `Addin probe ${STAMP} — laptop will not boot` } },
  });
  check(previewCreated === 0, `and created nothing while doing it (${previewCreated} tickets)`);

  console.log("\nthe pane is offered the boards it lists, and is refused what it cannot have");
  const options = await call("GET", "/api/outlook-addin/options", { token: admin.token });
  check(options.status === 200 && options.data?.boards?.length > 0, `the options answer (${options.status}, ${options.data?.boards?.length})`);
  check(options.data.boards.every(b => b.id && b.name), "with the board list its selector needs");
  check(Array.isArray(options.data.clients), `and a client list (${options.data.clients?.length})`);
  const optionsDenied = await call("GET", "/api/outlook-addin/options", { token: readonly.token });
  check(optionsDenied.status === 403, `an account that cannot create tickets is refused (${optionsDenied.status})`);

  console.log("\na client-scoped account can only file for its own client");
  const scopedUser = await signIn("persona.clientadmin@c7ntax.local");
  const scopedOptions = await call("GET", "/api/outlook-addin/options", { token: scopedUser.token });
  const ownClients = scopedOptions.data?.clients || [];
  check(scopedOptions.status === 200, `a client-scoped account can open the pane (${scopedOptions.status})`);
  check(ownClients.length === 1, `and is offered exactly its own client (${ownClients.length})`);
  const foreignCompany = (options.data.clients || []).find(c => !ownClients.some(own => own.id === c.id));
  if (foreignCompany) {
    const hijack = await call("POST", "/api/outlook-addin/tickets", {
      token: scopedUser.token,
      body: {
        boardId: board.id,
        emails: [{
          internetMessageId: `<addin-scope-${STAMP}@probe.invalid>`,
          from: `someone@${domain}`,
          subject: `Addin probe ${STAMP} — scoped escalation`,
          bodyText: "This must not be filed against another client.",
          companyId: foreignCompany.id,
        }],
      },
    });
    check(hijack.status === 403, `filing for another client is refused (${hijack.status})`);
    const leaked = await prisma.ticket.count({ where: { title: { contains: `Addin probe ${STAMP} — scoped escalation` } } });
    check(leaked === 0, `and nothing was created (${leaked} tickets)`);
  }

  console.log("\nwhat the user reviewed is what gets filed");
  const filed = await call("POST", "/api/outlook-addin/tickets", {
    token: admin.token,
    body: {
      boardId: board.id,
      emails: [{
        ...reviewed,
        priority: "High",
        companyId: client.id,
        contactName: "Reviewed Contact",
      }],
    },
  });
  const filedId = filed.data?.results?.[0]?.ticketId;
  const filedTicket = filedId
    ? await prisma.ticket.findUnique({ where: { id: filedId }, select: { priority: true, companyId: true, contactId: true, title: true } })
    : null;
  check(!!filedId, "the reviewed message became a ticket");
  check(filedTicket?.priority === "High", `and kept the reviewed priority (${filedTicket?.priority})`);
  check(filedTicket?.companyId === client.id, "and the client the user picked instead of the one the domain implied");
  // A picked client used to skip contact creation entirely, so the name the user confirmed was
  // dropped and the ticket was filed against no contact at all.
  check(!!filedTicket?.contactId, "and still filed it against a contact");
  const renamedContact = filedTicket?.contactId
    ? await prisma.contact.findUnique({
        where: { id: filedTicket.contactId },
        select: { firstName: true, lastName: true, companyId: true },
      })
    : null;
  check(
    `${renamedContact?.firstName ?? ""} ${renamedContact?.lastName ?? ""}`.trim() === "Reviewed Contact",
    `and renamed the contact it is filed against (${renamedContact?.firstName} ${renamedContact?.lastName})`,
  );
  check(renamedContact?.companyId === client.id, "and moved it to the client the user picked");

  console.log("\nbundled: one ticket, and the other messages ride along as attachments");
  const parentMessageId = `<addin-parent-${STAMP}@probe.invalid>`;
  const bundled = await call("POST", "/api/outlook-addin/tickets", {
    token: admin.token,
    body: {
      boardId: board.id,
      mode: "bundled",
      parentMessageId,
      emails: [
        { internetMessageId: parentMessageId, from: `parent@${domain}`, subject: `Addin probe ${STAMP} — parent message`, bodyText: "This one becomes the ticket." },
        { internetMessageId: `<addin-child-a-${STAMP}@probe.invalid>`, from: `child.a@${domain}`, subject: `Addin probe ${STAMP} — context one`, bodyText: "Context one." },
        { internetMessageId: `<addin-child-b-${STAMP}@probe.invalid>`, from: `child.b@${domain}`, subject: `Addin probe ${STAMP} — context two`, bodyText: "Context two." },
      ],
    },
  });
  check(bundled.data?.created === 1, `exactly one ticket was created (${bundled.data?.created})`);
  check(bundled.data?.bundled === true, "and it is reported as bundled rather than as separate tickets");
  check(bundled.data?.attachments?.length === 2, `the other two messages were attached (${bundled.data?.attachments?.length})`);
  check(
    (bundled.data?.attachments || []).every(a => /\.eml$/.test(a.filename)),
    "each as an .eml original rather than a re-rendered summary",
  );
  const bundledId = bundled.data?.results?.find(r => r.ticketId)?.ticketId;
  const bundledTicket = bundledId
    ? await prisma.ticket.findUnique({ where: { id: bundledId }, select: { title: true } })
    : null;
  check(/parent message/.test(bundledTicket?.title || ""), `and it is the parent message that became the ticket (${bundledTicket?.title})`);
  const rows = bundledId ? await prisma.ticketAttachment.count({ where: { ticketId: bundledId } }) : -1;
  check(rows === 2, `and the ticket carries them (${rows} attachment rows)`);
  check(bundled.data?.results?.filter(r => r.attached).length === 2, "with a result line for each attached message");

  console.log("\nsaved preferences belong to the person, not to the machine");
  const initial = await call("GET", "/api/outlook-addin/preferences", { token: admin.token });
  check(initial.status === 200 && initial.data?.mode === "ask" && initial.data?.preview === "ask", `they start by asking (${initial.data?.mode}/${initial.data?.preview})`);
  const save = await call("PATCH", "/api/outlook-addin/preferences", {
    token: admin.token,
    body: { mode: "individual", preview: "never", rememberBoard: false, lastBoardId: board.id },
  });
  check(save.status === 200 && save.data?.mode === "individual", `a saved answer is accepted (${save.status})`);
  const reread = await call("GET", "/api/outlook-addin/preferences", { token: admin.token });
  check(
    reread.data?.mode === "individual" && reread.data?.preview === "never" && reread.data?.rememberBoard === false && reread.data?.lastBoardId === board.id,
    "and comes back unchanged, so the one-click path survives a reload",
  );
  const otherUser = await call("GET", "/api/outlook-addin/preferences", { token: tech.token });
  check(
    otherUser.data?.mode === "ask" && otherUser.data?.preview === "ask",
    `while another account on the same machine still asks (${otherUser.data?.mode}/${otherUser.data?.preview})`,
  );
  const nonsense = await call("PATCH", "/api/outlook-addin/preferences", { token: tech.token, body: { mode: "banana", preview: "sometimes" } });
  check(nonsense.data?.mode === "ask" && nonsense.data?.preview === "ask", "and an unrecognised answer is normalised rather than stored");
  await call("PATCH", "/api/outlook-addin/preferences", { token: admin.token, body: { mode: "ask", preview: "ask", rememberBoard: true, lastBoardId: null } });

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

  // Clean up: probe tickets (with the files their attachments wrote), the probe contacts, the dedup
  // cursor entry. The attachment *rows* cascade away with the ticket; the files do not, so a probe
  // that bundled messages would otherwise leave them in apps/api/data/ticket-attachments.
  const probeTickets = await prisma.ticket.findMany({ where: { title: { contains: `Addin probe ${STAMP}` } }, select: { id: true } });
  const probeTicketIds = probeTickets.map(t => t.id);
  const attachmentDir = path.join(process.cwd(), "data", "ticket-attachments");
  for (const id of probeTicketIds) await rm(path.join(attachmentDir, id), { recursive: true, force: true });
  await prisma.ticketAttachment.deleteMany({ where: { ticketId: { in: probeTicketIds } } });
  await prisma.ticketComment.deleteMany({ where: { ticketId: { in: probeTicketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: probeTicketIds } } });
  await prisma.contact.deleteMany({ where: { email: { in: [senderEmail, `reviewer@${domain}`] } } });
  const seenRow = await prisma.systemConfig.findUnique({ where: { key: "outlook-addin-seen" } });
  if (seenRow) {
    const current = (seenRow.value && seenRow.value.seen) ? seenRow.value.seen : [];
    const seen = current.filter(id => !String(id).includes("addin-"));
    await prisma.systemConfig.update({ where: { key: "outlook-addin-seen" }, data: { value: { seen } } });
  }
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.readonly@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.ticket.count({ where: { id: { in: probeTicketIds } } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} tickets left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
