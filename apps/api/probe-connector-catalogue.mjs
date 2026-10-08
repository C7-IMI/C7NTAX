/**
 * Connector catalogue (GET /api/cloudconnect/types).
 *
 * The catalogue is the promise the connector form makes: these are the fields a person is asked to
 * fill in and the options they are offered. It went wrong once already — the form asked for an API
 * key where the vendor wanted an application id and secret, and offered base URLs for APIs whose host
 * is fixed — so these assertions hold it to the vendors' own documentation and, just as importantly,
 * to what the adapters in this repository actually read. A catalogue entry that promises a setting no
 * adapter looks at is a switch that does nothing.
 *
 * Run from apps/api:  node probe-connector-catalogue.mjs
 */
import { readFileSync } from "node:fs";

const BASE = "http://127.0.0.1:4000";
const PW = "Persona-Dev-Only-2026!";

let pass = 0;
let fail = 0;
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); }
};

const login = await fetch(`${BASE}/api/auth/login`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ email: "persona.admin@c7ntax.local", password: PW }),
}).then(r => r.json());
const token = login.token;
if (!token) { console.log("could not sign in — is the API running on 4000?"); process.exit(1); }

const { types } = await fetch(`${BASE}/api/cloudconnect/types`, { headers: { authorization: `Bearer ${token}` } }).then(r => r.json());

// ── 1. Completeness ──────────────────────────────────────────────────────
console.log("\nEvery connector describes itself");
const EXPECTED = [
  "microsoft365", "connectwise", "halopsa", "autotask", "kantata", "scoro", "flexpoint", "quickbooks",
  "pax8", "avanan", "proofpoint", "sentinelone", "itglue", "azure", "aws", "azure_ad_sso",
];
check(types.length === EXPECTED.length, `${types.length} kinds served (expected ${EXPECTED.length})`);
check(EXPECTED.every(k => types.some(t => t.kind === k)), "every expected kind is present");

for (const type of types) {
  const fields = type.credentialFields ?? [];
  const problems = [];
  if (!type.name?.trim()) problems.push("no name");
  if (!type.description?.trim()) problems.push("no description");
  if (!fields.length) problems.push("no credential fields");
  if (!type.guidance?.text?.trim()) problems.push("no guidance");
  if (!/^https:\/\//.test(type.docsUrl ?? "")) problems.push("no documentation link");
  for (const f of fields) {
    if (!f.key || !f.label?.trim()) problems.push(`field ${f.key ?? "?"} has no label`);
    if (!f.hint?.trim()) problems.push(`field ${f.key} has no hint`);
  }
  for (const s of type.settings ?? []) {
    if (!s.key || !s.label?.trim()) problems.push(`setting ${s.key ?? "?"} has no label`);
    if (!s.hint?.trim()) problems.push(`setting ${s.key} has no hint`);
    if (!s.type) problems.push(`setting ${s.key} has no type`);
  }
  const keys = new Set(fields.map(f => f.key));
  for (const required of type.requiredCredentials ?? []) {
    if (!keys.has(required)) problems.push(`requires ${required} but never offers the field`);
  }
  check(problems.length === 0, `${type.kind}: labelled fields, hints, guidance, docs${problems.length ? ` — ${problems.join("; ")}` : ""}`);
}

// ── 2. What the vendors' documentation requires ──────────────────────────
console.log("\nThe credentials match the vendor's authentication");
const requires = (kind, ...keys) => {
  const type = types.find(t => t.kind === kind);
  const missing = keys.filter(k => !(type.requiredCredentials ?? []).includes(k));
  check(missing.length === 0, `${kind} needs ${keys.join(", ")}${missing.length ? ` — missing ${missing.join(", ")}` : ""}`);
};
const doesNotRequire = (kind, ...keys) => {
  const type = types.find(t => t.kind === kind);
  const present = keys.filter(k => (type.requiredCredentials ?? []).includes(k));
  check(present.length === 0, `${kind} does not ask for ${keys.join(", ")}${present.length ? ` — still asking for ${present.join(", ")}` : ""}`);
};

// Pax8 mints a token from a client id and secret; there is no API key.
requires("pax8", "clientId", "clientSecret");
doesNotRequire("pax8", "apiKey", "baseUrl");
// Harmony Email signs an application id and secret into a JWT, on a region-specific host.
requires("avanan", "appId", "appSecret", "region");
doesNotRequire("avanan", "apiKey");
// SentinelOne's console is the tenant's own address.
requires("sentinelone", "consoleUrl", "apiToken");
doesNotRequire("sentinelone", "baseUrl");
// QuickBooks access tokens last an hour; the refresh token is the credential worth storing.
requires("quickbooks", "clientId", "clientSecret", "refreshToken", "realmId");
doesNotRequire("quickbooks", "accessToken");
// Azure Resource Manager mints its own token and needs a role assignment on the subscription.
requires("azure", "tenantId", "clientId", "clientSecret", "subscriptionId");
doesNotRequire("azure", "accessToken");
// Scoro addresses the tenant by site subdomain and names the company account in every body.
requires("scoro", "site", "apiKey", "companyAccountId");
// AutoTask's host carries the zone; HaloPSA's token request carries a scope.
check((types.find(t => t.kind === "autotask").credentialFields ?? []).some(f => f.key === "zone"), "autotask offers the zone, which its host requires");
check((types.find(t => t.kind === "halopsa").credentialFields ?? []).some(f => f.key === "scope"), "halopsa offers the scope its token request needs");
// IT Glue and Proofpoint have fixed hosts; asking for a base URL only produces a wrong answer.
doesNotRequire("itglue", "baseUrl");
doesNotRequire("proofpoint", "baseUrl");
// AWS has no bearer-token form at all.
requires("aws", "accessKeyId", "secretAccessKey", "region");

// ── 3. The catalogue and the adapters agree ──────────────────────────────
console.log("\nEvery advertised option is one an adapter actually reads");
const ADAPTER_DIR = "../../packages/integrations/src/adapters/";
// A setting counts as honoured if something in the product is actually reading it. Microsoft 365's
// contact writing lives in the sync route rather than its adapter, so that file is read as well.
const SETTING_SOURCES = {
  microsoft365: [ADAPTER_DIR + "Microsoft365Adapter.ts", "./src/routes/cloudconnect.ts"],
  connectwise: [ADAPTER_DIR + "ConnectWiseAdapter.ts"],
  halopsa: [ADAPTER_DIR + "HaloPSAAdapter.ts"],
  autotask: [ADAPTER_DIR + "AutoTaskAdapter.ts"],
  kantata: [ADAPTER_DIR + "KantataAdapter.ts"],
  scoro: [ADAPTER_DIR + "ScoroAdapter.ts"],
  quickbooks: [ADAPTER_DIR + "QuickBooksAdapter.ts"],
  pax8: [ADAPTER_DIR + "Pax8Adapter.ts"],
  avanan: [ADAPTER_DIR + "AvananAdapter.ts"],
  proofpoint: [ADAPTER_DIR + "ProofpointAdapter.ts"],
  sentinelone: [ADAPTER_DIR + "SentinelOneAdapter.ts"],
  itglue: [ADAPTER_DIR + "ITGlueAdapter.ts"],
  azure: [ADAPTER_DIR + "AzureAdapter.ts"],
  aws: [ADAPTER_DIR + "AwsAdapter.ts"],
  flexpoint: [ADAPTER_DIR + "FlexpointAdapter.ts", "./src/services/flexpoint.ts"],
};

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const settingsRead = source => new Set([...source.matchAll(/settings\??\.([A-Za-z0-9_]+)/g)].map(m => m[1]));

for (const [kind, files] of Object.entries(SETTING_SOURCES)) {
  const type = types.find(t => t.kind === kind);
  const advertised = (type.settings ?? []).map(s => s.key);
  if (!advertised.length) continue;
  const sources = files.map(read);
  const read_ = new Set();
  for (const source of sources) for (const key of settingsRead(source)) read_.add(key);
  // FlexPoint reads its per-resource switches by name (`cfg.settings?.[key]`, where `key` comes from
  // its resource table), so nothing matches the property-access pattern. Fall back to matching the
  // literal name in the source for that connector.
  const ignored = advertised.filter(key => !read_.has(key) && !sources.some(source => source.includes(key)));
  check(ignored.length === 0, `${kind}: settings ${advertised.join(", ")} are read somewhere${ignored.length ? ` — ${ignored.join(", ")} is not` : ""}`);
}

console.log(`\n${pass} passing, ${fail} failing`);
process.exit(fail ? 1 : 0);
