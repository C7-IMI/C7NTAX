import { Router } from "express";
import { prisma } from "../index";
import { signToken } from "../middleware/auth";
import crypto from "crypto";
import jwt from "jsonwebtoken";

// Backlog item 6 — SSO OIDC login path (env-gated; no new dependencies).
// Supports Keycloak / Entra ID / Okta / Auth0 via standard OIDC discovery.
export const ssoExchangeRouter = Router();

const enabled = () => process.env.SSO_ENABLED === "true" && !!process.env.SSO_ISSUER;

function base64url(input: string | Buffer): string {
  return Buffer.from(input).toString("base64url");
}

async function jwksKey(issuer: string, kid: string): Promise<crypto.KeyObject> {
  const discovery = await fetch(`${issuer.replace(/\/$/, "")}/.well-known/openid-configuration`);
  if (!discovery.ok) throw new Error("OIDC discovery failed");
  const { jwks_uri } = (await discovery.json()) as { jwks_uri: string };
  const jwks = await fetch(jwks_uri);
  const { keys } = (await jwks.json()) as { keys: Array<{ kid: string; n: string; e: string; kty: string }> };
  const key = keys.find((k) => k.kid === kid);
  if (!key) throw new Error("No matching JWKS key");
  const jwk = {
    kty: key.kty, n: key.n, e: key.e,
    alg: "RS256", use: "sig", kid: key.kid,
  };
  return crypto.createPublicKey({ key: jwk as crypto.JsonWebKey, format: "jwk" });
}

async function verifyIdToken(idToken: string, issuer: string, clientId: string): Promise<{ sub: string; email?: string; name?: string; preferred_username?: string }> {
  const header = JSON.parse(Buffer.from(idToken.split(".")[0], "base64url").toString());
  const key = await jwksKey(issuer, header.kid);
  const payload = jwt.verify(idToken, key, { algorithms: ["RS256"], issuer }) as { sub: string; email?: string; name?: string; preferred_username?: string };
  if (Array.isArray(payload.aud) ? !payload.aud.includes(clientId) : payload.aud !== clientId) throw new Error("Invalid audience");
  return payload;
}

ssoExchangeRouter.get("/oidc/start", async (req, res, next) => {
  try {
    if (!enabled()) return res.status(404).json({ error: "SSO disabled" });
    const issuer = process.env.SSO_ISSUER!.replace(/\/$/, "");
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
    const { authorization_endpoint } = (await discovery.json()) as { authorization_endpoint: string };
    const state = crypto.randomBytes(16).toString("hex");
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
    const issuer = process.env.SSO_ISSUER!.replace(/\/$/, "");
    const discovery = await fetch(`${issuer}/.well-known/openid-configuration`);
    const { token_endpoint } = (await discovery.json()) as { token_endpoint: string };
    const tokenRes = await fetch(token_endpoint, {
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

    let user = await prisma.user.findUnique({ where: { email } });
    if (!user) {
      const role = await prisma.role.findFirst({ where: { systemRole: "admin" } });
      user = await prisma.user.create({
        data: {
          email,
          passwordHash: `sso:${crypto.randomBytes(24).toString("hex")}`,
          firstName: claims.name?.split(" ")[0] || claims.preferred_username || email,
          lastName: claims.name?.split(" ").slice(1).join(" ") || "",
          roleId: role?.id || (await prisma.role.findFirstOrThrow()).id,
          emailVerified: true,
        },
      });
    }
    const token = signToken(user.id, user.email);
    res.redirect(`${process.env.WEB_ORIGIN || "http://localhost:3010"}/login?token=${encodeURIComponent(token)}`);
  } catch (e) { next(e); }
});

ssoExchangeRouter.get("/status", (_req, res) => {
  res.json({ enabled: enabled(), provider: enabled() ? process.env.SSO_ISSUER : null });
});
