/**
 * The effective OIDC configuration.
 *
 * A deployment can carry its identity provider in two places, and this is where they are reconciled:
 * a row in `SsoConfig`, written from Administration → Single Sign-On, and the environment variables
 * the feature shipped with. The stored row wins **when it has an issuer**; the environment is the
 * fallback, so a deployment configured either way keeps working, and one configured both ways is
 * predictable rather than a coin toss.
 *
 * `enabled` is deliberately the conjunction of two separate questions — is the feature switched on
 * (the Sessions & Security toggle), and is there something complete to switch it on to — because
 * the settings screens have to be able to say *why* sign-in is not being offered. A missing client id
 * is not "off", it is "not finished", and the difference is the whole point of the page.
 *
 * The client secret never leaves this module except to the token exchange: everything a screen reads
 * goes through `publicOidcSettings`.
 */
import { configFlag } from "./appSettings";

export interface OidcSettings {
  /** Where the values came from: the stored provider row, the environment, or neither. */
  source: "stored" | "environment" | "none";
  issuer: string;
  clientId: string;
  clientSecret: string;
  scopes: string;
  redirectUri: string;
  /** Addresses allowed to sign in this way. Empty means every domain the provider vouches for. */
  domains: string[];
  /** Whether an unknown identity is created on first sign-in, or refused until someone makes one. */
  jitProvisioning: boolean;
  /** Whether such an account arrives usable, or waiting for an administrator to enable it. */
  autoActivate: boolean;
  defaultRoleId: string | null;
  /** The Sessions & Security switch. */
  toggleOn: boolean;
  /** Whether there is enough here to attempt a handshake at all. */
  complete: boolean;
  /** On *and* complete: what the sign-in page asks about and the flow checks. */
  enabled: boolean;
  /** One line explaining what is missing or misconfigured, for whoever has to fix it. */
  problem: string | null;
}

const DEFAULT_SCOPES = "openid email profile";

/** The address the identity provider redirects back to. Register this at the provider. */
export function defaultRedirectUri(): string {
  return `${process.env.WEB_ORIGIN || "http://localhost:3010"}/api/auth/sso/oidc/callback`;
}

const asString = (value: unknown, fallback = ""): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

const asBoolean = (value: unknown, fallback: boolean): boolean =>
  typeof value === "boolean" ? value : fallback;

interface ProviderRow {
  id: string;
  isActive: boolean;
  config: unknown;
  domains: string[];
}

function readProviderConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export async function resolveOidcSettings(): Promise<OidcSettings> {
  const { prisma } = await import("../index");
  let row: ProviderRow | null = null;
  try {
    row = await prisma.ssoConfig.findFirst({
      where: { provider: "oidc" },
      orderBy: [{ isActive: "desc" }, { updatedAt: "desc" }],
      select: { id: true, isActive: true, config: true, domains: true },
    });
  } catch {
    // A settings screen that cannot read the provider must still answer: fall through to the
    // environment, which is what the deployment did before any of this existed.
    row = null;
  }

  const stored = readProviderConfig(row?.config);
  const storedIssuer = asString(stored.issuer);
  const envIssuer = asString(process.env.SSO_ISSUER);
  const issuer = (storedIssuer || envIssuer).replace(/\/$/, "");
  const usingStored = !!storedIssuer;

  const clientId = usingStored ? asString(stored.clientId) : asString(process.env.SSO_CLIENT_ID);
  const clientSecret = usingStored ? asString(stored.clientSecret) : asString(process.env.SSO_CLIENT_SECRET);
  const scopes = usingStored ? asString(stored.scopes, DEFAULT_SCOPES) : DEFAULT_SCOPES;
  const redirectUri = usingStored
    ? asString(stored.redirectUri, defaultRedirectUri())
    : asString(process.env.SSO_REDIRECT_URI, defaultRedirectUri());

  const toggleOn = configFlag("sessions", "sso");
  const source: OidcSettings["source"] = usingStored ? "stored" : issuer ? "environment" : "none";
  const complete = !!issuer && !!clientId;

  let problem: string | null = null;
  if (!toggleOn) problem = "Sign-in is switched off in Sessions & Security.";
  else if (!issuer) problem = "No issuer URL has been configured.";
  else if (!clientId) problem = "No client id has been configured — the provider will reject the handshake.";
  else if (!clientSecret) problem = "No client secret has been saved. Public clients that use PKCE can work without one; most cannot.";

  return {
    source,
    issuer,
    clientId,
    clientSecret,
    scopes,
    redirectUri,
    domains: (row?.domains ?? []).map((d) => d.toLowerCase()).filter(Boolean),
    jitProvisioning: usingStored ? asBoolean(stored.jitProvisioning, true) : true,
    autoActivate: usingStored ? asBoolean(stored.autoActivate, false) : false,
    defaultRoleId: usingStored && typeof stored.defaultRoleId === "string" ? stored.defaultRoleId : null,
    toggleOn,
    complete,
    enabled: toggleOn && complete,
    problem,
  };
}

/** What a settings screen may see: everything except the secret, which is only ever "set" or not. */
export function publicOidcSettings(settings: OidcSettings) {
  const { clientSecret, ...rest } = settings;
  return { ...rest, hasSecret: !!clientSecret };
}

/**
 * Whether an identity provider is configured, for the Sessions & Security requirement banner.
 * Deliberately independent of the toggle: the banner's job is to say whether switching this on
 * would do anything.
 */
export async function oidcConfigured(): Promise<boolean> {
  const settings = await resolveOidcSettings();
  return settings.complete;
}

/** True when the address is allowed to sign in this way. An empty list allows every domain. */
export function domainAllowed(email: string, domains: string[]): boolean {
  if (!domains.length) return true;
  const at = email.lastIndexOf("@");
  if (at < 0) return false;
  return domains.includes(email.slice(at + 1).toLowerCase());
}
