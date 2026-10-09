import { useCallback, useEffect, useState } from "react";
import api from "../../api";
import { apiErrorMessage } from "../../lib/apiError";

/**
 * The Developer section's reads, and the one shape every page uses for them.
 *
 * The whole point of these screens is that they never pretend: a `skip` is not a pass, a failed call is
 * not a pass, and an endpoint that is not there yet is not an empty panel. So the reads do not resolve
 * to `null` and leave the page to guess — they resolve to a **status** the page must draw:
 *
 *   · `loading`      — the page draws its skeleton;
 *   · `ok`           — the record arrived, and the data is not null;
 *   · `unavailable`  — the read failed, and `message` says *what could not be read and why*, in words
 *                      the page prints verbatim. There is deliberately no "empty" success state: the
 *                      API either answered with a record or it did not, and the two are drawn
 *                      differently.
 *
 * `what` is the noun the failure message is about ("The environment badge", "The purge dry run"), so
 * the sentence reads as a person wrote it rather than as the browser reported it.
 */

export type ReadStatus = "loading" | "ok" | "unavailable";

export interface Read<T> {
  status: ReadStatus;
  /** The record, or `null` while loading and when the read failed. Never `null` when `status === "ok"`. */
  data: T | null;
  /** What could not be read, in the words the page prints. `null` while loading and on success. */
  message: string | null;
  /** Re-run the read — the retry a failed panel offers. */
  reload: () => void;
}

/** Turn a failed request into the sentence a panel shows, distinguishing "absent" from "broken". */
export function describeReadFailure(err: unknown, what: string): string {
  const status = (err as { response?: { status?: number } } | undefined)?.response?.status;
  if (status === 404) return `${what} could not be read: this instance does not serve that endpoint yet (404).`;
  if (status === undefined) return `${what} could not be read: the request did not reach the API.`;
  const api = apiErrorMessage(err, "");
  return api ? `${what} could not be read: ${api}` : `${what} could not be read: the API answered ${status}.`;
}

export function useDeveloperRead<T>(path: string, what: string): Read<T> {
  const [state, setState] = useState<{ status: ReadStatus; data: T | null; message: string | null }>({
    status: "loading",
    data: null,
    message: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setState({ status: "loading", data: null, message: null });
    api
      .get<T>(path)
      .then((res) => {
        if (!cancelled) setState({ status: "ok", data: res.data, message: null });
      })
      .catch((err) => {
        if (!cancelled) setState({ status: "unavailable", data: null, message: describeReadFailure(err, what) });
      });
    return () => {
      cancelled = true;
    };
  }, [path, what, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, reload };
}

// ── The environment badge ────────────────────────────────────────────────────────────────────────
// Drawn by the section rather than by a page, so it says the same thing on every screen.

export interface EnvironmentBadge {
  nodeEnv: string;
  isProduction: boolean;
  host: string | null;
  port: number | null;
  version: string | null;
  commit: string | null;
}

export interface EnvironmentVariable {
  name: string;
  set: boolean;
  /** The effective value. Never a secret's value — secrets are reported as set, with a `hint`. */
  effective: string | null;
  source: "env" | "default";
  secret: boolean;
  hint: string | null;
}

export interface DeveloperEnvironment {
  badge: EnvironmentBadge;
  env: EnvironmentVariable[];
  /** The flag registry and the app_settings sections, as the catalogue's read-only rows. */
  flags: Array<Record<string, unknown>>;
  settings: Array<Record<string, unknown>>;
}

// ── The purge dry run ────────────────────────────────────────────────────────────────────────────

export interface PurgeModelCount {
  model: string;
  count: number;
  /** Why this model is on the list — the reason the dry run reports, not the screen's guess. */
  why?: string | null;
}

export interface PurgeSnapshot {
  /** The manifest the snapshot was read from, and when it was written. */
  file?: string | null;
  name?: string | null;
  capturedAt?: string | null;
  files?: number | null;
  records?: number | null;
  locked?: boolean | null;
}

export interface PurgeCounts {
  rows: number;
  tables: number;
}

export interface PurgePreview {
  removed: PurgeModelCount[];
  preserved: PurgeModelCount[];
  unlisted: PurgeModelCount[];
  dryRun: PurgeCounts;
  snapshot: PurgeSnapshot | null;
  /** Rows of `auditLog` inside the total — the trail the purge also takes. */
  auditRows: number | null;
  /** Whether the sample-data marker file is already set (the purge already ran). */
  disabled: boolean;
  /** The exact phrase the confirmation must be typed against. Never the page's own invention. */
  requiredPhrase: string;
}

export interface PurgeReceipt {
  operation?: string | null;
  actor?: string | null;
  ip?: string | null;
  reason?: string | null;
  dryRun?: PurgeCounts | null;
  removed?: PurgeCounts | null;
  preserved?: PurgeCounts | null;
  unlisted?: { rows?: number; models?: number } | null;
  snapshot?: string | null;
  flag?: string | null;
  auditId?: string | null;
  /** Where the record was written outside the wiped set — the receipt has to name it. */
  receiptPath?: string | null;
  wrote?: string | null;
  [key: string]: unknown;
}

// ── Repo health ──────────────────────────────────────────────────────────────────────────────────

export type HealthStatus = "pass" | "fail" | "skip";

export interface HealthCheck {
  id: string;
  label: string;
  command?: string | null;
  status: HealthStatus;
  /** What the check printed. A `skip` carries the reason it could not run, not an empty string. */
  detail?: string | null;
  ms?: number | null;
}

export interface RepoHealth {
  checks: HealthCheck[];
}

// ── API keys, read for the danger zone's countable sentence ──────────────────────────────────────
// `/api-keys` is the product's own route (UserManage); Developer Admin holds it. Reading it here is
// what lets the rotate card say how many callers it stops rather than describing them vaguely. The
// route answers in the list envelope the rest of the product uses — `{ data: [...] }` — not a bare
// array, which is why the response has its own type rather than being typed as the rows.

export interface ApiKeySummary {
  id: string;
  name?: string | null;
  prefix?: string | null;
  lastUsedAt?: string | null;
  revokedAt?: string | null;
}

/** The list envelope `/api-keys` answers with. */
export interface ApiKeysResponse {
  data: ApiKeySummary[];
}

export function useDeveloperEnvironment(): Read<DeveloperEnvironment> {
  return useDeveloperRead<DeveloperEnvironment>("/developer/environment", "The environment badge");
}

export function usePurgePreview(): Read<PurgePreview> {
  return useDeveloperRead<PurgePreview>("/developer/purge/preview", "The purge dry run");
}

export function useRepoHealth(): Read<RepoHealth> {
  return useDeveloperRead<RepoHealth>("/developer/health", "The repo-health checks");
}

export function useApiKeys(): Read<ApiKeysResponse> {
  return useDeveloperRead<ApiKeysResponse>("/api-keys?includeRevoked=true", "The API key list");
}
