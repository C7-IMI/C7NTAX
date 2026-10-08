import { Router } from "express";
import { prisma } from "../index";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { AppError } from "../middleware/errorHandler";
import { Permission } from "@C7NTAX/shared";
import { safeFetch, EgressError, assertSafeUrlLiteral } from "../services/egress";
import { writeConfigValue } from "../services/appSettings";
import { defaultRedirectUri, publicOidcSettings, resolveOidcSettings } from "../services/ssoSettings";

/**
 * Identity-provider administration.
 *
 * `/configs` is the older generic store. The `/oidc` endpoints below are the ones the
 * Administration → Single Sign-On screen uses: they validate what they are given, check the
 * provider before anything is saved, and never hand the client secret back — the handshake itself
 * lives in `ssoExchange.ts`, and the switch that turns it on is the Sessions & Security card's own
 * stored setting, written here so there is only ever one of it.
 */
export const ssoRouter = Router();
ssoRouter.use(authenticate);

const MANAGE = requirePermission(Permission.SecurityManage);

interface DiscoveryDocument {
  issuer?: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  jwks_uri?: string;
  userinfo_endpoint?: string;
  scopes_supported?: string[];
}

/** Roles an administrator may hand a provisioned account. */
async function roleChoices() {
  const roles = await prisma.role.findMany({
    select: { id: true, name: true, systemRole: true },
    orderBy: { name: "asc" },
  });
  return roles.map((role) => ({
    id: role.id,
    name: role.name,
    systemRole: role.systemRole,
    privileged: role.systemRole === "admin" || role.systemRole === "super_admin",
  }));
}

/**
 * The redirect URI is where the browser is sent back to, and is never fetched by the server, so
 * the egress address policy does not apply to it — refusing `http://localhost:3010/...` would make
 * the default this application generates unsaveable on any development deployment. Only its shape
 * is checked.
 */
function assertRedirectUri(value: string): void {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new AppError(`"${value}" is not a valid URL`, 400);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new AppError(`A redirect URI must be http or https (got ${url.protocol.replace(":", "")})`, 400);
  }
}

async function fetchDiscovery(issuer: string): Promise<DiscoveryDocument> {
  let base: string;
  try {
    base = assertSafeUrlLiteral(issuer).toString().replace(/\/$/, "");
  } catch (e) {
    if (e instanceof EgressError) throw new AppError(e.message, 400);
    throw e;
  }
  const response = await safeFetch(`${base}/.well-known/openid-configuration`, { purpose: "sso", timeoutMs: 10_000 })
    .catch((e: unknown) => { throw new AppError(`Could not reach ${base}: ${e instanceof Error ? e.message : String(e)}`, 502); });
  if (!response.ok) throw new AppError(`${base} answered HTTP ${response.status} for its discovery document`, 502);
  const document = (await response.json().catch(() => null)) as DiscoveryDocument | null;
  if (!document?.authorization_endpoint || !document?.token_endpoint || !document?.jwks_uri) {
    throw new AppError("That document is not an OIDC discovery document: it is missing the authorization, token or JWKS endpoint", 502);
  }
  return document;
}

ssoRouter.get("/configs", requirePermission(Permission.SecurityManage), async (_req: AuthRequest, res, next) => {
  try { const configs = await prisma.ssoConfig.findMany(); res.json(configs.map(({ config, ...rest }) => ({ ...rest, config: typeof config === "object" ? config : {} }))); }
  catch (e) { next(e); }
});

ssoRouter.post("/configs", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try { const c = await prisma.ssoConfig.create({ data: { name: req.body.name, provider: req.body.provider, config: req.body.config || {}, domains: req.body.domains || [] } }); res.status(201).json(c); }
  catch (e) { next(e); }
});

ssoRouter.patch("/configs/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try { const allowed = ["name","isActive","config","domains"]; const updates: Record<string, unknown> = {}; for (const k of allowed) if (req.body[k] !== undefined) updates[k] = req.body[k];
    res.json(await prisma.ssoConfig.update({ where: { id: req.params.id }, data: updates })); }
  catch (e) { next(e); }
});

ssoRouter.delete("/configs/:id", requirePermission(Permission.SecurityManage), async (req: AuthRequest, res, next) => {
  try { await prisma.ssoConfig.delete({ where: { id: req.params.id } }); res.json({ message: "SSO config removed" }); }
  catch (e) { next(e); }
});

// ── Read: the effective configuration, and the roles a new account could be given ──
ssoRouter.get("/oidc", MANAGE, async (_req: AuthRequest, res, next) => {
  try {
    const settings = await resolveOidcSettings();
    res.json({
      settings: publicOidcSettings(settings),
      redirectUri: settings.redirectUri || defaultRedirectUri(),
      roles: await roleChoices(),
    });
  } catch (e) { next(e); }
});

// ── Manage: save the provider ──
ssoRouter.put("/oidc", MANAGE, async (req: AuthRequest, res, next) => {
  try {
    const body = req.body || {};
    const current = await resolveOidcSettings();

    const issuer = typeof body.issuer === "string" ? body.issuer.trim() : "";
    if (issuer) {
      try { assertSafeUrlLiteral(issuer); }
      catch (e) { throw new AppError(e instanceof EgressError ? e.message : "The issuer URL is not usable", 400); }
    }

    const clientId = typeof body.clientId === "string" ? body.clientId.trim() : "";
    // An omitted secret means "keep the one that is saved": the screen never receives it back.
    const clientSecret = typeof body.clientSecret === "string" && body.clientSecret.trim()
      ? body.clientSecret.trim()
      : (body.clearSecret === true ? "" : (current.source === "stored" ? current.clientSecret : ""));

    const scopes = typeof body.scopes === "string" && body.scopes.trim() ? body.scopes.trim() : "openid email profile";
    if (!/(^|\s)openid(\s|$)/.test(scopes)) {
      throw new AppError("The scopes must include openid — it is what makes the response an identity token", 400);
    }

    const redirectUri = typeof body.redirectUri === "string" && body.redirectUri.trim() ? body.redirectUri.trim() : defaultRedirectUri();
    assertRedirectUri(redirectUri);

    const domains: string[] = Array.isArray(body.domains)
      ? [...new Set<string>(
          (body.domains as unknown[])
            .map((d) => String(d).trim().replace(/^@/, "").toLowerCase())
            .filter(Boolean),
        )]
      : [];
    const malformed = domains.find((d) => !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d));
    if (malformed) throw new AppError(`"${malformed}" does not look like a domain`, 400);

    const jitProvisioning = body.jitProvisioning === undefined ? true : !!body.jitProvisioning;
    const autoActivate = body.autoActivate === undefined ? false : !!body.autoActivate;
    const defaultRoleId = typeof body.defaultRoleId === "string" && body.defaultRoleId ? body.defaultRoleId : null;

    if (defaultRoleId) {
      const role = await prisma.role.findUnique({ where: { id: defaultRoleId }, select: { id: true, systemRole: true, name: true } });
      if (!role) throw new AppError("That role does not exist", 400);
      // An automatically activated administrator is a privilege escalation reachable from the
      // provider's user list, so the two settings are refused together rather than warned about.
      if (autoActivate && (role.systemRole === "admin" || role.systemRole === "super_admin")) {
        throw new AppError(`${role.name} is an administrator role, so it cannot be granted automatically — either choose another role or leave new accounts waiting for approval`, 400);
      }
    }

    const enabled = body.enabled === undefined ? current.toggleOn : !!body.enabled;
    if (enabled && (!issuer || !clientId)) {
      throw new AppError("Save an issuer URL and a client id before switching sign-in on", 400);
    }

    const config = { issuer, clientId, clientSecret, scopes, redirectUri, jitProvisioning, autoActivate, defaultRoleId };
    const existing = await prisma.ssoConfig.findFirst({ where: { provider: "oidc" }, select: { id: true } });
    // `isActive` marks the row as the provider in use; whether sign-in is *offered* is the stored
    // Sessions & Security setting below, so the two are not the same question.
    const row = existing
      ? await prisma.ssoConfig.update({ where: { id: existing.id }, data: { config, domains, isActive: true } })
      : await prisma.ssoConfig.create({
        data: { name: "Identity provider", provider: "oidc", isActive: true, config, domains },
      });

    // One switch, in the place it has always been: the Sessions & Security card owns whether
    // sign-in through a provider is offered, and this screen writes that same stored value.
    const written = await writeConfigValue("sessions", "sso", enabled);
    if (!written.ok) throw new AppError(written.message, 400);

    const saved = await resolveOidcSettings();
    res.json({ id: row.id, settings: publicOidcSettings(saved), redirectUri: saved.redirectUri, roles: await roleChoices() });
  } catch (e) { next(e); }
});

// ── Check: what the provider publishes, before anything is saved ──
ssoRouter.post("/oidc/discover", MANAGE, async (req: AuthRequest, res, next) => {
  try {
    const issuer = typeof req.body?.issuer === "string" ? req.body.issuer.trim() : "";
    if (!issuer) throw new AppError("An issuer URL is required", 400);
    const document = await fetchDiscovery(issuer);
    res.json({
      issuer: document.issuer || issuer,
      authorizationEndpoint: document.authorization_endpoint,
      tokenEndpoint: document.token_endpoint,
      jwksUri: document.jwks_uri,
      userinfoEndpoint: document.userinfo_endpoint ?? null,
      scopesSupported: document.scopes_supported ?? [],
      redirectUri: (await resolveOidcSettings()).redirectUri,
    });
  } catch (e) { next(e); }
});

// ── Check: is the saved provider reachable and complete ──
ssoRouter.post("/oidc/test", MANAGE, async (_req: AuthRequest, res, next) => {
  try {
    const settings = await resolveOidcSettings();
    const checks: Array<{ check: string; ok: boolean; detail: string }> = [];

    checks.push({
      check: "Issuer",
      ok: !!settings.issuer,
      detail: settings.issuer || "No issuer URL configured",
    });
    checks.push({
      check: "Client credentials",
      ok: !!settings.clientId,
      detail: settings.clientId
        ? `${settings.clientId}${settings.clientSecret ? " with a client secret" : " with no client secret (fine for a public client)"}`
        : "No client id configured",
    });
    checks.push({
      check: "Redirect URI",
      ok: true,
      detail: `${settings.redirectUri} — this is the address to register at the provider`,
    });

    if (settings.issuer) {
      try {
        const document = await fetchDiscovery(settings.issuer);
        checks.push({
          check: "Discovery document",
          ok: true,
          detail: `authorization endpoint ${document.authorization_endpoint}`,
        });
        // The JWKS is what an identity token is verified against, so a provider that publishes
        // discovery but no reachable keys would fail at the last step of sign-in, not the first.
        const jwks = await safeFetch(document.jwks_uri!, { purpose: "sso", timeoutMs: 10_000 });
        const keys = jwks.ok ? ((await jwks.json().catch(() => ({}))) as { keys?: unknown[] }).keys ?? [] : [];
        checks.push({
          check: "Signing keys",
          ok: jwks.ok && keys.length > 0,
          detail: jwks.ok ? `${keys.length} key${keys.length === 1 ? "" : "s"} published` : `HTTP ${jwks.status} from the JWKS endpoint`,
        });
      } catch (e) {
        checks.push({ check: "Discovery document", ok: false, detail: e instanceof Error ? e.message : String(e) });
      }
    }

    res.json({ enabled: settings.enabled, problem: settings.problem, checks });
  } catch (e) { next(e); }
});
