/**
 * KB articles drafted from resolved tickets (PLAN-015 Phase B #11).
 *
 * An AI-authored article in a knowledge base is a claim on the reader's time, so the interesting
 * assertions are not "did it call a model" but "can it publish by itself", "does it say where it
 * came from", "can it be told nothing to work with", and "does a broken model block a ticket being
 * resolved".
 *
 * Run the API with EGRESS_ALLOW_PRIVATE=true, KB_AUTOGEN_ENABLED=true and an AI provider pointing
 * at the stub this probe starts:
 *   PROBE_AI_PORT=<port>   (default 4124)
 * then from apps/api:  node probe-kb-autogen.mjs
 */
import { createServer } from "node:http";

const BASE = "http://127.0.0.1:4000";
const AI_PORT = Number(process.env.PROBE_AI_PORT || 4124);
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

/**
 * Everything this probe writes, removed by the stamp it wrote it under.
 *
 * Name-based and idempotent on purpose: it is called from the normal end, from the early exit below (which
 * stops with the API's own explanation when the stub model cannot be reached) and from a `catch`, and a
 * 500 or a thrown fetch on the way must not be the difference between a clean run and a client left in the
 * list. The tidy-up used to be the last four lines of the happy path, which is how "Probe KB client …"
 * rows survived four failed runs.
 */
async function sweepProbe() {
  const ticketIds = (await prisma.ticket.findMany({ where: { ticketNumber: { startsWith: `KB-${STAMP}-` } }, select: { id: true } })).map(t => t.id);
  const articleIds = (await prisma.knowledgeBaseArticle.findMany({
    where: { OR: [{ sourceTicketId: { in: ticketIds } }, { title: { startsWith: "Outlook cannot connect" } }] },
    select: { id: true },
  })).map(a => a.id);
  await prisma.kBArticleVersion.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.kBArticleTicket.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.knowledgeBaseArticle.deleteMany({ where: { id: { in: articleIds } } });
  await prisma.ticketComment.deleteMany({ where: { ticketId: { in: ticketIds } } });
  await prisma.ticket.deleteMany({ where: { id: { in: ticketIds } } });
  const clients = await prisma.company.deleteMany({ where: { name: `Probe KB client ${STAMP}` } });
  const providers = await prisma.aiProviderConfig.deleteMany({ where: { name: `Probe KB provider ${STAMP}` } });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: ["persona.admin@c7ntax.local", "persona.tech@c7ntax.local"] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  return { tickets: ticketIds.length, articles: articleIds.length, clients: clients.count, providers: providers.count };
}

/** A stand-in for the configured model endpoint, answering whatever the phase asks for. */
function startStub() {
  const prompts = [];
  let mode = "ok";
  const server = createServer((req, res) => {
    let body = "";
    req.on("data", c => { body += c; });
    req.on("end", () => {
      let prompt = "";
      try { prompt = JSON.parse(body)?.messages?.[0]?.content ?? ""; } catch { /* not our format */ }
      prompts.push(prompt);
      const reply = (status, payload) => { res.writeHead(status, { "content-type": "application/json" }); res.end(JSON.stringify(payload)); };
      if (mode === "unauthorised") return reply(401, { error: { message: "bad key" } });
      if (mode === "refusal") return reply(200, { choices: [{ message: { content: "I cannot help with that." } }] });
      const article = {
        title: "Outlook cannot connect after a mailbox migration",
        summary: "The Outlook profile still points at the old autodiscover record, so the client never finds the new mailbox.",
        symptoms: ["Outlook keeps asking for a password", "No mail arrives but webmail works"],
        steps: ["Close Outlook", "Delete the stale mail profile", "Recreate the profile and let autodiscover run"],
        tags: ["outlook", "autodiscover", "mailbox-migration"],
      };
      return reply(200, { choices: [{ message: { content: JSON.stringify(article) } }], usage: { total_tokens: 412 } });
    });
  });
  return new Promise(resolve => server.listen(AI_PORT, "127.0.0.1", () => resolve({
    server,
    prompts,
    setMode: next => { mode = next; },
  })));
}

const STAMP = Date.now().toString(36);

async function main() {
  const stub = await startStub();
  const admin = await signIn("persona.admin@c7ntax.local");
  const tech = await signIn("persona.tech@c7ntax.local");
  check(admin.status === 200 && tech.status === 200, `admin (${admin.status}) and technician (${tech.status}) signed in`);

  // The provider this probe's stub stands in for.
  await prisma.aiProviderConfig.deleteMany({ where: { name: { startsWith: "Probe KB provider" } } });
  const provider = await prisma.aiProviderConfig.create({
    data: {
      name: `Probe KB provider ${STAMP}`,
      provider: "custom",
      apiEndpoint: `http://127.0.0.1:${AI_PORT}/v1/chat/completions`,
      apiKey: "probe-key",
      model: "probe-model",
      maxTokens: 800,
      temperature: 0.2,
      isActive: true,
      isDefault: true,
    },
  });

  const client = await prisma.company.create({ data: { name: `Probe KB client ${STAMP}` } });
  const makeTicket = async (suffix, description) => prisma.ticket.create({
    data: {
      ticketNumber: `KB-${STAMP}-${suffix}`,
      title: `Probe KB ticket ${suffix} ${STAMP}`,
      description,
      status: "in_progress",
      priority: "medium",
      companyId: client.id,
      boardId: (await prisma.serviceBoard.findFirstOrThrow({ select: { id: true } })).id,
      createdById: (await prisma.user.findFirstOrThrow({ where: { email: "persona.admin@c7ntax.local" }, select: { id: true } })).id,
    },
  });

  const ticket = await makeTicket("a", "Outlook will not connect after we moved the mailbox; webmail works fine.");
  await prisma.ticketComment.create({ data: { ticketId: ticket.id, body: "Deleted the stale mail profile and let autodiscover rebuild it. Outlook connected immediately.", authorId: ticket.createdById, isInternal: true } });

  console.log("\na resolved ticket drafts an article, as a draft");
  const drafted = await call("POST", `/api/kb/autogen/${ticket.id}`, { token: admin.token });
  check(drafted.status === 201, `a draft was produced (${drafted.status})`);
  const articleId = drafted.data?.article?.id;
  if (!articleId) {
    // Without its preconditions — a loopback AI provider and `EGRESS_ALLOW_PRIVATE=true` — the model
    // call is refused by the egress policy and no article exists. Say that, rather than falling
    // through to a Prisma `where` with an undefined id, which buries the reason under a stack trace.
    check(false, `no article was drafted — is the API running with EGRESS_ALLOW_PRIVATE=true, KB_AUTOGEN_ENABLED=true and the stub provider on ${AI_PORT}? (${drafted.status})`);
    await sweepProbe();
    await prisma.$disconnect();
    console.log(`\n${pass} passed, ${fail} failed`);
    process.exit(1);
  }
  check(drafted.data?.article?.aiGenerated === true, "and it is marked as AI-generated");
  check(drafted.data?.article?.status === "draft", `and it is only a draft, never published (${drafted.data?.article?.status})`);
  check(drafted.data?.tokensUsed === 412, `the model usage is reported back (${drafted.data?.tokensUsed})`);

  const row = await prisma.knowledgeBaseArticle.findUnique({ where: { id: articleId }, select: { title: true, content: true, sourceTicketId: true, reviewNote: true, status: true, tags: true, excerpt: true } });
  check(row?.title === "Outlook cannot connect after a mailbox migration", `the article uses the model's title (${row?.title})`);
  check(row?.sourceTicketId === ticket.id, "the ticket it came from is attached");
  check(/ticket .*on \d{4}-\d{2}-\d{2}/i.test(row?.content || ""), "the body says it was drafted and when");
  check(/needs a human review/i.test(row?.content || ""), "and that it needs a human review");
  check(!!row?.reviewNote && /check the cause/i.test(row.reviewNote), `the review note tells the reviewer what to check (${row?.reviewNote})`);
  check(JSON.stringify(row?.tags) === JSON.stringify(["outlook", "autodiscover", "mailbox-migration"]), `tags are carried through (${JSON.stringify(row?.tags)})`);
  check(!!row?.excerpt, "an excerpt is stored for the list view");
  check((row?.content || "").includes("## Resolution") && (row?.content || "").includes("## Symptoms"), "the body is structured, not a wall of prose");

  console.log("\nthe prompt is built from the ticket, capped");
  check(stub.prompts.length === 1, `the model was asked once (${stub.prompts.length})`);
  const prompt = stub.prompts[0] || "";
  check(prompt.includes(ticket.ticketNumber), "the prompt names the ticket");
  check(prompt.includes("autodiscover"), "and carries what the technician recorded");
  check(prompt.includes(`Probe KB client ${STAMP}`), "and which client it was for");
  check(/Respond with JSON only/.test(prompt), "and asks for JSON, so the answer can be parsed rather than guessed at");

  console.log("\nthe same ticket cannot draft the same article twice");
  const again = await call("POST", `/api/kb/autogen/${ticket.id}`, { token: admin.token });
  check(again.status === 409, `a second request is refused (${again.status})`);
  check(/already been drafted/i.test(again.data?.error?.message || again.data?.error || ""), `and says why (${again.data?.error?.message || again.data?.error})`);
  check(stub.prompts.length === 1, "without asking the model again");

  console.log("\na ticket with nothing on it is refused rather than invented");
  const thin = await makeTicket("b", "");
  const thinDraft = await call("POST", `/api/kb/autogen/${thin.id}`, { token: admin.token });
  check(thinDraft.status === 409, `no article is produced (${thinDraft.status})`);
  check(/too little recorded/i.test(thinDraft.data?.error?.message || ""), `and the reason is honest (${thinDraft.data?.error?.message})`);
  check(await prisma.knowledgeBaseArticle.count({ where: { sourceTicketId: thin.id } }) === 0, "and nothing is written");

  console.log("\na model that answers with prose is refused, not filed");
  const other = await makeTicket("c", "Printer queue keeps pausing after the driver update.");
  stub.setMode("refusal");
  const refusal = await call("POST", `/api/kb/autogen/${other.id}`, { token: admin.token });
  check(refusal.status === 409, `an unusable answer produces no article (${refusal.status})`);
  check(await prisma.knowledgeBaseArticle.count({ where: { sourceTicketId: other.id } }) === 0, "and nothing is written for it either");

  console.log("\nresolving a ticket drafts in the background, and never blocks the resolution");
  stub.setMode("ok");
  const resolved = await call("PATCH", `/api/tickets/${other.id}`, { token: admin.token, body: { status: "resolved" } });
  check(resolved.status === 200 && resolved.data?.status === "resolved", `the ticket resolved (${resolved.status})`);
  await new Promise(r => setTimeout(r, 2500));
  const background = await prisma.knowledgeBaseArticle.findFirst({ where: { sourceTicketId: other.id } });
  check(!!background, "an article was drafted from the resolution without being asked for");
  check(background?.aiGenerated === true && background?.status === "draft", `it is an AI draft, not a publication (${background?.status})`);

  console.log("\nresolving still works when the model is unreachable");
  const unreachable = await makeTicket("d", "VPN client fails to authenticate after the certificate renewal.");
  stub.server.close();
  const stillResolved = await call("PATCH", `/api/tickets/${unreachable.id}`, { token: admin.token, body: { status: "resolved" } });
  check(stillResolved.status === 200 && stillResolved.data?.status === "resolved", `the ticket resolved with no model behind it (${stillResolved.status})`);

  console.log("\nthe review queue is readable, and only drafts can be discarded");
  const drafts = await call("GET", "/api/kb/drafts", { token: admin.token });
  check(drafts.status === 200, `the drafts queue answers (${drafts.status})`);
  check((drafts.data?.data || []).some(d => d.id === articleId && d.aiGenerated), "the drafted article is in it, marked as AI");
  check(drafts.data?.autogenEnabled === true, "and the queue reports that auto-drafting is on");

  const published = await call("PATCH", `/api/kb/${articleId}`, { token: admin.token, body: { status: "published" } });
  check(published.status === 200 && published.data?.status === "published", `a human published the draft (${published.status})`);
  const discardPublished = await call("DELETE", `/api/kb/${articleId}`, { token: admin.token });
  check(discardPublished.status === 409, `a published article cannot be discarded by the draft button (${discardPublished.status})`);
  check(/archive/i.test(discardPublished.data?.error?.message || ""), `and it says what to do instead (${discardPublished.data?.error?.message})`);
  const stillThere = await prisma.knowledgeBaseArticle.findUnique({ where: { id: articleId }, select: { status: true } });
  check(stillThere?.status === "published", "the published article survived the attempt");

  if (background) {
    const discardDraft = await call("DELETE", `/api/kb/${background.id}`, { token: admin.token });
    check(discardDraft.status === 200, `an AI draft that a reviewer rejects is discarded (${discardDraft.status})`);
    check(await prisma.knowledgeBaseArticle.count({ where: { id: background.id } }) === 0, "and is gone");
  }

  console.log("\npermissions");
  const techDraft = await call("POST", `/api/kb/autogen/${thin.id}`, { token: tech.token });
  check([403, 409].includes(techDraft.status), `a technician without KB create permission is refused (${techDraft.status})`);
  const anon = await call("GET", "/api/kb/drafts");
  check(anon.status === 401, `an unauthenticated read of the queue is refused (${anon.status})`);

  // Clean up on the way out — the same sweep every exit path calls. The check is on what remains, not on
  // what the sweep was handed: a sweep that found nothing to delete would otherwise look like a pass.
  const removed = await sweepProbe();
  const leftBehind =
    await prisma.knowledgeBaseArticle.count({ where: { title: { startsWith: "Outlook cannot connect" } } })
    + await prisma.company.count({ where: { name: `Probe KB client ${STAMP}` } })
    + await prisma.ticket.count({ where: { ticketNumber: { startsWith: `KB-${STAMP}-` } } });
  check(leftBehind === 0, `the probe cleaned up after itself (removed ${JSON.stringify(removed)}, ${leftBehind} left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

/**
 * A failure inside `main` — a 500, a refused connection, a bad assumption — used to leave the probe's
 * client and tickets in place, because the tidy-up was the last thing the happy path did. Sweeping here
 * as well means the only way to leave residue is to kill the process, which `clean-probe-residue.ts` is
 * for.
 */
main().catch(async (e) => {
  console.error("probe failed:", e.message);
  const removed = await sweepProbe().catch(() => null);
  console.error(`cleaned up after the failure: ${JSON.stringify(removed)}`);
  process.exit(1);
});
