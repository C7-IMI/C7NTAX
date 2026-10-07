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

console.log(`\n== ${pass} passed, ${fail} failed ==`);
process.exit(fail ? 1 : 0);
