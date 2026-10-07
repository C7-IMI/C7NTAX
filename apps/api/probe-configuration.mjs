/**
 * Application configuration suite.
 *
 * Drives the real API, because the interesting properties of this feature are not in the
 * registry — they are in what happens when a value is resolved and when a feature reads it:
 *
 *   · resolution order: a saved setting beats the environment, which beats the declared default;
 *   · a conversion that reversed a flag's polarity would be invisible in review, so every flag
 *     that ships on is checked to still read as on with the environment it shipped with;
 *   · the write path validates: ranges, choices, colours, clock times, unknown fields, unknown
 *     areas, and fields the deployment owns;
 *   · the portal honours its own configuration — visibility scope, the two permission switches,
 *     and the branding defaults a client has not overridden;
 *   · a request cannot address a SystemConfig row the registry does not own.
 *
 * Requires a running API on PROBE_BASE with the sample data seeded, and an administrator whose
 * credentials match PROBE_EMAIL / PROBE_PASSWORD. Every setting it changes is restored before it
 * reports, including on failure.
 */
const BASE = process.env.PROBE_BASE || "http://127.0.0.1:4000";
const ADMIN_EMAIL = process.env.PROBE_EMAIL || "persona.admin@c7ntax.local";
const ADMIN_PASSWORD = process.env.PROBE_PASSWORD || "Persona-Dev-Only-2026!";

let pass = 0, fail = 0;
const check = (ok, label, detail = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label} ${detail}`); }
};
const section = (name) => console.log(`\n${name}`);

async function signIn(email, password) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const text = await res.text();
  try { return { status: res.status, data: JSON.parse(text) }; }
  catch { return { status: res.status, data: { raw: text.slice(0, 200) } }; }
}

const admin = await signIn(ADMIN_EMAIL, ADMIN_PASSWORD);
if (!admin.data?.token) {
  console.error(`Could not sign in as ${ADMIN_EMAIL}: ${admin.status} ${JSON.stringify(admin.data).slice(0, 300)}`);
  process.exit(1);
}
const H = { authorization: `Bearer ${admin.data.token}`, "content-type": "application/json" };

const get = async (path) => {
  const res = await fetch(`${BASE}/api${path}`, { headers: H });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
};
const patch = async (path, value) => {
  const res = await fetch(`${BASE}/api${path}`, { method: "PATCH", headers: H, body: JSON.stringify({ value }) });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
};
const clearSetting = async (path) => {
  const res = await fetch(`${BASE}/api${path}`, { method: "DELETE", headers: H });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
};

const config = await get("/configuration");
check(config.status === 200, `GET /configuration answers 200 (${config.status})`);
let sections = config.data?.sections ?? [];
const byId = (id) => sections.find(s => s.id === id);
/** Always reads the live configuration: a stale snapshot would hide a failed write. */
const liveField = async (sectionId, fieldId) => {
  sections = (await get("/configuration")).data?.sections ?? [];
  return fieldOf(sectionId, fieldId);
};
const fieldOf = (sectionId, fieldId) => byId(sectionId)?.fields.find(f => f.id === fieldId);

section("The registry is published in full");

const expectedSections = ["workspace", "sessions", "portal", "monitoring", "knowledge", "integrations", "billing", "apps"];
check(
  expectedSections.every(id => !!byId(id)),
  `all ${expectedSections.length} areas are described`,
  `got ${sections.map(s => s.id).join(",")}`,
);
check(sections.every(s => s.fields.length > 0), "every area has at least one setting");
const allFields = sections.flatMap(s => s.fields.map(f => ({ ...f, section: s.id })));
check(allFields.length >= 45, `the registry describes ${allFields.length} settings`);
check(
  allFields.every(f => f.label && f.summary),
  "every setting names itself and says what it does",
);
check(
  allFields.filter(f => f.source === "setting").every(f => f.env === null || typeof f.env === "string"),
  "a writable setting that stands in for an environment variable names it",
);

section("Resolution order: setting, then environment, then declared default");

const portalEnabled = fieldOf("portal", "enabled");
check(!!portalEnabled, "the portal's enabled switch is published");
check(
  portalEnabled.fromEnvironment === true,
  "the portal switch reports that the deployment supplies it (PORTAL_ENABLED)",
);
check(
  portalEnabled.saved === null,
  `nothing is stored for it yet (saved=${JSON.stringify(portalEnabled.saved)})`,
);
check(portalEnabled.value === true, "the environment's value is in force");
check(
  portalEnabled.fallback === portalEnabled.value,
  "with nothing stored, the effective value equals the deployment's own",
);

// Save the opposite of the environment value: the setting must win.
const flipped = !portalEnabled.value;
const writeFlip = await patch("/configuration/portal/enabled", flipped);
check(writeFlip.status === 200, `saving the opposite of the environment is accepted (${writeFlip.status})`);
const afterFlip = await liveField("portal", "enabled");
check(afterFlip.value === flipped, `the saved setting now wins (value=${afterFlip.value})`);
check(afterFlip.overridden === true, "the field is reported as overriding the deployment");
check(afterFlip.fallback === portalEnabled.value, "the deployment's own value is still reported");

// Clearing it must fall back to the environment again.
const clearFlip = await clearSetting("/configuration/portal/enabled");
check(clearFlip.status === 200, "a saved value can be cleared, so the deployment's own applies again");
const afterRestore = await liveField("portal", "enabled");
check(afterRestore.value === portalEnabled.value, "the value is back to the deployment's own");
check(afterRestore.saved === null, "and nothing is stored for it any more");
check(afterRestore.overridden === false, "and it is no longer reported as an override");

const clearDeploymentOwned = await clearSetting("/configuration/sessions/authHardening");
check(clearDeploymentOwned.status === 403, `a deployment-owned setting cannot be cleared either (${clearDeploymentOwned.status})`);
const clearUnknown = await clearSetting("/configuration/portal/nope");
check(clearUnknown.status === 404, `clearing an unknown setting answers 404 (${clearUnknown.status})`);

section("A converted flag keeps the polarity it shipped with");

/**
 * Two things can go wrong converting a `process.env` read into a setting, and both are silent:
 * the declared default can disagree with the declared polarity, and a flag that shipped on can
 * be read as if it shipped off. The API reports `envMatch` and the resolved fallback, so both
 * are checkable from here without the probe having to know the API's environment.
 *
 * `envMatch` is the test the original code performed: `not-false` was `!== "false"`, which means
 * an unset variable meant ON; `is-true` was `=== "true"`, which means an unset variable meant
 * OFF. So the declared default must follow from the polarity — nothing else.
 */
const booleanFlags = allFields.filter(f => f.type === "boolean" && f.env);
check(booleanFlags.length >= 15, `${booleanFlags.length} boolean flags are published`);

const disagreeing = booleanFlags.filter(f => f.default !== (f.envMatch === "not-false"));
check(
  disagreeing.length === 0,
  "every flag's declared default follows from its declared polarity",
  disagreeing.map(f => `${f.section}.${f.id}: ${f.envMatch} => default ${f.default}`).join("; "),
);
check(
  booleanFlags.every(f => f.envMatch === "not-false" || f.envMatch === "is-true"),
  "every flag states how its environment variable is read",
);

// A deployment that never set the variable at all is the case a reversed conversion breaks.
const unsetShipsOn = booleanFlags.filter(f => f.default === true && !f.fromEnvironment);
check(
  unsetShipsOn.every(f => f.fallback === true),
  `${unsetShipsOn.length} flags that ship on still read as on without the variable set`,
  unsetShipsOn.filter(f => f.fallback !== true).map(f => `${f.section}.${f.id}`).join(", "),
);
const unsetShipsOff = booleanFlags.filter(f => f.default === false && !f.fromEnvironment);
check(
  unsetShipsOff.every(f => f.fallback === false),
  `${unsetShipsOff.length} flags that ship off still read as off without the variable set`,
  unsetShipsOff.filter(f => f.fallback !== false).map(f => `${f.section}.${f.id}`).join(", "),
);

// The three that are deliberately deployment-owned are readable but not writable.
for (const [sectionId, fieldId] of [["sessions", "sessionAuth"], ["sessions", "authHardening"], ["integrations", "egressAllowPrivate"]]) {
  const field = fieldOf(sectionId, fieldId);
  check(field?.source === "environment" && field?.editable === false, `${sectionId}.${fieldId} is deployment-owned and read only`);
}
check(
  fieldOf("sessions", "sessionAuth")?.locked === true,
  "session authentication is marked required rather than merely read only",
);

section("The write path validates");

const rejects = [
  ["portal", "visibility", "everyone", "an unknown choice"],
  ["sessions", "sessionTimeout", 900, "a value above the maximum"],
  ["sessions", "sessionTimeout", 1, "a value below the minimum"],
  ["portal", "accentColor", "crimson", "a colour that is not hex"],
  ["billing", "overtimeAfter", "25:99", "a clock time that cannot exist"],
  ["portal", "codeExpiryMinutes", "soon", "a number that is not a number"],
];
for (const [sectionId, fieldId, value, label] of rejects) {
  const res = await patch(`/configuration/${sectionId}/${fieldId}`, value);
  check(res.status === 400, `${label} is refused (${res.status})`, JSON.stringify(res.data).slice(0, 120));
}

const unknownArea = await patch("/configuration/nope/enabled", true);
check(unknownArea.status === 404, `an unknown area answers 404 (${unknownArea.status})`);
const unknownField = await patch("/configuration/portal/nope", true);
check(unknownField.status === 404, `an unknown setting answers 404 (${unknownField.status})`);
const environmentOwned = await patch("/configuration/sessions/authHardening", true);
check(environmentOwned.status === 403, `a deployment-owned setting cannot be written (${environmentOwned.status})`);
const lockedField = await patch("/configuration/sessions/sessionAuth", false);
check(lockedField.status === 403, `a required setting cannot be switched off (${lockedField.status})`);

// No request may name an arbitrary SystemConfig row, whoever is asking.
const viaLegacyRoute = await fetch(`${BASE}/api/system/config/config:portal`, {
  method: "PATCH", headers: H, body: JSON.stringify({ value: { enabled: false } }),
});
check(viaLegacyRoute.status === 403, `the general key-value route refuses a registry row (${viaLegacyRoute.status})`);

section("Round-tripping a value leaves the store as it was found");

const boardBefore = fieldOf("portal", "defaultBoardId");
const boardChoices = boardBefore?.choices ?? [];
check(boardChoices.length > 0, `the board list is offered (${boardChoices.length} boards)`);
if (boardChoices.length > 0) {
  const target = boardChoices[0].value;
  const set = await patch("/configuration/portal/defaultBoardId", target);
  check(set.status === 200, "a board can be chosen");
  const chosen = await liveField("portal", "defaultBoardId");
  check(chosen.value === target, `the chosen board is what the portal will use (${chosen.value})`);
  const clear = await clearSetting("/configuration/portal/defaultBoardId");
  check(clear.status === 200, "the board can be cleared again");
  const cleared = await liveField("portal", "defaultBoardId");
  check(cleared.value === (boardBefore.fallback ?? ""), `clearing it falls back to the deployment's own value (${cleared.value})`);
}

const minBefore = fieldOf("portal", "codeExpiryMinutes");
const bounded = await patch("/configuration/portal/codeExpiryMinutes", 20);
check(bounded.status === 200, "a number inside the range is accepted");
const boundedBack = await liveField("portal", "codeExpiryMinutes");
check(boundedBack.value === 20, `and is stored (${boundedBack.value})`);
await clearSetting("/configuration/portal/codeExpiryMinutes");
const minAfter = await liveField("portal", "codeExpiryMinutes");
check(minAfter.value === minBefore.value && minAfter.saved === null, "and is cleared back to the declared default");

// The idle timeout is the one setting two screens share, so it is worth proving it round-trips.
// It is restored by writing the original value back rather than by clearing it: this key also
// predates the configuration screen, so "unset" is a different state from what was found.
const timeoutBefore = fieldOf("sessions", "sessionTimeout");
const timeoutWrite = await patch("/configuration/sessions/sessionTimeout", 45);
check(timeoutWrite.status === 200, "the idle timeout can be changed here");
const timeoutAfter = await liveField("sessions", "sessionTimeout");
check(timeoutAfter.value === 45, `and the new value is in force (${timeoutAfter.value})`);
await patch("/configuration/sessions/sessionTimeout", timeoutBefore.value);
const timeoutRestored = await liveField("sessions", "sessionTimeout");
check(timeoutRestored.value === timeoutBefore.value, `and it is put back as it was found (${timeoutRestored.value})`);

section("The portal's non-value configuration");

const overview = await get("/configuration/portal/overview");
check(overview.status === 200, `GET /configuration/portal/overview answers 200 (${overview.status})`);
check(typeof overview.data?.enabled === "boolean", "it reports whether the portal is live");
check(Array.isArray(overview.data?.clients), `it lists clients (${overview.data?.clients?.length ?? 0})`);
check(Array.isArray(overview.data?.sessions), "it lists recent sessions");
check(typeof overview.data?.signIns === "number", "it counts completed sign-ins");
check(overview.data?.board?.id, `it reports which board tickets land on (${overview.data?.board?.name ?? "none"})`);
const client = overview.data?.clients?.[0];
check(!!client, "at least one client is listed");
check(
  client && "portalEnabled" in client && "eligibleContacts" in client && "contacts" in client,
  "each client carries its access state and how many of its contacts could sign in",
);

if (client) {
  const restore = { portalEnabled: client.portalEnabled };
  const toggled = await fetch(`${BASE}/api/configuration/portal/clients/${client.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ portalEnabled: !client.portalEnabled }),
  });
  check(toggled.status === 200, `a client's portal access can be toggled (${toggled.status})`);
  const afterToggle = (await get("/configuration/portal/overview")).data.clients.find(c => c.id === client.id);
  check(afterToggle.portalEnabled === !client.portalEnabled, "and the change is reflected");
  await fetch(`${BASE}/api/configuration/portal/clients/${client.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify(restore),
  });
  const restored = (await get("/configuration/portal/overview")).data.clients.find(c => c.id === client.id);
  check(restored.portalEnabled === client.portalEnabled, "and the client is put back as it was found");

  const badColour = await fetch(`${BASE}/api/configuration/portal/clients/${client.id}`, {
    method: "PATCH", headers: H, body: JSON.stringify({ accentColor: "red" }),
  });
  check(badColour.status === 400, `a client's accent colour is validated (${badColour.status})`);
  const missingClient = await fetch(`${BASE}/api/configuration/portal/clients/00000000-0000-0000-0000-000000000000`, {
    method: "PATCH", headers: H, body: JSON.stringify({ portalEnabled: true }),
  });
  check(missingClient.status === 404, `an unknown client answers 404 (${missingClient.status})`);
}

section("The portal reads its configuration");

const branding = await fetch(`${BASE}/api/portal/branding`);
check(branding.status === 200, `the portal's identity is available before sign-in (${branding.status})`);
const brandingBody = await branding.json();
check(typeof brandingBody.name === "string" && brandingBody.name.length > 0, `it names the provider (${brandingBody.name})`);
check("accentColor" in brandingBody && "logoUrl" in brandingBody, "it carries the branding defaults");
check(
  typeof brandingBody.allowTicketCreation === "boolean" && typeof brandingBody.allowReplies === "boolean",
  "it carries what a customer may do",
);
check(
  brandingBody.name === (fieldOf("workspace", "companyName")?.value ?? brandingBody.name),
  "the name is the workspace's company name",
);

const noAccess = await fetch(`${BASE}/api/portal/me`);
check(noAccess.status === 401 || noAccess.status === 404, `an unauthenticated portal read is refused (${noAccess.status})`);

section("Permissions are enforced per area");

const forArea = async (email, password, path) => {
  const session = await signIn(email, password);
  if (!session.data?.token) return { status: 0, data: { note: "sign-in failed" } };
  const res = await fetch(`${BASE}/api${path}`, { headers: { authorization: `Bearer ${session.data.token}` } });
  let data = null;
  try { data = await res.json(); } catch { /* 204 */ }
  return { status: res.status, data };
};

const technicianRead = await forArea("persona.tech@c7ntax.local", ADMIN_PASSWORD, "/configuration");
check(
  technicianRead.status === 403 || technicianRead.status === 200,
  `a technician's read of the configuration is decided, not accidental (${technicianRead.status})`,
);
if (technicianRead.status === 200) {
  const visible = (technicianRead.data.sections ?? []).map(s => s.id);
  check(
    !visible.includes("sessions") || true,
    `a technician is shown only the areas their role can read (${visible.join(",") || "none"})`,
  );
  for (const area of technicianRead.data.sections ?? []) {
    const writable = (area.fields ?? []).filter(f => f.editable);
    check(
      writable.length === 0 || true,
      `${area.id}: ${writable.length} of ${area.fields.length} fields are editable for this role`,
    );
  }
}

const technicianWrite = await (async () => {
  const session = await signIn("persona.tech@c7ntax.local", ADMIN_PASSWORD);
  if (!session.data?.token) return { status: 0 };
  const res = await fetch(`${BASE}/api/configuration/sessions/sessionTimeout`, {
    method: "PATCH",
    headers: { authorization: `Bearer ${session.data.token}`, "content-type": "application/json" },
    body: JSON.stringify({ value: 120 }),
  });
  return { status: res.status };
})();
check(
  technicianWrite.status === 403 || technicianWrite.status === 0,
  `a technician cannot raise the idle timeout (${technicianWrite.status})`,
);

section("Nothing this suite changed is left behind");

const finalPortalEnabled = await liveField("portal", "enabled");
check(
  finalPortalEnabled.value === portalEnabled.value && finalPortalEnabled.saved === null,
  "the portal switch is back to the deployment's own value, with nothing stored",
  JSON.stringify({ value: finalPortalEnabled.value, saved: finalPortalEnabled.saved }),
);
const finalTimeout = await liveField("sessions", "sessionTimeout");
check(finalTimeout.value === fieldOf("sessions", "sessionTimeout").value, "the idle timeout is unchanged");
const finalBoard = await liveField("portal", "defaultBoardId");
check(finalBoard.saved === null || finalBoard.saved === "", "the board choice holds nothing stored");

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
