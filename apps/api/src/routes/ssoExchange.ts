import { Router } from "express";
import { prisma } from "../index";
import { signToken, JWT_SECRET } from "../middleware/auth";
import { safeFetch } from "../services/egress";
import { startSession } from "../services/signIn";
import { domainAllowed, resolveOidcSettings, type OidcSettings } from "../services/ssoSettings";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { SystemRole } from "@C7NTAX/shared";

// Backlog item 6 — SSO OIDC login path.
// Supports Keycloak / Entra ID / Okta / Auth0 via standard OIDC discovery. The provider is
// configured at Administration → Single Sign-On (stored), with the environment variables this
// feature shipped with as the fallback; `services/ssoSettings.ts` reconciles the two.
export const ssoExchangeRouter = Router();

/** The settings to hand a handshake, or null when sign-in is off or the provider is unfinished. */
async function requireOidc(): Promise<OidcSettings | null> {
  const settings = await resolveOidcSettings();
  return settings.enabled ? settings : null;
}

/** Where the in-flight OIDC nonce lives between /oidc/start and /oidc/callback. */
const SSO_STATE_KEY = "sso:oidc_state";
/** How long a started sign-in stays valid. */
const SSO_STATE_TTL_MS = 10 * 60 * 1000;
/** The hand-off code placed in the redirect back to the sign-in page (never the token). */
const SSO_CODE_KEY = "sso:oidc_code";
/** How long that hand-off code can be exchanged for the token. */
const SSO_CODE_TTL_MS = 2 * 60 * 1000;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

async function jwksKey(issuer: string, kid: string): Promise<string> {
  const discovery = await safeFetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`, { purpose: "sso" });
  if (!discovery.ok) throw new Error("OIDC discovery failed");
  const { jwks_uri } = (await discovery.json()) as { jwks_uri: string };
  const jwks = await safeFetch(jwks_uri, { purpose: "sso" });
  const { keys } = (await jwks.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string }> };
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new Error("No matching JWKS key");
  const jwk = {
    kty: key.kty, n: key.n, e: key.e,
    alg: "RS256", use: "sig", kid: key.kid,
  };
  const pub = crypto.createPublicKey({ key: jwk as any, format: "jwk" });
  return pub.export({ type: "spki", format: "pem" }) as string;
}

async function verifyIdToken(idToken: string, issuer: string, clientId: string): Promise<{ sub: string; email?: string; name?: string; preferred_username?: string; aud?: string | string[] }> {
  const [encodedHeader = ""] = idToken.split(".");
  const header = JSON.parse(Buffer.from(encodedHeader, "base64url" as BufferEncoding).toString()) as { kid?: string };
  const key = await jwksKey(issuer, header.kid ?? "");
  const payload = (jwt.verify as any)(idToken, key, { algorithms: ["RS256"], issuer }) as { sub: string; email?: string; name?: string; preferred_username?: string; aud?: string | string[] };
  if (Array.isArray(payload.aud) ? !payload.aud.includes(clientId) : payload.aud !== clientId) throw new Error("Invalid audience");
  return payload;
}

ssoExchangeRouter.get("/oidc/start", async (req, res, next) => {
  try {
    const settings = await requireOidc();
    if (!settings) return res.status(404).json({ error: "SSO disabled" });
    const discovery = await safeFetch(`${settings.issuer}/.well-known/openid-configuration`, { purpose: "sso" });
    if (!discovery.ok) return res.status(502).json({ error: `The identity provider's discovery document answered HTTP ${discovery.status}` });
    const { authorization_endpoint } = (await discovery.json()) as { authorization_endpoint: string };
    const state = crypto.randomBytes(16).toString("hex");
    // Remember the nonce so the callback can prove it started this handshake.
    await prisma.systemConfig.upsert({
      where: { key: SSO_STATE_KEY },
      create: { key: SSO_STATE_KEY, value: JSON.stringify({ state, createdAt: new Date().toISOString() }) },
      update: { value: JSON.stringify({ state, createdAt: new Date().toISOString() }) },
    });
    const params = new URLSearchParams({
      response_type: "code",
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      scope: settings.scopes,
      state,
    });
    res.redirect(`${authorization_endpoint}?${params.toString()}`);
  } catch (e) { next(e); }
});

ssoExchangeRouter.get("/oidc/callback", async (req, res, next) => {
  try {
    const settings = await requireOidc();
    if (!settings) return res.status(404).json({ error: "SSO disabled" });
    const { code, state, error } = req.query as Record<string, string>;
    if (error || !code) return res.status(400).json({ error: error || "No authorization code" });

    // The callback is unauthenticated, so the nonce is the only thing tying it to a
    // sign-in we started — single use, and only valid for a few minutes.
    const stored = await prisma.systemConfig.findUnique({ where: { key: SSO_STATE_KEY } });
    let expected: { state?: string; createdAt?: string } = {};
    try { expected = stored ? JSON.parse(stored.value as string) : {}; } catch { expected = {}; }
    const ageMs = expected.createdAt ? Date.now() - new Date(expected.createdAt).getTime() : Infinity;
    if (!state || !expected.state || state !== expected.state || ageMs > SSO_STATE_TTL_MS) {
      return res.status(400).json({ error: "This sign-in link is invalid or has expired — start again" });
    }
    await prisma.systemConfig.deleteMany({ where: { key: SSO_STATE_KEY } });

    const discovery = await safeFetch(`${settings.issuer}/.well-known/openid-configuration`, { purpose: "sso" });
    const { token_endpoint } = (await discovery.json()) as { token_endpoint: string };
    const tokenRes = await safeFetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code, redirect_uri: settings.redirectUri,
        client_id: settings.clientId,
        client_secret: settings.clientSecret,
      }),
    });
    if (!tokenRes.ok) return res.status(401).json({ error: "Token exchange failed" });
    const tokens = (await tokenRes.json()) as { id_token: string };
    const claims = await verifyIdToken(tokens.id_token, settings.issuer, settings.clientId);
    const email = (claims.email || claims.preferred_username || "").toLowerCase();
    if (!email) return res.status(401).json({ error: "No email in ID token" });

    // The provider vouches for the identity; the deployment decides which identities it will accept.
    if (!domainAllowed(email, settings.domains)) {
      return res.status(403).json({ error: `${email} is not in a domain this deployment accepts for single sign-on` });
    }

    let user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user) {
      if (!settings.jitProvisioning) {
        return res.status(403).json({ error: "No account exists for that address — ask an administrator to create one" });
      }
      // An identity the IdP vouches for but we have never seen is not automatically an
      // administrator. The role comes from the configuration, and an administrator decides whether
      // it may be used straight away — a privileged role never activates itself, whatever the
      // configuration says, because that would be a way to mint an admin from the login page.
      // A privileged role is not even handed to an account the deployment has never seen: a
      // configuration naming one is ignored here, and the account waits at the least privilege for
      // an administrator to review it and set the role deliberately.
      const privileged = (role: { systemRole: string } | null) =>
        role?.systemRole === "admin" || role?.systemRole === "super_admin";
      const configured = settings.defaultRoleId
        ? await prisma.role.findUnique({ where: { id: settings.defaultRoleId } })
        : null;
      const role = (privileged(configured) ? null : configured)
        ?? await prisma.role.findFirst({ where: { systemRole: "read_only" } })
        ?? await prisma.role.findFirst({ where: { systemRole: "client_user" } })
        ?? await prisma.role.findFirst({ where: { systemRole: "technician" } });
      if (!role) return res.status(500).json({ error: "No role available for a new SSO user" });
      const activate = settings.autoActivate && !privileged(role);
      const created = await prisma.user.create({
        data: {
          email,
          passwordHash: `sso:${crypto.randomBytes(24).toString("hex")}`,
          firstName: claims.name?.split(" ")[0] || claims.preferred_username || email,
          lastName: claims.name?.split(" ").slice(1).join(" ") || "",
          roleId: role.id,
          emailVerified: true,
          isActive: activate,
        },
      });
      if (!activate) {
        console.log(`[SSO] Created inactive account for ${email} as ${role.name} — an administrator must enable it.`);
        return res.status(403).json({ error: "Your account was created but is not active yet — ask an administrator to enable it" });
      }
      console.log(`[SSO] Provisioned ${email} on first sign-in as ${role.name}.`);
      user = await prisma.user.findUnique({ where: { id: created.id }, include: { role: true } });
    }
    if (!user) return res.status(500).json({ error: "User provisioning failed" });
    if (!user.isActive) {
      return res.status(403).json({ error: "Your account is inactive — ask an administrator to enable it" });
    }
    const token = signToken({ id: user.id, email: user.email, role: (user.role?.systemRole ?? "read_only") as SystemRole, tokenVersion: user.tokenVersion });
    // The token itself must not travel in a URL (browser history, proxy logs, morgan), so
    // the redirect carries a single-use code that the sign-in page swaps for the token in
    // the body of a POST. The code expires in two minutes and is deleted on first use.
    const handoffCode = crypto.randomBytes(24).toString("hex");
    const handoff = JSON.stringify({ code: handoffCode, token, createdAt: new Date().toISOString() });
    await prisma.systemConfig.upsert({
      where: { key: SSO_CODE_KEY },
      create: { key: SSO_CODE_KEY, value: handoff },
      update: { value: handoff },
    });
    res.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3010"}/login?sso_code=${handoffCode}`);
  } catch (e) { next(e); }
});

/**
 * Swap the single-use code from the OIDC redirect for the token. Unauthenticated by
 * necessity — it is the step that creates the session — so the code is the credential:
 * single use, two-minute TTL, and compared in constant time.
 */
ssoExchangeRouter.post("/exchange", async (req, res, next) => {
  try {
    if (!(await requireOidc())) return res.status(404).json({ error: "SSO disabled" });
    const suppliedCode = typeof req.body?.code === "string" ? req.body.code : "";
    if (!suppliedCode) return res.status(400).json({ error: "No code supplied" });
    const stored = await prisma.systemConfig.findUnique({ where: { key: SSO_CODE_KEY } });
    let held: { code?: string; token?: string; createdAt?: string } = {};
    try { held = stored ? JSON.parse(stored.value as string) : {}; } catch { held = {}; }
    const ageMs = held.createdAt ? Date.now() - new Date(held.createdAt).getTime() : Infinity;
    const supplied = Buffer.from(suppliedCode);
    const expected = Buffer.from(held.code || "");
    const matches = supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
    if (!matches || !held.token || ageMs > SSO_CODE_TTL_MS) {
      return res.status(400).json({ error: "This sign-in link is invalid or has expired — start again" });
    }
    await prisma.systemConfig.deleteMany({ where: { key: SSO_CODE_KEY } });

    // The browser that just came back from the identity provider gets a session as well as
    // the token, so a subsequent reload is authenticated by the cookie (PLAN-001).
    let claims: { userId?: string; email?: string } = {};
    try { claims = jwt.verify(held.token, JWT_SECRET) as { userId?: string; email?: string }; }
    catch { return res.status(400).json({ error: "This sign-in link has expired — start again" }); }
    if (claims.userId) {
      const account = await prisma.user.findUnique({ where: { id: claims.userId }, include: { role: true } });
      if (account?.isActive) {
        await startSession(req, res, {
          id: account.id, email: account.email, role: (account.role?.systemRole ?? "read_only") as SystemRole,
          companyId: account.companyId, tokenVersion: account.tokenVersion,
        });
      }
    }
    res.json({ token: held.token });
  } catch (e) { next(e); }
});

ssoExchangeRouter.get("/status", async (_req, res) => {
  const settings = await resolveOidcSettings();
  res.json({ enabled: settings.enabled, provider: settings.enabled ? settings.issuer : null, problem: settings.problem });
});
