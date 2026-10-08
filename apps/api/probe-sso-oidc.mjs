/**
 * Single sign-on (OIDC) — the configuration screen, and the handshake it configures.
 *
 * The switch in System Settings said "Single sign-on (OIDC)" long before anything behind it could
 * be configured: the provider lived in environment variables, the toggle wrote a stored value
 * nothing read, and the `SsoConfig` rows the API exposed were never consulted. This probe covers
 * both halves of what replaced that — that Administration → Single Sign-On stores a provider that
 * takes precedence over the environment and never hands the secret back, and that the handshake
 * then obeys it: the toggle gates the flow, domains restrict who may sign in, provisioning either
 * creates an account or refuses, and an administrator role is never activated automatically.
 *
 * A stub identity provider is started on 127.0.0.1 so the flow can be driven end to end: discovery,
 * an authorization redirect, a token endpoint, and a JWKS that signs a real RS256 ID token.
 *
 * Run the API with:
 *   EGRESS_ALLOW_PRIVATE=true
 * then from apps/api:  node probe-sso-oidc.mjs
 *
 * The private-address allowance is what lets the issuer below sit on 127.0.0.1. The saved
 * provider row, the stored toggle and every account this creates are restored or removed at the
 * end, whether the assertions passed or not.
 */
import { createServer } from "node:http";
import crypto from "node:crypto";
import jwt from "jsonwebtoken";

const BASE = "http://127.0.0.1:4000";
const IDP_PORT = Number(process.env.PROBE_IDP_PORT || 4131);
const ISSUER = `http://127.0.0.1:${IDP_PORT}`;
const CLIENT_ID = "c7ntax-sso-probe";
const CLIENT_SECRET = "probe-secret-not-a-real-one";
const REDIRECT_URI = "http://127.0.0.1:4000/api/auth/sso/oidc/callback";
const PW = "Persona-Dev-Only-2026!";
const MAIL_PREFIX = "probe.sso.";

let pass = 0;
let fail = 0;
/** The last response the probe saw, so a failure can say what it actually got. */
let last = "nothing yet";
const note = (status, data) => { last = `${status} ${JSON.stringify(data ?? {}).slice(0, 240)}`; };
const check = (ok, label) => {
  if (ok) { pass++; console.log(`  ok    ${label}`); }
  else { fail++; console.log(`  FAIL  ${label}`); console.log(`        got: ${last}`); }
};

async function call(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    redirect: "manual",
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json().catch(() => ({}));
  note(res.status, data);
  return { status: res.status, data, headers: res.headers };
}

async function signIn(email) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: PW }),
  });
  return { status: res.status, data: await res.json().catch(() => ({})) };
}

// ── The stub identity provider ──────────────────────────────────────────────────────────────
// One RSA key, so the ID token the API verifies is signed for real rather than trusted.

const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", { modulusLength: 2048 });
const { n, e } = publicKey.export({ format: "jwk" });
const KID = "probe-key-1";
const PUBLIC_JWK = { kty: "RSA", n, e, alg: "RS256", use: "sig", kid: KID };

function startIdp() {
  const codes = new Map();
  const tokens = [];
  const server = createServer((req, res) => {
    const url = new URL(req.url, ISSUER);
    const json = (status, payload) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(payload));
    };

    if (url.pathname === "/.well-known/openid-configuration") {
      return json(200, {
        issuer: ISSUER,
        authorization_endpoint: `${ISSUER}/authorize`,
        token_endpoint: `${ISSUER}/token`,
        jwks_uri: `${ISSUER}/jwks`,
        userinfo_endpoint: `${ISSUER}/userinfo`,
        scopes_supported: ["openid", "email", "profile"],
      });
    }

    if (url.pathname === "/authorize") {
      // `login_hint` stands in for the person typing their address at the provider's own page.
      const email = url.searchParams.get("login_hint") || "";
      const code = crypto.randomBytes(12).toString("hex");
      const redirectUri = url.searchParams.get("redirect_uri") || "";
      codes.set(code, { email, redirectUri, scope: url.searchParams.get("scope") || "" });
      const back = new URL(redirectUri);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state") || "");
      res.writeHead(302, { location: back.toString() });
      return res.end();
    }

    if (url.pathname === "/jwks") return json(200, { keys: [PUBLIC_JWK] });

    if (url.pathname === "/token") {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      return req.on("end", () => {
        const form = new URLSearchParams(body);
        const held = codes.get(form.get("code") || "");
        if (!held) return json(400, { error: "invalid_grant" });
        codes.delete(form.get("code"));
        tokens.push({ ...held, clientId: form.get("client_id"), secret: form.get("client_secret"), redirect: form.get("redirect_uri") });
        const now = Math.floor(Date.now() / 1000);
        const idToken = jwt.sign(
          {
            iss: ISSUER,
            aud: form.get("client_id"),
            sub: `probe|${held.email}`,
            email: held.email,
            name: held.email ? held.email.split("@")[0] : "Probe User",
            iat: now,
            exp: now + 300,
          },
          privateKey.export({ type: "pkcs8", format: "pem" }),
          { algorithm: "RS256", keyid: KID },
        );
        json(200, { access_token: "probe-access-token", token_type: "Bearer", id_token: idToken });
      });
    }

    return json(404, { error: "not_found" });
  });
  return new Promise((resolve) => server.listen(IDP_PORT, "127.0.0.1", () => resolve({ server, tokens, codes })));
}

// ── Driving the handshake ───────────────────────────────────────────────────────────────────

/** start → the provider → the callback → the token. Returns the callback's response. */
async function handshake(email) {
  const started = await fetch(`${BASE}/api/auth/sso/oidc/start`, { redirect: "manual" });
  if (started.status !== 302) {
    return { start: { status: started.status, data: await started.json().catch(() => ({})) }, callback: null, code: null };
  }
  const authorize = new URL(started.headers.get("location"));
  authorize.searchParams.set("login_hint", email);
  const provider = await fetch(authorize, { redirect: "manual" });
  const back = provider.headers.get("location");
  if (!back) return { start: { status: 302 }, callback: null, code: null };

  const callback = await fetch(back, { redirect: "manual" });
  const payload = await callback.json().catch(() => ({}));
  const location = callback.headers.get("location");
  const code = location ? new URL(location).searchParams.get("sso_code") : null;
  return {
    start: { status: 302, authorize: authorize.toString() },
    callback: { status: callback.status, data: payload, location },
    code,
  };
}

/** The whole flow, including swapping the hand-off code for a token. */
async function signInWithProvider(email) {
  const flow = await handshake(email);
  if (!flow.code) { note(flow.callback?.status ?? flow.start.status, flow.callback?.data); return { ...flow, exchange: null }; }
  const exchange = await call("POST", "/api/auth/sso/exchange", { body: { code: flow.code } });
  return { ...flow, exchange };
}

const { PrismaClient } = await import("@prisma/client");
const prisma = new PrismaClient();

/** A refusal's wording, whether the handler threw an AppError or answered with a bare string. */
const messageOf = (data) => (typeof data?.error === "string" ? data.error : data?.error?.message || "");

const { server: idp, tokens: tokenCalls } = await startIdp();

// Snapshot so the probe can put the database back exactly as it found it. The switch lives in the
// `sessions` section's own row, nested by field id.
const priorProviders = await prisma.ssoConfig.findMany();
const priorToggle = await prisma.systemConfig.findUnique({ where: { key: "config:sessions" } });
const readOnly = await prisma.role.findFirst({ where: { systemRole: "read_only" }, select: { id: true, name: true, systemRole: true } });
const adminRole = await prisma.role.findFirst({ where: { systemRole: "admin" }, select: { id: true, name: true } });

const cleanUp = async () => {
  await prisma.user.deleteMany({ where: { email: { startsWith: MAIL_PREFIX } } });
  await prisma.ssoConfig.deleteMany({});
  for (const row of priorProviders) {
    await prisma.ssoConfig.create({ data: { id: row.id, name: row.name, provider: row.provider, isActive: row.isActive, config: row.config, domains: row.domains } });
  }
  if (priorToggle) {
    await prisma.systemConfig.upsert({ where: { key: "config:sessions" }, create: { key: "config:sessions", value: priorToggle.value }, update: { value: priorToggle.value } });
  } else {
    await prisma.systemConfig.deleteMany({ where: { key: "config:sessions" } });
  }
  await prisma.systemConfig.deleteMany({ where: { key: { in: ["sso:oidc_state", "sso:oidc_code"] } } });
};

const saved = async (overrides = {}) =>
  call("PUT", "/api/sso/oidc", {
    token: adminToken,
    body: {
      issuer: ISSUER,
      clientId: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      scopes: "openid email profile",
      redirectUri: REDIRECT_URI,
      domains: [],
      jitProvisioning: true,
      autoActivate: false,
      defaultRoleId: readOnly.id,
      enabled: true,
      ...overrides,
    },
  });

let adminToken = "";
try {
  const admin = await signIn("persona.admin@c7ntax.local");
  adminToken = admin.data?.token || "";
  check(!!adminToken, "an administrator can sign in");

  // ── The screen's reads ──
  const initial = await call("GET", "/api/sso/oidc", { token: adminToken });
  check(initial.status === 200, "the configuration screen can be read");
  check(typeof initial.data.redirectUri === "string" && initial.data.redirectUri.includes("/api/auth/sso/oidc/callback"),
    "the default redirect URI is offered, so it can be registered at the provider");
  check(Array.isArray(initial.data.roles) && initial.data.roles.length > 0, "the roles a new account could be given are offered");
  check(initial.data.roles.some((r) => r.systemRole === "admin" && r.privileged === true),
    "an administrator role is marked as privileged rather than hidden");

  const refused = await call("GET", "/api/sso/oidc", { token: (await signIn("persona.readonly@c7ntax.local")).data?.token });
  check(refused.status === 403, "a user without security:manage cannot read the provider");

  // ── What saving refuses ──
  const noOpenid = await saved({ scopes: "email profile" });
  check(noOpenid.status === 400 && /openid/.test(messageOf(noOpenid.data)), "a scope set without openid is refused");

  const badDomain = await saved({ domains: ["not a domain"] });
  check(badDomain.status === 400 && /domain/.test(messageOf(badDomain.data)), "a domain that is not a domain is refused");

  const badRedirect = await saved({ redirectUri: "not-a-url" });
  check(badRedirect.status === 400, "a redirect URI that is not a URL is refused");

  const autoAdmin = await saved({ autoActivate: true, defaultRoleId: adminRole.id });
  check(autoAdmin.status === 400 && /administrator/.test(messageOf(autoAdmin.data)),
    "an administrator role cannot be granted automatically");

  const onWithNothing = await call("PUT", "/api/sso/oidc", {
    token: adminToken,
    body: { issuer: "", clientId: "", enabled: true, redirectUri: REDIRECT_URI, scopes: "openid email profile" },
  });
  check(onWithNothing.status === 400, "sign-in cannot be switched on before there is a provider to point at");

  // ── The stored provider ──
  const savedOk = await saved();
  check(savedOk.status === 200, "the provider saves");
  check(savedOk.data.settings?.source === "stored", "it is reported as configured here rather than from the environment");
  check(savedOk.data.settings?.enabled === true, "and sign-in is offered");
  check(savedOk.data.settings && !("clientSecret" in savedOk.data.settings), "the response does not contain the client secret");
  check(savedOk.data.settings?.hasSecret === true, "but does say that one is saved");

  const reread = await call("GET", "/api/sso/oidc", { token: adminToken });
  check(reread.data.settings.issuer === ISSUER && reread.data.settings.clientId === CLIENT_ID, "the read returns what was saved");
  check(!("clientSecret" in reread.data.settings), "and still never the secret");

  const discovered = await call("POST", "/api/sso/oidc/discover", { token: adminToken, body: { issuer: ISSUER } });
  check(discovered.status === 200 && discovered.data.tokenEndpoint === `${ISSUER}/token`,
    "the provider's discovery document can be read before saving");
  const discoverFailed = await call("POST", "/api/sso/oidc/discover", { token: adminToken, body: { issuer: "http://127.0.0.1:9/nowhere" } });
  check(discoverFailed.status === 502, "an issuer that does not answer is reported rather than accepted");

  const tested = await call("POST", "/api/sso/oidc/test", { token: adminToken });
  check(tested.status === 200 && tested.data.checks.every((c) => c.ok), "every check of the saved provider passes against a working one");
  check(tested.data.checks.some((c) => c.check === "Signing keys" && /1 key/.test(c.detail)),
    "the signing keys are counted, which is the step a handshake fails on last");

  const status = await call("GET", "/api/auth/sso/status");
  check(status.data.enabled === true && status.data.provider === ISSUER, "the public status endpoint reports it as offered");
  check(status.data.problem === null, "with nothing to report");

  // ── The handshake ──
  const start = await fetch(`${BASE}/api/auth/sso/oidc/start`, { redirect: "manual" });
  const authorize = new URL(start.headers.get("location"));
  check(authorize.origin === ISSUER && authorize.pathname === "/authorize",
    "sign-in is sent to the provider's authorization endpoint");
  check(authorize.searchParams.get("client_id") === CLIENT_ID, "carrying the saved client id");
  check(authorize.searchParams.get("redirect_uri") === REDIRECT_URI, "and the saved redirect URI");
  check(authorize.searchParams.get("scope") === "openid email profile", "and the saved scopes");
  check(!!authorize.searchParams.get("state"), "and a nonce of its own");

  const badState = await fetch(`${BASE}/api/auth/sso/oidc/callback?code=whatever&state=not-the-one`, { redirect: "manual" });
  note(badState.status, await badState.clone().json().catch(() => ({})));
  check(badState.status === 400, "a callback whose nonce does not match is refused");

  const badCode = await call("POST", "/api/auth/sso/exchange", { body: { code: "0000000000000000000000000000000000000000000000" } });
  check(badCode.status === 400, "a hand-off code that was never issued cannot be exchanged");

  // Nothing is active until an administrator says so: the default for a new account.
  const awaiting = await signInWithProvider(`${MAIL_PREFIX}awaiting@example.com`);
  check(awaiting.callback?.status === 403 && /not active yet/.test(messageOf(awaiting.callback?.data)),
    "provisioning creates the account but refuses to sign it in until it is enabled");
  const created = await prisma.user.findUnique({ where: { email: `${MAIL_PREFIX}awaiting@example.com` }, include: { role: true } });
  check(!!created && created.isActive === false, "the account exists, inactive");
  check(created?.role?.id === readOnly.id, "with the role from the configuration rather than an administrator's");
  check(created?.passwordHash?.startsWith("sso:") === true, "and no password that could be used to sign in around the provider");

  // Allowed to use itself straight away.
  await saved({ autoActivate: true });
  const activated = await signInWithProvider(`${MAIL_PREFIX}activated@example.com`);
  check(activated.exchange?.status === 200 && !!activated.exchange.data.token, "with activation on, a new account signs in straight away");
  const activatedUser = await prisma.user.findUnique({ where: { email: `${MAIL_PREFIX}activated@example.com` } });
  check(activatedUser?.isActive === true, "and the account is active");
  const session = await call("GET", "/api/auth/me", { token: activated.exchange?.data.token });
  check(session.status === 200 && session.data.email === `${MAIL_PREFIX}activated@example.com`,
    "the token it was given is a working session");

  // An administrator role never reaches an identity the deployment has never seen — not through
  // auto-activation, and not through the role the account is created with, even if the stored
  // configuration is edited to name one.
  const providerRow = await prisma.ssoConfig.findFirst({ where: { provider: "oidc" } });
  await prisma.ssoConfig.update({
    where: { id: providerRow.id },
    data: { config: { ...(providerRow.config || {}), defaultRoleId: adminRole.id, autoActivate: true } },
  });
  const escalated = await signInWithProvider(`${MAIL_PREFIX}escalated@example.com`);
  const escalatedUser = await prisma.user.findUnique({ where: { email: `${MAIL_PREFIX}escalated@example.com` }, include: { role: true } });
  check(escalatedUser?.role?.systemRole === readOnly.systemRole,
    "an administrator role named in the configuration is not given to a provisioned account");
  const escalatedRead = await call("GET", "/api/sso/oidc", { token: escalated.exchange?.data?.token });
  check(escalatedRead.status === 403, "and the session it does get cannot read the identity-provider configuration");

  // Domains: the provider vouches for an identity, the deployment decides whether it is welcome.
  await saved({ domains: ["probe-allowed.example"], autoActivate: true, defaultRoleId: readOnly.id });
  const outside = await signInWithProvider(`${MAIL_PREFIX}outsider@example.net`);
  check(outside.callback?.status === 403 && /domain/.test(messageOf(outside.callback?.data)),
    "an address outside the accepted domains is refused");
  const inside = await signInWithProvider(`${MAIL_PREFIX}insider@probe-allowed.example`);
  check(inside.exchange?.status === 200, "an address inside them is accepted");
  const caseInsensitive = await signInWithProvider(`${MAIL_PREFIX}upper@PROBE-ALLOWED.EXAMPLE`);
  check(caseInsensitive.exchange?.status === 200, "and the comparison does not care about case");

  // Without provisioning, an unknown identity is simply not a user here.
  await saved({ jitProvisioning: false, domains: [] });
  const unknown = await signInWithProvider(`${MAIL_PREFIX}stranger@example.com`);
  check(unknown.callback?.status === 403 && /ask an administrator/.test(messageOf(unknown.callback?.data)),
    "with provisioning off, an unknown identity is refused instead of created");
  check((await prisma.user.findUnique({ where: { email: `${MAIL_PREFIX}stranger@example.com` } })) === null,
    "and no account is left behind");
  const known = await signInWithProvider(`${MAIL_PREFIX}activated@example.com`);
  check(known.exchange?.status === 200, "while an existing account still signs in");

  // The token endpoint is told what it was configured with, rather than the environment's values.
  const lastCall = tokenCalls[tokenCalls.length - 1];
  check(lastCall?.clientId === CLIENT_ID && lastCall?.secret === CLIENT_SECRET && lastCall?.redirect === REDIRECT_URI,
    "the token exchange uses the saved client id, secret and redirect URI");

  // ── The toggle ──
  await saved({ enabled: false });
  const offStatus = await call("GET", "/api/auth/sso/status");
  check(offStatus.data.enabled === false, "switching sign-in off stops it being offered");
  check(/switched off/.test(offStatus.data.problem || ""), "and the status says why");
  const offStart = await fetch(`${BASE}/api/auth/sso/oidc/start`, { redirect: "manual" });
  check(offStart.status === 404, "and the handshake cannot even be started");
} catch (e) {
  fail++;
  console.log(`  FAIL  the probe threw: ${e instanceof Error ? e.message : String(e)}`);
} finally {
  await cleanUp();
  idp.close();
  await prisma.$disconnect();
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail === 0 ? 0 : 1);
