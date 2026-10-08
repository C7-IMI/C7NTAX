/**
 * Live integration health (PLAN-015 Phase B #9).
 *
 * CloudConnect knew a connection was broken when somebody pressed Test and found out. The status a
 * screen shows should be the status the platform actually verified, and it should keep verifying on
 * its own — but a vendor's API is not a thing to hammer, so the verification is *throttled per
 * integration* and only ever runs for connections that could plausibly pass.
 *
 * Three rules make this safe to leave switched on:
 *   - an integration whose required credentials are not all present is never called at all; it is
 *     reported as unconfigured, because a request that cannot succeed is just noise on the wire;
 *   - one verification per integration per interval, with an in-flight guard, so ten open browsers
 *     polling the status endpoint still produce one call;
 *   - the result is written back to the row it describes, so the badge on the page and the live
 *     chip can never disagree.
 */
import { prisma } from "../index";
import type { IntegrationConfig } from "@C7NTAX/integrations";
import { configFlag, configNumber } from "./appSettings";

export interface IntegrationHealth {
  /** healthy = verified working, degraded = last check failed, unconfigured = cannot be tried, off = disabled. */
  state: "healthy" | "degraded" | "unconfigured" | "off";
  detail: string;
  verifiedAt: string | null;
  /** Seconds since the last verification, or null if it has never been verified. */
  ageSeconds: number | null;
  /** True when the last verification is older than the interval, so the number is a memory. */
  stale: boolean;
  consecutiveFailures: number;
  missingFields: string[];
  /** A check is running right now; its answer will replace this one. */
  checking: boolean;
}

interface LastVerification {
  at: number;
  ok: boolean;
  detail: string;
  failures: number;
}

const verifications = new Map<string, LastVerification>();
/** Checks currently running: this is both the duplicate-call guard and what "checking now" means. */
const inFlight = new Set<string>();

/** How long a status request waits for a fresh answer before reporting the previous one. */
const VERIFY_WAIT_MS = 8000;

function intervalSeconds(): number {
  const raw = configNumber("integrations", "verifyIntervalSec", 300);
  return Number.isFinite(raw) && raw >= 30 ? Math.floor(raw) : 300;
}

export function liveStatusEnabled(): boolean {
  return configFlag("integrations", "liveStatus");
}

/** Required credential names per kind, mirrored from the route so a missing field is not a test call. */
export function missingCredentials(kind: string, credentials: Record<string, string>): string[] {
  const requirements: Record<string, string[]> = {
    quickbooks: ["clientId", "clientSecret", "realmId", "accessToken"],
    microsoft365: ["tenantId", "clientId", "clientSecret"],
    ninjaone: ["clientId", "clientSecret"],
    datto: ["apiKey", "apiSecret"],
    freshdesk: ["domain", "apiKey"],
    xero: ["clientId", "clientSecret", "tenantId"],
    flexpoint: ["apiSecret"],
  };
  const required = requirements[kind] ?? [];
  return required.filter(field => {
    const value = credentials?.[field];
    return !value || String(value).trim().length === 0;
  });
}

function healthFromRow(
  row: { id: string; enabled: boolean; status: string; errorMessage: string | null; kind: string; credentials: unknown },
  missing: string[],
  now: number,
): IntegrationHealth {
  const last = verifications.get(row.id);
  const interval = intervalSeconds();
  const ageSeconds = last ? Math.round((now - last.at) / 1000) : null;

  let state: IntegrationHealth["state"];
  let detail: string;
  if (!row.enabled) {
    state = "off";
    detail = "Switched off — it is not being verified.";
  } else if (missing.length > 0) {
    state = "unconfigured";
    detail = `Waiting on ${missing.join(", ")} — nothing is sent to the vendor until it is complete.`;
  } else if (!last) {
    state = row.status === "connected" ? "healthy" : row.status === "error" ? "degraded" : "unconfigured";
    detail = last === undefined && row.status === "connected"
      ? "Last known state from setup; not verified since this process started."
      : row.errorMessage || "Not verified yet.";
  } else if (last.ok) {
    state = "healthy";
    detail = last.detail;
  } else {
    state = "degraded";
    detail = last.detail;
  }

  return {
    state,
    detail,
    verifiedAt: last ? new Date(last.at).toISOString() : null,
    ageSeconds,
    stale: ageSeconds === null ? true : ageSeconds > interval,
    consecutiveFailures: last?.failures ?? 0,
    missingFields: missing,
    checking: inFlight.has(row.id),
  };
}

export interface VerifiedRow {
  id: string;
  enabled: boolean;
  status: string;
  errorMessage: string | null;
  kind: string;
  credentials: unknown;
  health: IntegrationHealth;
}

/**
 * Verifies whichever integrations are due, then describes all of them. The verifying happens here
 * rather than in the browser so that the number of vendor calls depends on how many integrations
 * exist, not on how many tabs are open.
 */
export async function verifyDueIntegrations(
  test: (config: IntegrationConfig) => Promise<boolean>,
  toConfig: (row: { id: string; kind: string; name: string; enabled: boolean; credentials: unknown; settings: unknown; status: string; errorMessage: string | null; lastSyncAt: Date | null }) => IntegrationConfig,
): Promise<VerifiedRow[]> {
  const rows = await prisma.integration.findMany({ orderBy: { createdAt: "desc" } });
  const now = Date.now();
  const intervalMs = intervalSeconds() * 1000;
  const enabled = liveStatusEnabled();

  if (enabled) {
    const due = rows.filter(row => {
      if (!row.enabled) return false;
      if (inFlight.has(row.id)) return false;
      if (missingCredentials(row.kind, row.credentials as Record<string, string>).length > 0) return false;
      const last = verifications.get(row.id);
      return !last || now - last.at >= intervalMs;
    });

    await Promise.all(due.map(async row => {
      inFlight.add(row.id);
      // The answer is written down whenever it arrives, even if this request has already moved on:
      // a slow vendor must not hold a page open, and must not be asked twice either.
      const settled = test(toConfig(row as never))
        .then(async ok => {
          const previous = verifications.get(row.id);
          verifications.set(row.id, {
            at: Date.now(),
            ok,
            detail: ok ? "Verified just now — the connection answered." : "The last check failed.",
            failures: ok ? 0 : (previous?.failures ?? 0) + 1,
          });
          // Keep the stored status in step with what was just observed, so the badge and the chip
          // cannot tell two different stories.
          const nextStatus = ok ? "connected" : "error";
          if (row.status !== nextStatus || (!ok && !row.errorMessage)) {
            await prisma.integration.update({
              where: { id: row.id },
              data: { status: nextStatus, errorMessage: ok ? null : (row.errorMessage || "The last automatic check could not reach the service") },
            });
          }
        })
        .catch((err: Error) => {
          verifications.set(row.id, {
            at: Date.now(),
            ok: false,
            detail: `Check could not run: ${err.message}`,
            failures: (verifications.get(row.id)?.failures ?? 0) + 1,
          });
        })
        .finally(() => { inFlight.delete(row.id); });

      await Promise.race([
        settled,
        new Promise<void>(resolve => setTimeout(resolve, VERIFY_WAIT_MS)),
      ]);
    }));
  }

  const fresh = enabled ? await prisma.integration.findMany({ orderBy: { createdAt: "desc" } }) : rows;
  return fresh.map(row => {
    const missing = missingCredentials(row.kind, row.credentials as Record<string, string>);
    return {
      id: row.id,
      enabled: row.enabled,
      status: row.status,
      errorMessage: row.errorMessage,
      kind: row.kind,
      credentials: row.credentials,
      health: enabled
        ? healthFromRow(row, missing, Date.now())
        : { state: "healthy", detail: "Live status is switched off.", verifiedAt: null, ageSeconds: null, stale: true, consecutiveFailures: 0, missingFields: missing, checking: false },
    };
  });
}

/** Records a verification the operator ran by hand, so the chip reflects it immediately. */
export function noteManualVerification(id: string, ok: boolean, detail?: string): void {
  const previous = verifications.get(id);
  verifications.set(id, { at: Date.now(), ok, detail: detail || (ok ? "Verified just now — the connection answered." : "The connection test failed."), failures: ok ? 0 : (previous?.failures ?? 0) + 1 });
}

/** Test-only seam: forget everything, so a probe run describes that run. */
export function resetVerifications(): void {
  verifications.clear();
  inFlight.clear();
}
