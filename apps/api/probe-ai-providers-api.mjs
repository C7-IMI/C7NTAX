/**
 * Model connections, over HTTP (the routes CloudConnect's AI models tab calls).
 *
 * The unit probe holds the transport to each vendor's documented shapes; this one holds the routes:
 * that the catalogue is served with the fields the dialog renders, that an unknown provider is
 * refused rather than stored, that a connection cannot be made the application's model without a
 * key, that a test stores what the vendor said instead of returning and forgetting it, and that the
 * permissions on the whole surface are the ones on the module.
 *
 * Run from apps/api:  node probe-ai-providers-api.mjs   (the API must be running on 4000)
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
  const body = await res.json().catch(() => ({}));
  return body.token ?? null;
}

const token = await signIn("persona.admin@c7ntax.local");
if (!token) { console.log("could not sign in — is the API running on 4000?"); process.exit(1); }

const auth = { authorization: `Bearer ${token}`, "content-type": "application/json" };
const get = async (path) => {
  const res = await fetch(`${BASE}/api${path}`, { headers: auth });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const send = async (method, path, body) => {
  const res = await fetch(`${BASE}/api${path}`, { method, headers: auth, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};

// ── 1. The catalogue the dialog renders ─────────────────────────────────────────────────────
console.log("\nThe catalogue is served with what the dialog renders");
const types = await get("/inference/provider-types");
check(types.status === 200, "provider-types answers 200");
const list = types.body.types ?? [];
const ids = list.map(t => t.id);
check(ids.length === 11, `${ids.length} providers offered`);
check(["openai", "anthropic", "deepseek", "xai", "google"].every(id => ids.includes(id)), "the named providers are all offered (OpenAI, Claude, DeepSeek, Grok, Gemini)");
check(ids.includes("azure_openai") && ids.includes("ollama") && ids.includes("custom"), "Azure, a local server and any OpenAI-compatible endpoint are offered too");
check(list.every(t => t.label && t.summary && t.docs?.url && t.docs?.label && t.guidance?.text), "every provider carries a label, a summary, a docs link and guidance");
check(list.every(t => Array.isArray(t.credentials) && t.credentials.length > 0), "every provider asks for at least one credential");
check(list.every(t => t.credentials.filter(c => c.required).every(c => c.label && c.hint)), "every required credential is labelled and explained");
check(list.every(t => t.credentials.some(c => c.key === "apiKey")), "every provider asks for a key");
check(list.every(t => typeof t.addressRequired === "boolean"), "every provider says whether it needs an address");
check(list.every(t => Array.isArray(t.shortlist)), "every provider offers a starting list of model names");
check((types.body.runtimeFields ?? []).length >= 5, "the runtime fields are served with the catalogue");
check((types.body.runtimeFields ?? []).some(f => f.key === "appFunctions"), "including the permission that lets a model call application functions");
check((types.body.runtimeFields ?? []).every(f => f.label && f.hint), "and each of them explains itself");

// ── 2. Nothing that cannot be called can be stored ──────────────────────────────────────────
console.log("\nA provider that cannot be called is refused");
const bogus = await send("POST", "/inference/providers", { name: "Probe bogus", provider: "not-a-provider" });
check(bogus.status === 400, "an unknown provider is a 400");
check(String(bogus.body?.error?.message ?? "").includes("Known providers"), "and the refusal names the ones that exist");

const noAddress = await send("POST", "/inference/providers", { name: "Probe cloud", provider: "custom", model: "x", credentials: { baseUrl: "http://127.0.0.1:9/v1" } });
check(noAddress.status === 400, "an address the egress policy refuses is a 400 rather than a stored connection");

// ── 3. Connecting a model ───────────────────────────────────────────────────────────────────
console.log("\nA model connects, is tested and is remembered");
const created = await send("POST", "/inference/providers", {
  name: `Probe model ${Date.now()}`,
  provider: "deepseek",
  model: "deepseek-v4-pro",
  apiKey: "sk-probe-not-a-real-key",
  credentials: { organization: "probe-org" },
  appFunctions: true,
});
check(created.status === 201, "a known provider is stored");
const id = created.body?.id;
check(!!id, "and comes back with an id");
check(created.body.hasApiKey === true, "the row says a key is held");
check(created.body.apiKey === undefined, "and the key itself is never returned");
check(created.body.model === "deepseek-v4-pro", "the model is stored as given");
check(created.body.config?.credentials?.organization === "probe-org", "vendor-specific credentials are stored on the connection");
check(created.body.config?.appFunctions === true, "and so is the app-functions permission");

const listNow = await get("/inference/providers");
check((listNow.body ?? []).some(p => p.id === id), "it appears in the connection list");

// The test really leaves the machine: this key is not a key, so the vendor refuses it. What is being
// asserted is that the refusal is reported with the vendor's own words and stored on the connection.
console.log("\nTesting a connection asks the vendor and remembers the answer");
const test = await send("POST", `/inference/providers/${id}/test`, {});
check(test.status === 200, "the test answers with a body, not an error");
check(test.body.success === false, "a key that is not a key fails");
check(typeof test.body.detail === "string" && test.body.detail.length > 0, "the failure carries a reason");
check(/^\d{3}/.test(String(test.body.detail)), `the reason starts with the vendor's status (${String(test.body.detail).slice(0, 40)})`);
check(test.body.lastTest?.ok === false, "the connection remembers that it failed");

const after = await get("/inference/providers");
const stored = (after.body ?? []).find(p => p.id === id);
check(stored?.config?.lastTest?.ok === false, "the stored row carries the last test, so the next reader does not have to repeat it");
check(typeof stored?.config?.lastTest?.at === "string", "with the time it was taken");

// ── 4. The vendor is asked for its model list ───────────────────────────────────────────────
console.log("\nThe model list is asked for, and its absence is honest");
const models = await get(`/inference/providers/${id}/models`);
check(models.status === 200, "the model list answers 200");
check(["provider", "unavailable", "cached", "shortlist"].includes(models.body.source), `the answer says where the list came from (${models.body.source})`);
check(Array.isArray(models.body.models), "and it is always a list");
check(Array.isArray(models.body.shortlist) && models.body.shortlist.length > 0, "the build's own suggestions travel with it");
check(models.body.source !== "provider" || models.body.models.length > 0, "a list from the vendor is never empty");
check(models.body.source === "provider" || !!models.body.detail, "and a list that is not from the vendor says why not");

// ── 5. Making it the application's model needs a key ────────────────────────────────────────
console.log("\nA model becomes the application's model only if it can be called");
const keyless = await send("POST", "/inference/providers", { name: `Probe keyless ${Date.now()}`, provider: "openai", model: "gpt-6-luna" });
const activateKeyless = await send("POST", `/inference/providers/${keyless.body.id}/activate`, {});
check(activateKeyless.status === 400, "a connection with no key cannot be made the active model");
check(String(activateKeyless.body?.error?.message ?? "").includes("no API key"), "and the refusal says why");

const activate = await send("POST", `/inference/providers/${id}/activate`, {});
check(activate.status === 200, "a connection with a key can be");
check(activate.body.provider?.isActive === true && activate.body.provider?.isDefault === true, "activation sets both flags together");

const status = await get("/inference/status");
check(status.status === 200, "the status route answers");
check(status.body.provider === "deepseek", "and names the provider in use");
check(status.body.model === "deepseek-v4-pro", "with the model");
check(status.body.providerLabel === "DeepSeek", "and a label a screen can show");
check(status.body.appFunctions === true, "and whether it may call application functions");
check(status.body.counts.total >= 2, "it also counts the connections");

const others = await get("/inference/providers");
check((others.body ?? []).filter(p => p.isDefault).length === 1, "only one model is ever the default");

const deactivate = await send("POST", `/inference/providers/${id}/deactivate`, {});
check(deactivate.body.provider?.isActive === false && deactivate.body.provider?.isDefault === false, "and stopping using it clears both flags");

// ── 6. What a refused reader gets ───────────────────────────────────────────────────────────
console.log("\nThe surface is gated like the module");
const anon = await fetch(`${BASE}/api/inference/provider-types`);
check(anon.status === 401, "an anonymous read is refused");
const anonTest = await fetch(`${BASE}/api/inference/providers/${id}/test`, { method: "POST" });
check(anonTest.status === 401, "an anonymous test is refused");

const readonly = await signIn("persona.readonly@c7ntax.local");
if (readonly) {
  const roHeaders = { authorization: `Bearer ${readonly}`, "content-type": "application/json" };
  const roTypes = await fetch(`${BASE}/api/inference/provider-types`, { headers: roHeaders });
  const roCreate = await fetch(`${BASE}/api/inference/providers`, {
    method: "POST", headers: roHeaders, body: JSON.stringify({ name: "nope", provider: "openai" }),
  });
  check(roTypes.status === 403, "a persona without inference:view is refused the catalogue too — the module is gated whole");
  check(roCreate.status === 403, "and may not connect a model");
} else {
  console.log("  note  the read-only persona is not seeded, so the write gate was not exercised");
}

// ── 7. Cleaning up ──────────────────────────────────────────────────────────────────────────
console.log("\nThe probe removes what it made");
const removed = await send("DELETE", `/inference/providers/${id}`);
check(removed.status === 200, "the probe's own connection is deleted");
if (keyless.body?.id) await send("DELETE", `/inference/providers/${keyless.body.id}`);
const finalList = await get("/inference/providers");
check(!(finalList.body ?? []).some(p => p.name?.startsWith("Probe ")), "and no probe rows are left behind");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
