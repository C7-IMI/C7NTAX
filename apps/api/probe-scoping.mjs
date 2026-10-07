/**
 * Company-scoping assertions.
 *
 * Signs in as a company-scoped account and an internal one and checks that the scoped
 * account can only ever see its own company's rows, while internal staff are unaffected.
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";
let pass = 0, fail = 0;
const check = (name, ok, detail = "") => { if (ok) { pass++; console.log("  ok  ", name); } else { fail++; console.log("  FAIL", name, String(detail).slice(0, 200)); } };
const call = async (path, token) => {
  const res = await fetch(BASE + "/api" + path, { headers: token ? { authorization: `Bearer ${token}` } : {} });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};
const signIn = async (email) => {
  const res = await fetch(BASE + "/api/auth/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password: PW }) });
  const j = await res.json();
  if (!j.token) throw new Error(`sign-in failed for ${email}: ${res.status} ${JSON.stringify(j).slice(0, 100)}`);
  return j.token;
};

const internal = await signIn("persona.admin@c7ntax.local");
const scoped = await signIn("persona.clientadmin@c7ntax.local");
const list = async (path, token) => { const r = await call(path, token); return { status: r.status, rows: r.data?.data ?? r.data ?? [] }; };

// Which companies exist, and which one is this account scoped to?
const all = await list("/clients?limit=50", internal);
const mine = await list("/clients?limit=50", scoped);
const myIds = (Array.isArray(mine.rows) ? mine.rows : []).map(c => c.id);
console.log(`== scoping ==\n  internal sees ${Array.isArray(all.rows) ? all.rows.length : "?"} clients; scoped account sees ${myIds.length}`);

check("the scoped account sees at least one client (its own)", myIds.length >= 1, JSON.stringify(mine).slice(0, 120));
check("the scoped account sees fewer clients than internal staff", myIds.length < (all.rows?.length ?? 0), `${myIds.length} vs ${all.rows?.length}`);

// The company ids the scoped account must never see.
const foreign = (all.rows || []).map(c => c.id).filter(id => !myIds.includes(id));
check("there is more than one company to test the boundary with", foreign.length > 0, `foreign=${foreign.length}`);
if (foreign.length) {
  const other = await call(`/clients/${foreign[0]}`, scoped);
  check("another company's client record answers 404", other.status === 404, other.status);
  const contacts = await list(`/clients/${foreign[0]}/contacts`, scoped);
  check("another company's contacts come back empty", (contacts.rows?.length ?? 0) === 0, JSON.stringify(contacts).slice(0, 120));
  const agreements = await list(`/clients/${foreign[0]}/agreements`, scoped);
  check("another company's agreements come back empty", (agreements.rows?.length ?? 0) === 0, JSON.stringify(agreements).slice(0, 120));
}

// Contacts, invoices and reports are the other enumeration paths.
const contacts = await list("/clients/contacts?limit=200", scoped);
const contactCompanies = [...new Set((contacts.rows || []).map(c => c.companyId))];
check("contacts returned are all from the account's own company", contactCompanies.every(id => myIds.includes(id)), JSON.stringify(contactCompanies));

const invoices = await list("/billing/invoices?limit=200", scoped);
const invoiceCompanies = [...new Set((invoices.rows || []).map(i => i.companyId))];
check("invoices returned are all from the account's own company", invoiceCompanies.every(id => myIds.includes(id)), JSON.stringify(invoiceCompanies));

const revenue = await call("/reports/data/revenue-summary", scoped);
const internalRevenue = await call("/reports/data/revenue-summary", internal);
check("revenue report answers", revenue.status === 200, revenue.status);
check("the scoped account's revenue is not the whole company's", (revenue.data?.totalPaid ?? 0) <= (internalRevenue.data?.totalPaid ?? 0), `${revenue.data?.totalPaid} vs ${internalRevenue.data?.totalPaid}`);

// Internal staff must be unaffected.
check("internal staff still see every client", (all.rows?.length ?? 0) > myIds.length, `${all.rows?.length}`);
const internalContacts = await list("/clients/contacts?limit=200", internal);
check("internal staff still see every contact", (internalContacts.rows?.length ?? 0) >= (contacts.rows?.length ?? 0), `${internalContacts.rows?.length} vs ${contacts.rows?.length}`);

// A scoped technician must not see other companies' tickets.
const scopedTech = await signIn("persona.tech.scoped@c7ntax.local");
const techTickets = await list("/tickets?limit=100", scopedTech);
const ticketCompanies = [...new Set((techTickets.rows || []).map(t => t.companyId))];
check("a scoped technician only sees their own company's tickets", ticketCompanies.every(id => id === null || myIds.includes(id)), JSON.stringify(ticketCompanies));

// ── The modules that were still unscoped: projects, quotes, assets, schedule ──
// Each of these is reachable with a permission a client-scoped role holds (ProjectView, BillingView,
// AssetView, TicketView), and each used to return every company's rows — with the caller's own
// companyId filter optional and absent by default.
const post = async (path, token, body) => {
  const res = await fetch(BASE + "/api" + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body ?? {}),
  });
  let data = null; try { data = await res.json(); } catch { /* empty */ }
  return { status: res.status, data };
};

const projects = await list("/projects?limit=200", scoped);
const projectCompanies = [...new Set((projects.rows || []).map(p => p.companyId))];
check("projects returned are all from the account's own company", projectCompanies.every(id => myIds.includes(id)), JSON.stringify(projectCompanies));

const allProjects = await list("/projects?limit=200", internal);
const foreignProject = (allProjects.rows || []).find(p => !myIds.includes(p.companyId));
if (foreignProject) {
  const one = await call(`/projects/${foreignProject.id}`, scoped);
  check("another company's project answers 404", one.status === 404, one.status);
}

const quotes = await list("/quotes", scoped);
const quoteCompanies = [...new Set((quotes.rows || []).map(q => q.companyId))];
check("quotes returned are all from the account's own company", quoteCompanies.every(id => myIds.includes(id)), JSON.stringify(quoteCompanies));

const assets = await list("/inventory/assets?limit=200", scoped);
const assetCompanies = [...new Set((assets.rows || []).map(a => a.companyId))];
check("assets returned are all from the account's own company", assetCompanies.every(id => myIds.includes(id)), JSON.stringify(assetCompanies));

const allAssets = await list("/inventory/assets?limit=200", internal);
const foreignAsset = (allAssets.rows || []).find(a => !myIds.includes(a.companyId));
if (foreignAsset) {
  const one = await call(`/inventory/assets/${foreignAsset.id}`, scoped);
  check("another company's asset answers 404", one.status === 404, one.status);
}

const schedule = await list("/schedule?limit=200", scoped);
const scheduleTicketIds = [...new Set((schedule.rows || []).map(e => e.ticketId).filter(Boolean))];
const scheduleTickets = scheduleTicketIds.length ? await list("/tickets?limit=200", scoped) : { rows: [] };
const myTicketIds = new Set((scheduleTickets.rows || []).map(t => t.id));
check(
  "schedule entries belong to the account's own tickets",
  scheduleTicketIds.every(id => myTicketIds.has(id)),
  JSON.stringify(scheduleTicketIds.slice(0, 5)),
);

// Writes: a company the caller does not belong to must be refused, however it is named.
if (foreign.length) {
  const hijack = await post("/projects", scoped, { name: "Scoping probe project", companyId: foreign[0] });
  check("a scoped account cannot open a project for another company", hijack.status === 403, `${hijack.status} ${JSON.stringify(hijack.data).slice(0, 80)}`);
  const quote = await post("/quotes", scoped, { companyId: foreign[0], title: "Scoping probe quote", lineItems: [{ description: "x", quantity: 1, unitPrice: 1 }] });
  check("a scoped account cannot quote another company", quote.status === 403 || quote.status === 404, `${quote.status} ${JSON.stringify(quote.data).slice(0, 80)}`);
}

// ── The knowledge base: unpublished and internal articles are staff-only ──────
// `KBView` is held by client roles, and the article body is author-written free text that
// frequently quotes a ticket — so drafts (with their review note) and internal articles were
// crossing the provider/client boundary.
const drafts = await list("/kb/drafts", scoped);
check("a scoped account is offered no drafts", (drafts.rows?.length ?? 0) === 0, JSON.stringify(drafts).slice(0, 120));
const askedForDrafts = await list("/kb?status=draft&limit=50", scoped);
check(
  "asking for drafts returns none of them",
  (askedForDrafts.rows || []).every(a => a.status === "published"),
  JSON.stringify((askedForDrafts.rows || []).map(a => a.status).slice(0, 5)),
);
const internalVisibility = await list("/kb?visibility=internal&limit=50", scoped);
check(
  "asking for internal articles returns none of them",
  (internalVisibility.rows || []).every(a => a.visibility !== "internal"),
  JSON.stringify((internalVisibility.rows || []).map(a => a.visibility).slice(0, 5)),
);
const staffDrafts = await list("/kb/drafts", internal);
check("staff still see the draft queue", staffDrafts.status === 200, staffDrafts.status);
const staffAskedForDrafts = await list("/kb?status=draft&limit=50", internal);
check(
  "and staff still get what they ask for",
  (staffAskedForDrafts.rows || []).every(a => a.status === "draft"),
  JSON.stringify((staffAskedForDrafts.rows || []).map(a => a.status).slice(0, 5)),
);

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
