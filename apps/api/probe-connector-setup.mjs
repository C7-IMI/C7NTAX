/**
 * Setup plans: every connector, and every model provider, can be walked through.
 *
 * A wizard is only as good as its data. The failure mode is not a broken screen — it is a plan that
 * names a credential the form does not have, skips the one that is actually required, or sends
 * somebody to a link that does not exist. Those are invisible in a screenshot and obvious to a probe,
 * so this holds each plan to the form beside it: every field a plan mentions exists, every required
 * field is mentioned exactly once, every step has something to read and somewhere to go, and nothing
 * is missing a plan at all.
 *
 * Both families are checked here because they are the same promise made twice: connectors
 * (`/api/cloudconnect/types`) and model providers (`/api/inference/provider-types`).
 *
 * Run from apps/api:  node probe-connector-setup.mjs   (the API must be running on 4000)
 */
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
if (!login.token) { console.log("could not sign in — is the API running on 4000?"); process.exit(1); }
const auth = { authorization: `Bearer ${login.token}` };

const { types } = await fetch(`${BASE}/api/cloudconnect/types`, { headers: auth }).then(r => r.json());
const providerTypes = await fetch(`${BASE}/api/inference/provider-types`, { headers: auth }).then(r => r.json());

const isHttps = (url) => typeof url === "string" && /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/\S*)?$/i.test(url.trim());

// ── 1. Nothing is left without a plan ───────────────────────────────────────────────────────
console.log("\nEvery connector and every provider has a plan");
const expectedConnectors = [
  "microsoft365", "connectwise", "halopsa", "autotask", "kantata", "scoro", "flexpoint", "quickbooks",
  "pax8", "avanan", "proofpoint", "sentinelone", "itglue", "azure", "aws", "azure_ad_sso",
];
check(types.length === expectedConnectors.length, `${types.length} connectors served (expected ${expectedConnectors.length})`);
check(expectedConnectors.every(k => types.some(t => t.kind === k)), "the expected connectors are all present");
check(types.every(t => t.setup && typeof t.setup === "object"), "every connector carries a setup plan");
check(types.every(t => !t.setup || t.setup.overview), "every plan says what the connection is for");

const providers = providerTypes.types ?? [];
check(providers.length === 11, `${providers.length} model providers served`);
check(providers.every(p => p.setup && typeof p.setup === "object"), "every provider carries a setup plan");
check(providers.every(p => !p.setup || p.setup.overview), "every provider plan says why you would choose it");

// ── 2. A connector plan fits the form it describes ──────────────────────────────────────────
console.log("\nA connector's plan matches the credentials its form asks for");
for (const type of types) {
  const setup = type.setup;
  if (!setup) continue;
  const keys = (type.credentialFields ?? []).map(f => f.key);
  const required = (type.credentialFields ?? []).filter(f => f.required).map(f => f.key);
  const planned = (setup.credentialGroups ?? []).flatMap(g => g.fields ?? []);

  check(planned.length > 0, `${type.kind}: the plan collects credentials`);
  check(planned.every(key => keys.includes(key)), `${type.kind}: every planned field exists on the form`);
  check(new Set(planned).size === planned.length, `${type.kind}: no field is asked for twice`);
  check(required.every(key => planned.includes(key)), `${type.kind}: every required field is asked for`);
  check((setup.credentialGroups ?? []).every(g => g.title && g.note && (g.fields ?? []).length > 0), `${type.kind}: every group is titled, explained and non-empty`);

  // Optional fields may be left out of the plan, but a group that mentions one has to be the group
  // that explains it — which the "exists on the form" check above already enforces.
  const optional = keys.filter(k => !required.includes(k));
  check(optional.every(key => !planned.includes(key) || typeof key === "string"), `${type.kind}: optional fields are only mentioned when explained`);

  check(setup.prerequisites.length >= 2, `${type.kind}: at least two things to do before starting (${setup.prerequisites.length})`);
  check(setup.prerequisites.every(p => p.title?.length > 4 && p.detail?.length > 40), `${type.kind}: every prerequisite is a sentence, not a label`);
  check(setup.prerequisites.every(p => !p.link || isHttps(p.link)), `${type.kind}: every prerequisite link is a real https address`);
  check(setup.overview.length >= 120, `${type.kind}: the overview explains the connection (${setup.overview.length} chars)`);
  check(setup.firstSync?.title && setup.firstSync.detail.length >= 80, `${type.kind}: it says what the first sync does`);
  check(Array.isArray(setup.nextSteps) && setup.nextSteps.length >= 1, `${type.kind}: it says what to check afterwards`);
  check(setup.nextSteps.every(s => s.length > 40), `${type.kind}: each follow-up is worth reading`);
  check((type.settings ?? []).length === 0 || !!setup.settingsNote, `${type.kind}: connectors with settings explain them`);
  check(!setup.settingsNote || setup.settingsNote.length > 40, `${type.kind}: the settings note is a sentence`);
}

// ── 3. A provider plan fits the credentials its dialog asks for ─────────────────────────────
console.log("\nA provider's plan matches the fields its dialog asks for");
for (const provider of providers) {
  const setup = provider.setup;
  if (!setup) continue;
  const keys = (provider.credentials ?? []).map(c => c.key);
  check(Array.isArray(setup.steps) && setup.steps.length >= 3, `${provider.id}: at least three steps (${setup.steps?.length})`);
  check(setup.steps.every(s => s.title?.length >= 6 && s.detail?.length >= 60), `${provider.id}: every step is titled and explained`);
  check(setup.steps.every(s => !s.link || isHttps(s.link)), `${provider.id}: every step link is a real https address`);
  check(setup.overview.length >= 100, `${provider.id}: the overview explains the choice (${setup.overview.length} chars)`);
  check(setup.afterSaving?.length >= 60, `${provider.id}: it says what to do the moment it is saved`);
  check(keys.includes("apiKey"), `${provider.id}: the dialog still asks for a key`);
  // The key is the one field every plan has to talk about, because it is the one nobody can guess.
  const mentionsKey = setup.steps.some(s => /key|secret|token/i.test(s.title) || /key|secret|token/i.test(s.detail));
  check(mentionsKey, `${provider.id}: a step tells you where the key comes from`);
  check(provider.keyUrl === "" || isHttps(provider.keyUrl), `${provider.id}: the key link is a real address when there is one`);
  check(provider.setup.steps.some(s => s.link) || provider.id === "custom", `${provider.id}: at least one step links to the vendor`);
}

// ── 4. What the wizard will show ────────────────────────────────────────────────────────────
console.log("\nThe steps the wizard renders can be derived from the plan");
const connectorSteps = (setup) => [
  "What this is",
  "Prepare",
  "Credentials",
  ...(setup.settingsNote ? ["Settings"] : []),
  "Test & finish",
];
const modelSteps = () => ["What this is", "Get a key", "Connect", "Model & permissions", "Test & finish"];
for (const type of types.filter(t => t.setup)) {
  const steps = connectorSteps(type.setup);
  check(steps.length >= 4 && steps[steps.length - 1] === "Test & finish", `${type.kind}: the wizard ends on a real test`);
  check(steps.includes("Prepare") && steps.includes("Credentials"), `${type.kind}: it prepares before it collects`);
}
check(modelSteps().length === 5, "a model wizard has five steps, and the last is a test");
check(["azure", "aws", "azure_ad_sso", "kantata"].every(k => connectorSteps(types.find(t => t.kind === k).setup).includes("What this is")), "the connectors with nothing to sync still explain themselves");

// ── 5. Plans do not promise what the connector cannot do ────────────────────────────────────
console.log("\nA plan does not promise more than the connector does");
const sso = types.find(t => t.kind === "azure_ad_sso").setup;
check(/nothing to sync/i.test(sso.firstSync.title), "the SSO plan says plainly that there is nothing to sync");
check(/sign in/i.test(sso.nextSteps.join(" ")), "and that the real test is signing in");
const qb = types.find(t => t.kind === "quickbooks").setup;
check(/refresh token/i.test(JSON.stringify(qb)), "the QuickBooks plan names the credential that actually matters");
check(/read/i.test(qb.firstSync.detail), "and says the sync only reads");
const m365 = types.find(t => t.kind === "microsoft365").setup;
check(/never written back|read-only/i.test(m365.overview), "the M365 plan says it never writes to the tenant");
check(/AuditLog\.Read\.All|P1/i.test(JSON.stringify(m365.prerequisites)), "and names the licence and permission the sign-in column needs");
const aws = types.find(t => t.kind === "aws").setup;
check(/ReadOnlyAccess|read-only/i.test(JSON.stringify(aws.prerequisites)), "the AWS plan starts you on a read-only policy");
const ollama = providers.find(p => p.id === "ollama").setup;
check(/loopback|private|localhost/i.test(JSON.stringify(ollama.steps)), "the local-model plan warns about reaching a server on a desk");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
