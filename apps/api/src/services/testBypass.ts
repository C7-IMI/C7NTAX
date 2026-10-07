/**
 * Development-only escape hatch for manual testing.
 *
 * Exactly ONE account can be exempted from the interruptions that make clicking
 * through the app painful: the session expiry (which drops to 15 minutes as soon as
 * AUTH_HARDENING_ENABLED is on), the failed-sign-in lockout, the credential rate
 * limit on its own sign-ins, and the "choose a new password" gate.
 *
 * It is deliberately narrow: off unless explicitly switched on, hard-refused in
 * production, and matched against one account rather than a role — an admin-only
 * rule would silently exempt every admin. Sign-ins as the exempt account are logged
 * so it cannot be left on unnoticed.
 *
 *   AUTH_TEST_BYPASS=true
 *   AUTH_TEST_BYPASS_ACCOUNT=admin@C7NTAX.com
 *   AUTH_TEST_BYPASS_TOKEN_TTL=720h      # optional, default 720h
 *
 * Environment is read per call rather than at module load: the API picks up `.env`
 * as a side effect of importing Prisma, so a module-level read would depend on
 * import order.
 */
const readEnabled = (): boolean => process.env.AUTH_TEST_BYPASS === "true";
const readAccount = (): string => (process.env.AUTH_TEST_BYPASS_ACCOUNT ?? "").trim().toLowerCase();
const isProduction = (): boolean => process.env.NODE_ENV === "production";

/** Anything `jsonwebtoken`'s `expiresIn` accepts. */
export const bypassTokenTtl = (): string => process.env.AUTH_TEST_BYPASS_TOKEN_TTL || "720h";

export const testBypassActive = (): boolean => readEnabled() && readAccount().length > 0 && !isProduction();

/** True only for the single configured account — never for a whole role. */
export function isBypassAccount(identifier?: string | null): boolean {
  if (!testBypassActive() || !identifier) return false;
  return identifier.trim().toLowerCase() === readAccount();
}

const LOOPBACK = new Set(["127.0.0.1", "::1", "::ffff:127.0.0.1"]);

/**
 * The sign-in limiter has to match on the submitted identifier because the request
 * is not authenticated yet, so the exemption is additionally restricted to requests
 * arriving from this machine — a remote caller who merely types the account name
 * gains nothing.
 */
export function isBypassLoginAttempt(identifier?: string | null, remoteAddress?: string | null): boolean {
  return isBypassAccount(identifier) && !!remoteAddress && LOOPBACK.has(remoteAddress);
}

/** Startup guard: never in production, never half-configured, and never quiet. */
export function assertTestBypassConfig(): void {
  if (isProduction() && readEnabled()) {
    throw new Error("AUTH_TEST_BYPASS cannot be enabled in production — remove it from the environment.");
  }
  if (readEnabled() && !readAccount()) {
    throw new Error("AUTH_TEST_BYPASS requires AUTH_TEST_BYPASS_ACCOUNT=<email>; refusing to start half-configured.");
  }
  if (testBypassActive()) {
    console.warn(
      `⚠️  AUTH TEST BYPASS ACTIVE for ${readAccount()}: no session expiry, no lockout, no credential rate limit, ` +
      `no forced password change. Sign-ins as this account are logged. Unset AUTH_TEST_BYPASS to disable.`
    );
  }
}

/** One line per sign-in, so an enabled bypass leaves a trail rather than a mystery. */
export function logBypassSignIn(email: string): void {
  console.warn(`[test-bypass] sign-in for exempt account ${email} — expiry, lockout, rate limit and password-change gate are disabled for it`);
}
