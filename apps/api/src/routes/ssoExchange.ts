import { Router } from "express";
import { prisma } from "../index";
import { signToken } from "../middleware/auth";
import { safeFetch } from "../services/egress";
import crypto from "crypto";
import jwt from "jsonwebtoken";
import { SystemRole } from "@C7NTAX/shared";

// Backlog item 6 — SSO OIDC login path (env-gated; no new dependencies).
// Supports Keycloak / Entra ID / Okta / Auth0 via standard OIDC discovery.
export const ssoExchangeRouter = Router();

const enabled = () => process.env.SSO_ENABLED === "true" && !!process.env.SSO_ISSUER;

/** Where the in-flight OIDC nonce lives between /oidc/start and /oidc/callback. */
const SSO_STATE_KEY = "sso:oidc_state";
/** How long a started sign-in stays valid. */
const SSO_STATE_TTL_MS = 10 * 60 * 1000;

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
  const header = JSON.parse(Buffer.from(idToken.split(".")[0], "base64url" as BufferEncoding).toString());
  const key = await jwksKey(issuer, header.kid);
  const payload = (jwt.verify as any)(idToken, key, { algorithms: ["RS256"], issuer }) as { sub: string; email?: string; name?: string; preferred_username?: string; aud?: string | string[] };
  if (Array.isArray(payload.aud) ? !payload.aud.includes(clientId) : payload.aud !== clientId) throw new Error("Invalid audience");
  return payload;
}

ssoExchangeRouter.get("/oidc/start", async (req, res, next) => {
  try {
    if (!enabled()) return res.status(404).json({ error: "SSO disabled" });
    const issuer = process.env.SSO_ISSUER!.replace(/\/$/, "");
    const discovery = await safeFetch(`${issuer}/.well-known/openid-configuration`, { purpose: "sso" });
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
      client_id: process.env.SSO_CLIENT_ID!,
      redirect_uri: process.env.SSO_REDIRECT_URI || `${process.env.WEB_ORIGIN || "http://localhost:3010"}/api/auth/sso/oidc/callback`,
      scope: "openid email profile",
      state,
    });
    res.redirect(`${authorization_endpoint}?${params.toString()}`);
  } catch (e) { next(e); }
});

ssoExchangeRouter.get("/oidc/callback", async (req, res, next) => {
  try {
    if (!enabled()) return res.status(404).json({ error: "SSO disabled" });
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

    const issuer = process.env.SSO_ISSUER!.replace(/\/$/, "");
    const discovery = await safeFetch(`${issuer}/.well-known/openid-configuration`, { purpose: "sso" });
    const { token_endpoint } = (await discovery.json()) as { token_endpoint: string };
    const tokenRes = await safeFetch(token_endpoint, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code, redirect_uri: process.env.SSO_REDIRECT_URI || `${process.env.WEB_ORIGIN || "http://localhost:3010"}/api/auth/sso/oidc/callback`,
        client_id: process.env.SSO_CLIENT_ID!,
        client_secret: process.env.SSO_CLIENT_SECRET || "",
      }),
    });
    if (!tokenRes.ok) return res.status(401).json({ error: "Token exchange failed" });
    const tokens = (await tokenRes.json()) as { id_token: string };
    const claims = await verifyIdToken(tokens.id_token, issuer, process.env.SSO_CLIENT_ID!);
    const email = (claims.email || claims.preferred_username || "").toLowerCase();
    if (!email) return res.status(401).json({ error: "No email in ID token" });

    let user = await prisma.user.findUnique({ where: { email }, include: { role: true } });
    if (!user) {
      // An identity the IdP vouches for but we have never seen is not automatically
      // an administrator: it is created inactive and read-only, and an administrator
      // decides what it may do.
      const role = await prisma.role.findFirst({ where: { systemRole: "read_only" } })
        ?? await prisma.role.findFirst({ where: { systemRole: "client_user" } })
        ?? await prisma.role.findFirst({ where: { systemRole: "technician" } });
      if (!role) return res.status(500).json({ error: "No role available for a new SSO user" });
      const created = await prisma.user.create({
        data: {
          email,
          passwordHash: `sso:${crypto.randomBytes(24).toString("hex")}`,
          firstName: claims.name?.split(" ")[0] || claims.preferred_username || email,
          lastName: claims.name?.split(" ").slice(1).join(" ") || "",
          roleId: role.id,
          emailVerified: true,
          isActive: false,
        },
      });
      console.log(`[SSO] Created inactive read-only account for ${email} — an administrator must enable it and assign a role.`);
      user = await prisma.user.findUnique({ where: { id: created.id }, include: { role: true } });
      return res.status(403).json({ error: "Your account was created but is not active yet — ask an administrator to enable it" });
    }
    if (!user.isActive) {
      return res.status(403).json({ error: "Your account is inactive — ask an administrator to enable it" });
    }
    if (!user) return res.status(500).json({ error: "User provisioning failed" });
    const token = signToken({ id: user.id, email: user.email, role: (user.role?.systemRole ?? "read_only") as SystemRole, tokenVersion: user.tokenVersion });
    res.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3010"}/login?token=${encodeURIComponent(token)}`);
  } catch (e) { next(e); }
});

ssoExchangeRouter.get("/status", (_req, res) => {
  res.json({ enabled: enabled(), provider: enabled() ? process.env.SSO_ISSUER : null });
});
