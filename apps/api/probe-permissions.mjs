/**
 * Persona permission sweep.
 *
 * Signs in as every verification persona and calls a representative endpoint per
 * module, printing a status matrix. Run it before and after a permission change and
 * diff the two: the only acceptable differences are ones that were intended.
 *
 *   node probe-permissions.mjs                 # both read and write probes
 *   PROBE_MODE=read node probe-permissions.mjs # reads only (safe baseline)
 *   PROBE_BASE=http://127.0.0.1:4000 node probe-permissions.mjs
 *
 * The write sweep really writes, so it is also the probe that leaves the most behind: nine categories ×
 * six personas of rows carrying real names in real lists. Everything it creates it now removes again, on
 * every path — see `sweepCreated` at the foot of the file. It used to be nobody's job, and the client list
 * carried sixteen "Persona probe client …" rows as the evidence.
 */
const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const MODE = process.env.PROBE_MODE || "all";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

/**
 * One stamp for the whole run, carried in every name this probe writes.
 *
 * A name is how a row is found again: the sweep cannot hold the ids of rows created by *other* people's
 * HTTP calls, so each name is `Persona probe <thing> <stamp>-<persona>`. The stamp keeps the sweep to this
 * run's rows, and the persona keeps every name distinct — six personas write six rows of each kind.
 */
const RUN = Date.now();

const PERSONAS = [
  ["superadmin", "super_admin"],
  ["admin", "admin"],
  ["tech", "technician"],
  ["readonly", "read_only"],
  ["clientadmin", "client_admin(scoped)"],
  ["tech.scoped", "technician(scoped)"],
];

const READS = [
  ["auth", "GET", "/auth/me"],
  ["tickets", "GET", "/tickets?limit=1"],
  ["clients", "GET", "/clients?limit=1"],
  ["clients", "GET", "/clients/contacts?limit=1"],
  ["boards", "GET", "/boards"],
  ["users", "GET", "/users?limit=1"],
  ["users", "GET", "/roles"],
  ["kb", "GET", "/kb?limit=1"],
  ["kb", "GET", "/kb/categories"],
  ["chat", "GET", "/chat/sessions"],
  ["surveys", "GET", "/surveys"],
  ["workflows", "GET", "/workflows/rules"],
  ["alerts", "GET", "/alerts"],
  ["alerts", "GET", "/alerts/rules"],
  ["aiActions", "GET", "/ai-actions"],
  ["inference", "GET", "/inference/providers"],
  ["reports", "GET", "/reports"],
  ["reports", "GET", "/reports/data/ticket-volume"],
  ["reports", "GET", "/reports/data/revenue-summary"],
  ["sso", "GET", "/sso/configs"],
  ["kumo", "GET", "/kumo/assets?limit=1"],
  ["billing", "GET", "/billing/invoices?limit=1"],
  ["serviceAlerts", "GET", "/service-alerts"],
  ["crm", "GET", "/crm/opportunities?limit=1"],
  ["projects", "GET", "/projects?limit=1"],
  ["procurement", "GET", "/procurement?limit=1"],
  ["schedule", "GET", "/schedule/events?limit=1"],
  ["contracts", "GET", "/contracts?limit=1"],
  ["quotes", "GET", "/quotes"],
  ["checklists", "GET", "/checklists"],
  ["webhooks", "GET", "/alert-webhooks"],
  ["system", "GET", "/system/audit-logs?limit=1"],
  ["system", "GET", "/system/configs"],
  ["system", "GET", "/system/changelog"],
  ["system", "GET", "/system/config/app_settings"],
  ["system", "GET", "/system/locales"],
  ["system", "GET", "/system/currencies"],
  ["system", "GET", "/system/field-permissions"],
  ["system", "GET", "/system/retention-policies"],
  ["system", "GET", "/system/failover/status"],
];

const WRITES = [
  ["kb:article", "POST", "/kb", (who) => ({ title: `Persona probe article ${RUN}-${who}`, content: "probe", status: "draft", visibility: "internal", tags: [] })],
  ["kb:category", "POST", "/kb/categories", (who) => ({ name: `Persona probe category ${RUN}-${who}` })],
  ["workflow:rule", "POST", "/workflows/rules", (who) => ({ name: `Persona probe rule ${RUN}-${who}`, entity: "ticket", trigger: "ticket.created", actions: [] })],
  ["survey", "POST", "/surveys", (who) => ({ name: `Persona probe survey ${RUN}-${who}` })],
  ["chat:session", "POST", "/chat/sessions", (who) => ({ title: `Persona probe chat ${RUN}-${who}` })],
  ["report", "POST", "/reports", (who) => ({ name: `Persona probe report ${RUN}-${who}`, type: "ticket", config: {} })],
  ["client", "POST", "/clients", (who) => ({ name: `Persona probe client ${RUN}-${who}` })],
  // The locale code keeps its own timestamp: a code is validated as a short tag, so the stamp would make
  // it a different *shape* of value and the sweep would be measuring its own record rather than the route.
  ["system:locale", "POST", "/system/locales", () => ({ code: `zz${String(Date.now()).slice(-6)}`, name: "Persona Probe" })],
  ["inference:provider", "POST", "/inference/providers", (who) => ({ name: `Persona probe provider ${RUN}-${who}`, provider: "local", model: "gpt-4o-mini" })],
];

const call = async (method, path, token, body) => {
  const res = await fetch(BASE + "/api" + path, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try { data = await res.json(); } catch { /* empty body is fine */ }
  return { status: res.status, data };
};

const signIn = async (who) => {
  const r = await call("POST", "/auth/login", null, { email: `persona.${who}@c7ntax.local`, password: PW });
  if (!r.data?.token) throw new Error(`sign-in failed for ${who}: ${r.status} ${JSON.stringify(r.data).slice(0, 90)}`);
  return r.data.token;
};

const fmt = (n) => String(n).padEnd(3);

const run = async () => {
  const tokens = {};
  for (const [who] of PERSONAS) tokens[who] = await signIn(who);
  const header = ["endpoint".padEnd(34), ...PERSONAS.map(([who, label]) => label.padEnd(22))].join(" ");
  const rows = [];
  const probe = async (kind, module, method, path, bodyFn) => {
    const cells = [];
    for (const [who] of PERSONAS) {
      const r = await call(method, path, tokens[who], bodyFn ? bodyFn(who) : undefined);
      cells.push(fmt(r.status));
      if (r.status >= 500) rows.push(`  !! ${r.status} ${method} ${path} as ${who}`);
    }
    console.log([`${kind}:${module}`.padEnd(34), ...cells.map(c => c.padEnd(22))].join(" "));
  };
  console.log("== reads (status per persona) ==");
  console.log(header);
  for (const [module, method, path] of READS) await probe("read", module, method, path);
  if (MODE === "all") {
    console.log("\n== writes (status per persona; 5xx/2xx both matter) ==");
    console.log(header);
    for (const [module, method, path, bodyFn] of WRITES) await probe("write", module, method, path, bodyFn);
  }
  if (rows.length) console.log("\nSERVER ERRORS:\n" + rows.join("\n"));
};

/**
 * Removes everything this run wrote, by name — the one implementation, run from every exit path.
 *
 * Ids are no use here: the rows were created by the API on behalf of six personas, so `sweepCreated` reads
 * back what carries this run's stamp instead of remembering what it asked for. Name-based removal is also
 * what makes the sweep safe to call twice, which is what lets a `finally` (a normal finish), a `catch` (a
 * 500, a thrown fetch) and an interrupted run all share it.
 *
 * The chat sessions are the exception to the naming rule, because `ChatSession` has no title to match on:
 * they are the sessions the personas opened during this run, found by the persona accounts and the window.
 */
async function sweepCreated() {
  const tag = `${RUN}`;
  const articles = await prisma.knowledgeBaseArticle.findMany({ where: { title: { startsWith: `Persona probe article ${tag}` } }, select: { id: true } });
  const articleIds = articles.map(a => a.id);
  await prisma.kBArticleVersion.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.kBArticleAttachment.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.kBArticleTicket.deleteMany({ where: { articleId: { in: articleIds } } });
  await prisma.knowledgeBaseArticle.deleteMany({ where: { id: { in: articleIds } } });

  const removed = {
    articles: articleIds.length,
    categories: (await prisma.kBCategory.deleteMany({ where: { name: { startsWith: `Persona probe category ${tag}` } } })).count,
    rules: (await prisma.workflowRule.deleteMany({ where: { name: { startsWith: `Persona probe rule ${tag}` } } })).count,
    surveys: (await prisma.survey.deleteMany({ where: { name: { startsWith: `Persona probe survey ${tag}` } } })).count,
    reports: (await prisma.report.deleteMany({ where: { name: { startsWith: `Persona probe report ${tag}` } } })).count,
    clients: (await prisma.company.deleteMany({ where: { name: { startsWith: `Persona probe client ${tag}` } } })).count,
    locales: (await prisma.locale.deleteMany({ where: { name: "Persona Probe", code: { startsWith: "zz" } } })).count,
    providers: (await prisma.aiProviderConfig.deleteMany({ where: { name: { startsWith: `Persona probe provider ${tag}` } } })).count,
  };

  const personaIds = (await prisma.user.findMany({
    where: { email: { in: PERSONAS.map(([who]) => `persona.${who}@c7ntax.local`) } },
    select: { id: true },
  })).map(u => u.id);
  removed.chatSessions = (await prisma.chatSession.deleteMany({ where: { userId: { in: personaIds }, startedAt: { gte: new Date(RUN) } } })).count;
  removed.sessions = (await prisma.userSession.deleteMany({ where: { userId: { in: personaIds }, createdAt: { gte: new Date(RUN) } } })).count;

  return removed;
}

try {
  await run();
} catch (e) {
  // Marked, not exited: `process.exit` here would skip the sweep below and leave the rows behind, which is
  // the bug this whole block exists to close.
  console.error("probe failed:", e.message);
  process.exitCode = 1;
} finally {
  const removed = await sweepCreated();
  console.log(`\ncleaned up: ${Object.entries(removed).map(([what, n]) => `${n} ${what}`).join(", ")}`);
  await prisma.$disconnect();
}

