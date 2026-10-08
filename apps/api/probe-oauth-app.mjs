/**
 * Deploy OAuth app (the wizard behind the Microsoft 365 email connector).
 *
 * The real thing needs a Microsoft 365 tenant and an administrator, so the vendor is stood in for:
 * an HTTP server that implements the device-code endpoint, the token endpoint and the handful of
 * Graph calls the deployment makes, and records every request it receives. That is what makes the
 * assertions below possible — not "the wizard returned 201" but "Graph was asked for the
 * *application* Mail.ReadWrite role id, consent was granted with all three ids, and the secret it
 * minted expires when it says it does".
 *
 * The API has to be pointed at the stub, because the base URLs are read when the process starts:
 *
 *     cd apps/api
 *     $env:GRAPH_TOKEN_BASE = "http://127.0.0.1:4567"
 *     $env:GRAPH_API_BASE   = "http://127.0.0.1:4567/v1.0"
 *     pnpm exec tsx src/index.ts
 *
 * Run from apps/api:  node probe-oauth-app.mjs
 */
import { createServer } from "node:http";

const API = process.env.C7_API_BASE || "http://127.0.0.1:4000";
const STUB_PORT = Number(process.env.C7_STUB_PORT || 4567);
const PW = "Persona-Dev-Only-2026!";
const ADMIN = "persona.admin@c7ntax.local";
const READONLY = "persona.readonly@c7ntax.local";

let pass = 0;
let fail = 0;
const check = (ok, label, extra = "") => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}${extra ? ` — ${extra}` : ""}`); }
};

// ── The stub tenant ─────────────────────────────────────────────────────────

const stub = {
  calls: [],
  /** How many token polls answer `authorization_pending` before the sign-in is approved. */
  pendingPolls: 1,
  /** Set by a test to make the next sign-in be declined in the browser. */
  decline: false,
  /** Applications the tenant already has. */
  applications: [],
  /** Service principals the tenant already has. Creating an application does not create one. */
  servicePrincipals: [],
  secrets: [],
  consented: [],
  grants: [],
  reset() {
    this.calls = [];
    this.pendingPolls = 1;
    this.decline = false;
    this.applications = [];
    this.servicePrincipals = [];
    this.secrets = [];
    this.consented = [];
    this.grants = [];
  },
};

/** A JWT is only ever read for its claims here, so the signature is decoration. */
function fakeJwt(claims) {
  const part = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "none", typ: "JWT" })}.${part(claims)}.signature`;
}

let counter = 0;
const newId = (prefix) => `${prefix}-${(++counter).toString().padStart(4, "0")}`;

function json(res, status, body) {
  const text = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw) return {};
  if ((req.headers["content-type"] || "").includes("json")) {
    try { return JSON.parse(raw); } catch { return { _raw: raw }; }
  }
  return Object.fromEntries(new URLSearchParams(raw));
}

async function handle(req, res) {
  const url = new URL(req.url, `http://127.0.0.1:${STUB_PORT}`);
  const path = url.pathname;
  const body = await readBody(req);
  stub.calls.push({ method: req.method, path, query: url.search, auth: Boolean(req.headers.authorization), body });

  // ── Sign-in: the device code, then the token poll ──────────────────────────
  if (path.endsWith("/oauth2/v2.0/devicecode")) {
    const tenant = path.split("/")[1] ?? "";
    if (tenant === "unknown-tenant") {
      return json(res, 400, { error: "invalid_request", error_description: "AADSTS90002: Tenant 'unknown-tenant' not found." });
    }
    return json(res, 200, {
      device_code: "device-code-123",
      user_code: "ABCD-EFGH",
      verification_uri: `http://127.0.0.1:${STUB_PORT}/devicelogin`,
      verification_uri_complete: `http://127.0.0.1:${STUB_PORT}/devicelogin?code=ABCD-EFGH`,
      message: "To sign in, use a web browser to open the page and enter the code ABCD-EFGH.",
      expires_in: 900,
      interval: 1,
    });
  }

  if (path.endsWith("/oauth2/v2.0/token")) {
    if (body.grant_type !== "urn:ietf:params:oauth:grant-type:device_code") {
      return json(res, 400, { error: "unsupported_grant_type", error_description: `unexpected grant_type ${body.grant_type}` });
    }
    if (stub.decline) {
      stub.decline = false;
      return json(res, 400, { error: "authorization_declined", error_description: "The user declined the request." });
    }
    if (stub.pendingPolls > 0) {
      stub.pendingPolls--;
      return json(res, 400, { error: "authorization_pending", error_description: "The user has not yet approved." });
    }
    return json(res, 200, {
      token_type: "Bearer",
      expires_in: 3600,
      access_token: fakeJwt({ tid: "tenant-id-from-claims", upn: "admin@contoso.com", appid: "14d82eec-204b-4c2f-b7e8-296a70dab67e" }),
    });
  }

  // ── Everything below is Graph, and every call is expected to be authorised ─
  if (!path.startsWith("/v1.0/")) return json(res, 404, { error: { message: `no stub route for ${req.method} ${path}` } });
  if (!req.headers.authorization) return json(res, 401, { error: { message: "no token" } });
  const sub = path.slice("/v1.0".length);

  if (sub === "/applications" && req.method === "GET") {
    const filter = url.searchParams.get("$filter") ?? "";
    const wanted = /displayName eq '([^']+)'/.exec(filter)?.[1] ?? "";
    return json(res, 200, { value: stub.applications.filter((a) => a.displayName === wanted) });
  }

  if (sub === "/applications" && req.method === "POST") {
    const app = {
      id: newId("object"),
      appId: `11111111-2222-3333-4444-${String(++counter).padStart(12, "0")}`,
      displayName: body.displayName,
    };
    stub.applications.push(app);
    return json(res, 201, app);
  }

  const appPatch = /^\/applications\/([^/]+)$/.exec(sub);
  if (appPatch && req.method === "PATCH") {
    const app = stub.applications.find((a) => a.id === appPatch[1]);
    if (!app) return json(res, 404, { error: { message: "no such application" } });
    return json(res, 204, null);
  }

  const addPassword = /^\/applications\/([^/]+)\/addPassword$/.exec(sub);
  if (addPassword && req.method === "POST") {
    const app = stub.applications.find((a) => a.id === addPassword[1]);
    if (!app) return json(res, 404, { error: { message: "no such application" } });
    const secret = {
      appId: app.appId,
      displayName: body.passwordCredential?.displayName ?? "",
      endDateTime: body.passwordCredential?.endDateTime ?? "",
      secretText: `stub-secret-${stub.secrets.length + 1}-${"x".repeat(30)}`,
    };
    stub.secrets.push(secret);
    return json(res, 200, { ...secret, keyId: newId("key") });
  }

  if (sub === "/servicePrincipals" && req.method === "GET") {
    const appId = /appId eq '([^']+)'/.exec(url.searchParams.get("$filter") ?? "")?.[1] ?? "";
    // Graph's own principal is always there. An application's is *not* created with the application
    // in Entra — it appears at first consent or when it is posted explicitly, which is why the
    // deployment posts one rather than assuming.
    if (appId === "00000003-0000-0000-c000-000000000000") return json(res, 200, { value: [{ id: "graph-sp-id", appId }] });
    return json(res, 200, { value: stub.servicePrincipals.filter((sp) => sp.appId === appId) });
  }

  if (sub === "/servicePrincipals" && req.method === "POST") {
    const app = stub.applications.find((a) => a.appId === body.appId);
    if (!app) return json(res, 400, { error: { message: "appId does not exist" } });
    const sp = { id: `sp-${app.appId.slice(-4)}`, appId: app.appId };
    stub.servicePrincipals.push(sp);
    return json(res, 201, sp);
  }

  const consent = /^\/servicePrincipals\/([^/]+)\/appRoleAssignedTo$/.exec(sub);
  if (consent && req.method === "POST") {
    if (consent[1] !== "graph-sp-id") return json(res, 404, { error: { message: "not the Graph service principal" } });
    const duplicate = stub.consented.some((c) => c.principalId === body.principalId && c.appRoleId === body.appRoleId);
    if (duplicate) return json(res, 400, { error: { message: "Permission being added already exists." } });
    stub.consented.push({ principalId: body.principalId, resourceId: body.resourceId, appRoleId: body.appRoleId });
    return json(res, 201, { id: newId("assign") });
  }

  if (sub === "/oauth2PermissionGrants" && req.method === "GET") {
    const clientId = /clientId eq '([^']+)'/.exec(url.searchParams.get("$filter") ?? "")?.[1] ?? "";
    return json(res, 200, { value: stub.grants.filter((g) => g.clientId === clientId).map((g, i) => ({ id: `grant-${i + 1}`, ...g })) });
  }

  if (sub === "/oauth2PermissionGrants" && req.method === "POST") {
    stub.grants.push({ clientId: body.clientId, resourceId: body.resourceId, scope: body.scope, consentType: body.consentType });
    return json(res, 201, { id: newId("grant") });
  }

  const grantPatch = /^\/oauth2PermissionGrants\/([^/]+)$/.exec(sub);
  if (grantPatch && req.method === "PATCH") {
    const grant = stub.grants[0];
    if (grant) grant.scope = body.scope;
    return json(res, 200, { id: grantPatch[1], ...(grant ?? {}) });
  }

  return json(res, 404, { error: { message: `no stub route for ${req.method} ${sub}` } });
}

// ── Talking to the API ──────────────────────────────────────────────────────
async function call(method, path, opts = {}) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: { "content-type": "application/json", ...(opts.token ? { authorization: `Bearer ${opts.token}` } : {}) },
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

async function signIn(email) {
  const res = await fetch(`${API}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  const data = await res.json().catch(() => ({}));
  return data.token ?? null;
}

/** Run a deployment as far as `authorized`, so the deploy step can be exercised on its own. */
async function authorisedSession(token, opts) {
  const started = await call("POST", "/api/oauth-app/start", {
    token,
    body: {
      tenant: opts.tenant ?? "contoso.onmicrosoft.com",
      mode: opts.mode,
      mailbox: opts.mailbox,
      displayName: opts.displayName ?? "C7NTAX Email Connector",
    },
  });
  if (started.status !== 201) return { started, first: null, authorised: null };
  const first = await call("POST", `/api/oauth-app/${started.data.sessionId}/poll`, { token });
  const authorised = await call("POST", `/api/oauth-app/${started.data.sessionId}/poll`, { token });
  return { started, first, authorised };
}

async function main() {
  const admin = await signIn(ADMIN);
  const readonly = await signIn(READONLY);
  check(Boolean(admin), "an administrator can sign in");

  // Everything the run writes is after this moment, which is how the audit assertions below can
  // ignore rows that were already there.
  const boundary = new Date(Date.now() - 1000).toISOString();

  const facts = await call("GET", "/api/oauth-app", { token: admin });
  if (facts.status !== 200) {
    console.log(`The API did not answer ${API}/api/oauth-app (status ${facts.status}).`);
    console.log("Start it pointed at this stub: GRAPH_TOKEN_BASE / GRAPH_API_BASE (see the header of this file).");
    process.exit(1);
  }

  console.log("\nWiring");
  check(String(facts.data.tokenBase).includes(`127.0.0.1:${STUB_PORT}`), "the API is pointed at the stub tenant", String(facts.data.tokenBase));
  check(JSON.stringify(facts.data.permissions.application) === JSON.stringify(["Mail.ReadWrite"]), "the application permission is Mail.ReadWrite, not Mail.Read");
  check(facts.data.permissions.delegated.includes("User.Read") && facts.data.permissions.delegated.includes("offline_access"), "the delegated permission set includes User.Read and offline_access");
  check(String(facts.data.redirectUri).endsWith("/api/email-connectors/oauth/callback"), "the redirect URI is the connector's own callback", String(facts.data.redirectUri));
  check(facts.data.defaultDisplayName === "C7NTAX Email Connector", "the default registration name matches the script's", String(facts.data.defaultDisplayName));
  check(String(facts.data.script.command).includes("New-C7NTAXMailboxApp.ps1"), "the by-hand command names the script that already exists");

  console.log("\nRefusals");
  check((await call("GET", "/api/oauth-app")).status === 401, "the wizard API needs a session at all");
  if (readonly) check((await call("GET", "/api/oauth-app", { token: readonly })).status === 403, "a user without integration:manage is refused");
  check((await call("POST", "/api/oauth-app/start", { token: admin, body: { tenant: "", mode: "AppOnly" } })).status === 400, "a deployment with no tenant is refused");
  const unknown = await call("POST", "/api/oauth-app/start", { token: admin, body: { tenant: "unknown-tenant", mode: "AppOnly" } });
  check(unknown.status === 400 && /not found/i.test(String(unknown.data.error?.message)), "an unknown tenant is named as the problem", JSON.stringify(unknown.data).slice(0, 120));
  check((await call("GET", "/api/oauth-app/11111111-1111-1111-1111-111111111111", { token: admin })).status === 410, "an unknown session is gone, not a 500");
  check((await call("POST", "/api/oauth-app/11111111-1111-1111-1111-111111111111/deploy", { token: admin })).status === 410, "deploying an unknown session is refused");

  console.log("\nApp-only: sign in, then deploy");
  stub.reset();
  const { started, first, authorised } = await authorisedSession(admin, { mode: "AppOnly", mailbox: "servicedesk@contoso.com" });
  check(started.status === 201 && started.data.userCode === "ABCD-EFGH", "the sign-in start returns the code the person types", JSON.stringify(started.data).slice(0, 120));
  check(first.status === 200 && first.data.status === "pending", "an unapproved sign-in polls as pending");
  check(authorised.status === 200 && authorised.data.status === "authorized", "approving the code authorises the deployment", JSON.stringify(authorised.data));
  check(authorised.data.account === "admin@contoso.com" && authorised.data.tenantId === "tenant-id-from-claims", "the account and tenant come from the token's own claims");
  const deviceCall = stub.calls.find((c) => c.path.endsWith("/oauth2/v2.0/devicecode"));
  check(deviceCall?.body.client_id === "14d82eec-204b-4c2f-b7e8-296a70dab67e", "sign-in uses the public Graph command-line client, so no secret is held");
  check(deviceCall?.body.scope === "https://graph.microsoft.com/.default", "sign-in asks for the registration scopes it needs and no more");

  const deployed = await call("POST", `/api/oauth-app/${started.data.sessionId}/deploy`, { token: admin });
  check(deployed.status === 201, "the deployment completes", JSON.stringify(deployed.data).slice(0, 200));
  const result = deployed.data;
  check(result.tenantId === "tenant-id-from-claims", "the result carries the tenant Microsoft resolved");
  check(Boolean(result.clientId) && Boolean(result.clientSecret), "a client id and a secret came back");
  check(result.reusedRegistration === false, "the first run creates the registration");
  check(JSON.stringify(result.permissions.application) === JSON.stringify(["Mail.ReadWrite"]), "the result names the application permission granted");

  const createCall = stub.calls.find((c) => c.path === "/v1.0/applications" && c.method === "POST");
  check(createCall?.body.displayName === "C7NTAX Email Connector", "the registration is created with the name the wizard showed");
  check(createCall?.body.signInAudience === "AzureADMyOrg" && createCall?.body.isFallbackPublicClient === false, "it is single-tenant, and not a public client when it holds a secret");
  const permissionPatch = stub.calls.find((c) => /^\/v1\.0\/applications\/object-\d+$/.test(c.path) && c.body.requiredResourceAccess);
  check(
    permissionPatch?.body.requiredResourceAccess?.[0]?.resourceAppId === "00000003-0000-0000-c000-000000000000" &&
      permissionPatch?.body.requiredResourceAccess?.[0]?.resourceAccess?.[0]?.id === "e2a3a72e-5f79-4c64-b1b1-878b674786c9" &&
      permissionPatch?.body.requiredResourceAccess?.[0]?.resourceAccess?.[0]?.type === "Role",
    "Graph is asked for the application role id of Mail.ReadWrite",
    JSON.stringify(permissionPatch?.body).slice(0, 200),
  );
  check(!permissionPatch?.body.web, "app-only asks for no redirect URI, because it never signs a person in");
  check(stub.calls.some((c) => c.path === "/v1.0/servicePrincipals" && c.method === "POST"), "a service principal is created, without which consent has nothing to point at");
  check(stub.consented.length === 1 && stub.consented[0].appRoleId === "e2a3a72e-5f79-4c64-b1b1-878b674786c9", "admin consent is granted with the app's principal, Graph's resource and the role id");
  check(stub.consented[0]?.resourceId === "graph-sp-id" && String(stub.consented[0]?.principalId).startsWith("sp-"), "both the principal and the resource id are the ones Graph returned");
  check(stub.grants.length === 0, "app-only asks for no delegated grant");
  const secretCall = stub.secrets[0];
  const monthsAhead = (new Date(secretCall.endDateTime).getTime() - Date.now()) / (30 * 24 * 3600 * 1000);
  check(monthsAhead > 11.5 && monthsAhead < 12.5, "the secret is minted for the configured twelve months", `${monthsAhead.toFixed(2)} months`);
  check(String(result.secretExpiry).slice(0, 10) === secretCall.endDateTime.slice(0, 10), "the expiry returned is the expiry Graph gave");
  check(String(result.scopingCommands).includes("New-ServicePrincipal") && String(result.scopingCommands).includes(result.clientId), "the Exchange Online commands name the app that was just created");
  check(result.warnings.some((w) => /scop|EVERY mailbox/.test(w)), "the unscoped-app warning is carried to the wizard", result.warnings.join(" | ").slice(0, 140));

  console.log("\nRunning it again reuses the registration");
  const second = await authorisedSession(admin, { mode: "AppOnly", mailbox: "servicedesk@contoso.com" });
  check(second.authorised?.data.status === "authorized", "a second sign-in authorises");
  const spPostsBefore = stub.calls.filter((c) => c.path === "/v1.0/servicePrincipals" && c.method === "POST").length;
  const redeployed = await call("POST", `/api/oauth-app/${second.started.data.sessionId}/deploy`, { token: admin });
  check(redeployed.status === 201 && redeployed.data.reusedRegistration === true, "the second run reuses the registration rather than duplicating it");
  check(redeployed.data.objectId === deployed.data.objectId, "the reused registration is the same object");
  check(stub.applications.length === 1, "the tenant still has exactly one registration", String(stub.applications.length));
  check(stub.calls.filter((c) => c.path === "/v1.0/servicePrincipals" && c.method === "POST").length === spPostsBefore, "a second service principal is not created");
  check(stub.consented.length === 1, "consent already granted is not treated as a failure", String(stub.consented.length));

  console.log("\nDelegated: the redirect URI, no secret");
  stub.reset();
  const delegated = await authorisedSession(admin, { mode: "Delegated" });
  const delegatedDeploy = await call("POST", `/api/oauth-app/${delegated.started.data.sessionId}/deploy`, { token: admin });
  check(delegatedDeploy.status === 201, "a delegated deployment completes", JSON.stringify(delegatedDeploy.data).slice(0, 200));
  check(delegatedDeploy.data.clientSecret === null, "no client secret is created for the delegated flow");
  check(delegatedDeploy.data.scopingCommands === null, "no mailbox scoping is offered, because a delegated token reaches one mailbox");
  check(delegatedDeploy.data.redirectUri === facts.data.redirectUri, "the redirect URI it registered is this instance's own");
  const delegatedPatch = stub.calls.find((c) => /^\/v1\.0\/applications\/object-\d+$/.test(c.path) && c.body.requiredResourceAccess);
  check(delegatedPatch?.body.web?.redirectUris?.[0] === facts.data.redirectUri, "Graph is given the redirect URI, without which sign-in fails with AADSTS500113", JSON.stringify(delegatedPatch?.body?.web));
  const types = (delegatedPatch?.body.requiredResourceAccess?.[0]?.resourceAccess ?? []).map((a) => a.type);
  check(types.length === 2 && types.every((t) => t === "Scope"), "the delegated permissions are requested as scopes, not roles", JSON.stringify(types));
  check((delegatedPatch?.body.requiredResourceAccess?.[0]?.resourceAccess ?? []).some((a) => a.id === "024d486e-b451-40bb-833d-3e66d98c5c73"), "the delegated Mail.ReadWrite scope id is used (a different GUID to the role)");
  check(stub.grants.length === 1 && stub.grants[0].scope === "Mail.ReadWrite User.Read" && stub.grants[0].consentType === "AllPrincipals", "the delegated consent is granted for exactly those scopes, tenant-wide", JSON.stringify(stub.grants));
  check(stub.secrets.length === 0, "nothing was minted for the delegated registration");
  check(stub.consented.length === 0, "no application role was consented for a delegated-only registration");
  check(delegatedDeploy.data.permissions.delegated.includes("offline_access"), "offline_access is reported as consented at sign-in");

  console.log("\nThe script's output, for a tenant this instance cannot sign in to");
  const scriptJson = JSON.stringify({
    objectId: "script-object",
    clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
    secret: `script-secret-${"y".repeat(30)}`,
    secretExpiry: "2027-10-08T00:00:00Z",
    tenantId: "contoso.onmicrosoft.com",
    displayName: "C7NTAX Email Connector",
    mode: "AppOnly",
    permissions: { application: ["Mail.ReadWrite"], delegated: ["Mail.ReadWrite", "User.Read", "offline_access"] },
    createdAt: "2026-10-08T00:00:00Z",
  });
  const imported = await call("POST", "/api/oauth-app/import", { token: admin, body: { scriptJson } });
  check(imported.status === 200 && imported.data.source === "script", "the script's JSON is read");
  check(imported.data.tenantId === "contoso.onmicrosoft.com" && imported.data.clientId === "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", "the tenant and client id come out of it");
  check(String(imported.data.clientSecret).startsWith("script-secret-"), "the secret comes out of it");
  check(imported.data.mode === "AppOnly", "so does the mode it was created for");
  check(imported.data.warnings.some((w) => /scoping/.test(w)), "it warns that the Exchange scoping still has to be confirmed");

  const manual = await call("POST", "/api/oauth-app/import", {
    token: admin,
    body: { tenantId: "contoso.onmicrosoft.com", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", clientSecret: "typed-secret", mailbox: "servicedesk@contoso.com", mode: "AppOnly" },
  });
  check(manual.status === 200 && manual.data.source === "values", "the four values can be typed instead");

  console.log("\nRefusals worth naming");
  const notJson = await call("POST", "/api/oauth-app/import", { token: admin, body: { scriptJson: "not json at all" } });
  check(notJson.status === 400 && /JSON/.test(String(notJson.data.error?.message)), "a paste that is not the script's JSON is refused as such");
  const notGuid = await call("POST", "/api/oauth-app/import", { token: admin, body: { tenantId: "contoso.onmicrosoft.com", clientId: "contoso.onmicrosoft.com" } });
  check(notGuid.status === 400 && /GUID/.test(String(notGuid.data.error?.message)), "a client id that is not a GUID is named as the problem");
  const readOnly = await call("POST", "/api/oauth-app/import", {
    token: admin,
    body: { scriptJson: JSON.stringify({ tenantId: "contoso.onmicrosoft.com", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", secret: "s", mode: "AppOnly", permissions: { application: ["Mail.Read"] } }) },
  });
  check(readOnly.status === 400 && /Mail\.ReadWrite/.test(String(readOnly.data.error?.message)), "a registration granted Mail.Read instead of Mail.ReadWrite is refused with the reason");
  const noSecret = await call("POST", "/api/oauth-app/import", { token: admin, body: { tenantId: "contoso.onmicrosoft.com", clientId: "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee", mode: "AppOnly", mailbox: "x@y.com" } });
  check(noSecret.status === 200 && noSecret.data.warnings.some((w) => /secret/.test(w)), "an app-only import with no secret warns rather than pretending");

  console.log("\nDeclining in the browser");
  stub.reset();
  const declined = await call("POST", "/api/oauth-app/start", { token: admin, body: { tenant: "contoso.onmicrosoft.com", mode: "AppOnly", mailbox: "servicedesk@contoso.com" } });
  stub.decline = true;
  const declinedPoll = await call("POST", `/api/oauth-app/${declined.data.sessionId}/poll`, { token: admin });
  check(declinedPoll.status === 200 && declinedPoll.data.status === "declined", "a declined sign-in is reported as declined, not as an error", JSON.stringify(declinedPoll.data));
  const afterDecline = await call("POST", `/api/oauth-app/${declined.data.sessionId}/deploy`, { token: admin });
  check(afterDecline.status === 409, "deploying after a declined sign-in is refused");

  console.log("\nDeploying before signing in");
  const early = await call("POST", "/api/oauth-app/start", { token: admin, body: { tenant: "contoso.onmicrosoft.com", mode: "AppOnly", mailbox: "servicedesk@contoso.com" } });
  const earlyDeploy = await call("POST", `/api/oauth-app/${early.data.sessionId}/deploy`, { token: admin });
  check(earlyDeploy.status === 409, "the deployment cannot run before the sign-in is approved", String(earlyDeploy.status));
  const earlyState = await call("GET", `/api/oauth-app/${early.data.sessionId}`, { token: admin });
  check(earlyState.status === 200 && earlyState.data.status === "pending" && earlyState.data.mode === "AppOnly", "the session can be read back without asking Microsoft anything");

  console.log("\nThe trail");
  const audit = await call("GET", "/api/system/audit-logs?limit=200", { token: admin });
  const rows = audit.data.data ?? audit.data ?? [];
  const blob = JSON.stringify(rows);
  check(blob.includes("oauth_app.deployed"), "a deployment is written to the audit log");
  check(blob.includes("oauth_app.imported"), "an import is written to the audit log");
  // Only the rows this run produced: an older row could only fail for reasons that are not this
  // deployment's, and a stale row in a development database is not evidence about this code.
  const mine = rows.filter((row) => row.createdAt && row.createdAt >= boundary);
  const withSecret = mine.filter((row) => /stub-secret|script-secret/.test(JSON.stringify(row)));
  check(withSecret.length === 0, "no secret value reaches the audit log", withSecret.map((r) => r.action).join(", "));
  check(mine.some((row) => row.entity === "oauth_app"), "the deployment rows name the entity they are about");
}

const server = createServer((req, res) => { void handle(req, res); });

await new Promise((resolve) => server.listen(STUB_PORT, "127.0.0.1", resolve));
console.log(`stub Microsoft listening on http://127.0.0.1:${STUB_PORT} — API under test: ${API}`);

try {
  await main();
} catch (e) {
  fail++;
  console.log(`  FAIL  threw: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  console.log(`\n${pass} passed, ${fail} failed`);
  server.close();
  process.exit(fail ? 1 : 0);
}
