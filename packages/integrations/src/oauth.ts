/**
 * Client-credentials tokens, for the connectors that authenticate as an application.
 *
 * Three of these connectors (Azure Resource Manager, Pax8, Microsoft 365) work the same way: post a
 * client id and secret to a token endpoint, get a bearer token that lasts about an hour, and call
 * the API with it. Doing that once here rather than in each adapter is not tidiness — the adapters
 * that got it wrong mostly got it wrong the same way, by accepting a pasted access token that expires
 * an hour after somebody copied it, which is a connector that works exactly once.
 *
 * The token is cached in memory until shortly before it expires, so a sync that makes twenty calls
 * does not make twenty token requests. Nothing is persisted: a token is worth less than the secret
 * that mints it, and the secret is already stored.
 */
const cache = new Map<string, { token: string; expiresAt: number }>();

/** Renew this long before the vendor says the token dies, so a slow call cannot land on a dead one. */
const RENEW_MARGIN_MS = 120_000;

export interface ClientCredentialsInput {
  /** The vendor's token endpoint — already tenant-specific where the vendor needs it to be. */
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  /** Most vendors want a scope; a few (Pax8) want an audience instead. */
  scope?: string;
  extra?: Record<string, string>;
  /** Overrides the cache key when two connections share a client id but differ in, say, tenant. */
  cacheKey?: string;
}

export class TokenError extends Error {
  constructor(message: string, readonly status: number, readonly detail: string) {
    super(message);
  }
}

/**
 * A bearer token for the given client, from cache when one is still good.
 *
 * Failures carry the vendor's own words: "invalid_client" from Azure means the secret is wrong, and
 * saying so beats a bare 401 three calls later.
 */
export async function clientCredentialsToken(input: ClientCredentialsInput): Promise<string> {
  const key = input.cacheKey ?? `${input.tokenUrl}|${input.clientId}|${input.scope ?? ""}|${input.extra ? JSON.stringify(input.extra) : ""}`;
  const cached = cache.get(key);
  if (cached && cached.expiresAt > Date.now() + RENEW_MARGIN_MS) return cached.token;

  const body = new URLSearchParams({
    grant_type: "client_credentials",
    client_id: input.clientId,
    client_secret: input.clientSecret,
    ...(input.scope ? { scope: input.scope } : {}),
    ...(input.extra ?? {}),
  });

  const res = await fetch(input.tokenUrl, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body,
  });

  const text = await res.text().catch(() => "");
  let parsed: { access_token?: string; expires_in?: number; error?: string; error_description?: string } = {};
  try { parsed = JSON.parse(text); } catch { /* some vendors answer with a plain-text error */ }

  if (!res.ok || !parsed.access_token) {
    const detail = parsed.error_description || parsed.error || text.slice(0, 300) || `HTTP ${res.status}`;
    throw new TokenError(`The token endpoint refused the credentials: ${detail}`, res.status, detail);
  }

  const lifetimeMs = Math.max(60, parsed.expires_in ?? 3600) * 1000;
  cache.set(key, { token: parsed.access_token, expiresAt: Date.now() + lifetimeMs });
  return parsed.access_token;
}

/** Drop a cached token — used when a call comes back 401 and the token is the suspect, not the config. */
export function forgetToken(input: ClientCredentialsInput): void {
  const key = input.cacheKey ?? `${input.tokenUrl}|${input.clientId}|${input.scope ?? ""}|${input.extra ? JSON.stringify(input.extra) : ""}`;
  cache.delete(key);
}
