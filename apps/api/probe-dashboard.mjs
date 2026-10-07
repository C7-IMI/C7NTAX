/**
 * Per-user dashboard layout (PLAN-015 Phase B #4).
 *
 * The dashboard is assembled from a saved list of widget ids. That list arrives from a browser, so
 * these assertions are about the two things that make it safe and useful: it is checked against the
 * server's catalogue rather than trusted, and it is scoped to the account that saved it — one
 * user's arrangement must never appear on another user's dashboard.
 *
 * Run from apps/api:  node probe-dashboard.mjs
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

const ADMIN = "persona.admin@c7ntax.local";
const TECH = "persona.tech@c7ntax.local";
const READONLY = "persona.readonly@c7ntax.local";

async function main() {
  const admin = await signIn(ADMIN);
  const tech = await signIn(TECH);
  const readonly = await signIn(READONLY);
  check(admin.status === 200 && tech.status === 200 && readonly.status === 200,
    `admin (${admin.status}), technician (${tech.status}) and read-only (${readonly.status}) signed in`);

  // Start from a clean slate for both personas so the assertions describe this run, not the last.
  for (const token of [admin.token, tech.token, readonly.token]) await call("DELETE", "/api/dashboard/layout", { token });

  console.log("\na user with no saved layout gets the catalogue, in catalogue order");
  const fresh = await call("GET", "/api/dashboard/layout", { token: admin.token });
  check(fresh.status === 200, `the layout answers (${fresh.status})`);
  const widgets = fresh.data.widgets || [];
  const catalogue = fresh.data.catalogue || [];
  check(widgets.length === catalogue.length, `every catalogue widget is placed (${widgets.length}/${catalogue.length})`);
  check(widgets.every(w => w.visible) && fresh.data.personalised === false, "all visible, and reported as not yet personalised");
  check(JSON.stringify(widgets.map(w => w.id)) === JSON.stringify(catalogue.map(c => c.id)), "the order is the catalogue's order");
  check(widgets.every(w => w.size === catalogue.find(c => c.id === w.id)?.defaultSize), "each widget takes its catalogue default width");

  console.log("\nthe catalogue is filtered by what the account may actually load");
  // The technician persona holds ticket/client/alert view permissions but not billing, so it is
  // the account that proves the filter: two widgets read billing data and must not be offered.
  const techLayout = await call("GET", "/api/dashboard/layout", { token: tech.token });
  const techIds = (techLayout.data.catalogue || []).map(c => c.id);
  check(techIds.length > 0 && techIds.length < catalogue.length,
    `the technician is offered fewer widgets than the administrator (${techIds.length} of ${catalogue.length})`);
  check(!techIds.includes("overdue_invoices") && !techIds.includes("my_time"),
    "and not the two that would read billing data it cannot load");
  check(techIds.includes("open_tickets") && techIds.includes("quick_links"), "while keeping the ones it can");

  console.log("\na saved arrangement comes back exactly as it was arranged");
  const arranged = [
    { id: "quick_links", size: 3, visible: true },
    { id: "open_tickets", size: 2, visible: true },
    { id: "recent_tickets", size: 2, visible: true },
    { id: "waiting_on_client", size: 1, visible: false },
  ];
  const saved = await call("PUT", "/api/dashboard/layout", { token: admin.token, body: { widgets: arranged } });
  check(saved.status === 200, `the layout saved (${saved.status})`);
  check(JSON.stringify(saved.data.widgets.slice(0, 4)) === JSON.stringify(arranged), "the four arranged widgets came back in order, size and visibility unchanged");
  check(saved.data.widgets.length === catalogue.length, "and the widgets the user never placed are still appended, so nothing disappears");
  const reread = await call("GET", "/api/dashboard/layout", { token: admin.token });
  check(JSON.stringify(reread.data.widgets) === JSON.stringify(saved.data.widgets), "a fresh read returns the same arrangement");
  check(reread.data.personalised === true, "and now reports itself as personalised");

  console.log("\nthe saved list is input, and is treated like it");
  const junk = await call("PUT", "/api/dashboard/layout", {
    token: admin.token,
    body: { widgets: [{ id: "definitely_not_a_widget", size: 1, visible: true }, { id: "open_tickets", size: 99, visible: true }, { id: "open_tickets", size: 1, visible: true }] },
  });
  const junkIds = junk.data.widgets.map(w => w.id);
  check(junk.status === 200, `an unrecognised list is reconciled rather than rejected (${junk.status})`);
  check(!junkIds.includes("definitely_not_a_widget"), "an unknown widget id is dropped");
  check(junkIds.filter(id => id === "open_tickets").length === 1, "a duplicate is collapsed to one");
  const openTickets = junk.data.widgets.find(w => w.id === "open_tickets");
  check([1, 2, 3].includes(openTickets.size), `an impossible width falls back to a real one (${openTickets.size})`);

  const notAnArray = await call("PUT", "/api/dashboard/layout", { token: admin.token, body: { widgets: "everything" } });
  check(notAnArray.status === 400, `a non-array is refused (${notAnArray.status})`);
  const tooMany = await call("PUT", "/api/dashboard/layout", { token: admin.token, body: { widgets: Array.from({ length: 60 }, () => ({ id: "open_tickets" })) } });
  check(tooMany.status === 400, `an absurd list length is refused (${tooMany.status})`);
  const allHidden = await call("PUT", "/api/dashboard/layout", {
    token: admin.token,
    body: { widgets: catalogue.map(c => ({ id: c.id, size: 1, visible: false })) },
  });
  check(allHidden.status === 400, `hiding everything is refused, so nobody can blank their dashboard by accident (${allHidden.status})`);

  console.log("\na layout belongs to one account and nobody else");
  await call("PUT", "/api/dashboard/layout", { token: admin.token, body: { widgets: arranged } });
  await call("DELETE", "/api/dashboard/layout", { token: tech.token });
  const techBefore = await call("GET", "/api/dashboard/layout", { token: tech.token });
  check(techBefore.data.personalised === false, "the technician still has no saved layout");
  check(JSON.stringify(techBefore.data.widgets) !== JSON.stringify(arranged.slice(0, 4)), "and does not see the administrator's arrangement");
  const techSave = await call("PUT", "/api/dashboard/layout", {
    token: tech.token,
    body: { widgets: [{ id: "recent_tickets", size: 3, visible: true }] },
  });
  check(techSave.status === 200 && (techSave.data.widgets[0] || {}).id === "recent_tickets", "the technician's own save takes effect for the technician");
  const adminAfter = await call("GET", "/api/dashboard/layout", { token: admin.token });
  check((adminAfter.data.widgets[0] || {}).id === "quick_links", `and leaves the administrator's layout alone (${(adminAfter.data.widgets[0] || {}).id})`);

  console.log("\nan account with no dashboard permission still reaches its own row");
  const readonlySave = await call("PUT", "/api/dashboard/layout", {
    token: readonly.token,
    body: { widgets: [{ id: "quick_links", size: 3, visible: true }] },
  });
  check(readonlySave.status === 200, `a read-only account can arrange its dashboard (${readonlySave.status})`);
  const offeredToTech = (techLayout.data.catalogue || []).map(c => c.id);
  const techSmuggle = await call("PUT", "/api/dashboard/layout", {
    token: tech.token,
    body: { widgets: [{ id: "today_revenue", size: 1, visible: true }, { id: "open_tickets", size: 1, visible: true }] },
  });
  check(techSmuggle.status === 200 && (techSmuggle.data.widgets || []).every(w => offeredToTech.includes(w.id)),
    "and an account cannot smuggle in a widget it is not offered");

  console.log("\nreset puts it back");
  const reset = await call("DELETE", "/api/dashboard/layout", { token: admin.token });
  check(reset.status === 200 && reset.data.personalised === false, `reset clears the saved layout (${reset.status})`);
  check(JSON.stringify(reset.data.widgets.map(w => w.id)) === JSON.stringify(reset.data.catalogue.map(c => c.id)), "and returns the catalogue order");
  const anon = await call("GET", "/api/dashboard/layout");
  check(anon.status === 401, `an unauthenticated read is refused (${anon.status})`);

  await prisma.userDashboardConfig.deleteMany({
    where: { user: { email: { in: [ADMIN, TECH, READONLY] } } },
  });
  const personaIds = (await prisma.user.findMany({ where: { email: { in: [ADMIN, TECH, READONLY] } }, select: { id: true } })).map(u => u.id);
  await prisma.userSession.deleteMany({ where: { userId: { in: personaIds } } });
  const leftovers = await prisma.userDashboardConfig.count({ where: { userId: { in: personaIds } } });
  check(leftovers === 0, `the probe cleaned up after itself (${leftovers} layouts left)`);
  await prisma.$disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail === 0 ? 0 : 1);
}

void main();
