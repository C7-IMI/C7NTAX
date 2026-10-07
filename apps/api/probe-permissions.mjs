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
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const MODE = process.env.PROBE_MODE || "all";
const PW = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

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
  ["kb:article", "POST", "/kb", () => ({ title: `Persona probe article ${Date.now()}`, content: "probe", status: "draft", visibility: "internal", tags: [] })],
  ["kb:category", "POST", "/kb/categories", () => ({ name: `Persona probe category ${Date.now()}` })],
  ["workflow:rule", "POST", "/workflows/rules", () => ({ name: `Persona probe rule ${Date.now()}`, entity: "ticket", trigger: "ticket.created", actions: [] })],
  ["survey", "POST", "/surveys", () => ({ name: `Persona probe survey ${Date.now()}` })],
  ["chat:session", "POST", "/chat/sessions", () => ({ title: `Persona probe chat ${Date.now()}` })],
  ["report", "POST", "/reports", () => ({ name: `Persona probe report ${Date.now()}`, type: "ticket", config: {} })],
  ["client", "POST", "/clients", () => ({ name: `Persona probe client ${Date.now()}` })],
  ["system:locale", "POST", "/system/locales", () => ({ code: `zz${String(Date.now()).slice(-6)}`, name: "Persona Probe" })],
  ["inference:provider", "POST", "/inference/providers", () => ({ name: `Persona probe provider ${Date.now()}`, provider: "local", model: "gpt-4o-mini" })],
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
      const r = await call(method, path, tokens[who], bodyFn ? bodyFn() : undefined);
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

run().catch(e => { console.error("probe failed:", e.message); process.exit(1); });

