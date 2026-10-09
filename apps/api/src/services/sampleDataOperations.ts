/**
 * The sample-data operations, in one place, so the CLI and the Developer section perform the same act.
 *
 * `pnpm db:sample-off` / `db:sample-on` were the only way to run this, and the Developer section's purge
 * screen puts a face on the same operation. A second implementation would be a second definition of
 * "what a purge removes" — and the two would drift the first time a model was added to one of them. So
 * the behaviour was **factored out of `sample-data-toggle.ts` rather than re-written**: the CLI keeps its
 * argument parsing and its log lines, and calls these functions; the route calls the same functions.
 *
 * What that cost, said plainly, because it is the part worth reviewing:
 *
 *   · the script used `execSync`, which blocks the event loop for the length of a snapshot capture. That
 *     is fine for a command somebody typed and wrong inside a request, so the child process is now
 *     `spawn`ed and awaited — the CLI still waits (it `await`s), and a request no longer freezes the
 *     server while the capture runs;
 *   · the script opened its own `PrismaClient`. The wipe now takes the caller's client, so the route
 *     reuses the server's pool instead of opening a second one, and the CLI still opens its own;
 *   · the per-model log lines moved from inside the loop to an `onDeleted` callback the CLI supplies, so
 *     the CLI's output is unchanged and a route can collect the same figures instead of printing them.
 *
 * Everything that decides *what* a purge removes — the model lists, their order, the disabled marker and
 * which script reseeds — lives here, and both callers ask this module.
 */
import { spawn } from "child_process";
import { existsSync, readFileSync } from "fs";
import * as path from "path";
import type { Prisma, PrismaClient } from "@prisma/client";
import { setSampleDataDisabled } from "./sampleDataState";

/**
 * Models preserved on disable: identity and platform configuration, so the instance stays usable
 * (login, RBAC, system settings, locales). The purge cannot tell a demo account from an administrator,
 * which is why these are reviewed by a person rather than wiped.
 */
export const KEEP_MODELS: readonly string[] = [
  "user", "role", "session", "refreshToken", "tenant",
  "systemConfig", "ssoConfig", "fieldPermission",
  "locale", "translation", "currency", "exchangeRate", "retentionPolicy",
];

/** Wipe order: children before parents. */
export const WIPE_MODELS: readonly string[] = [
  "kBArticleTicket", "kBArticleAttachment", "kBArticleVersion", "knowledgeBaseArticle", "kBCategory",
  "surveyAnswer", "surveyResponse", "surveyQuestion", "survey",
  "projectTaskDependency", "projectTask", "projectPhase", "project",
  "checklistTask", "checklist",
  "contractMilestone", "contract", "assetAssignment", "asset",
  "pOLineItem", "purchaseOrder", "vendor",
  "workflowExecution", "workflowRuleAction", "workflowRule",
  "chatMessage", "chatSession",
  "reportSchedule", "report",
  "ticketContact", "ticketAttachment", "ticketComment", "timeEntry", "ticket", "ticketCategory", "emailConnector", "serviceBoard",
  "invoiceLineItem", "payment", "invoice", "serviceAgreement",
  "salesActivity", "opportunity",
  "notification", "auditLog", "alertLog", "alertWebhookDelivery", "alertRule", "expense", "recentlyViewedItem",
  "serviceAlert", "serviceAlertService",
  "m365Subscription", "m365Group", "m365User", "syncedEntity", "syncLog", "integration", "webhookConfig",
  "technicianSkill", "scheduleEntry", "ptoRequest", "holiday", "bulkOperation", "calendarSyncConfig",
  "kumoFile", "kumoCertificate", "kumoDomain", "kumoLink", "kumoDocumentRevision",
  "kumoDocument", "kumoFolder", "kumoPasswordAccessLog", "kumoPassword",
  "kumoNetworkDevice", "kumoWorkstation", "kumoServer",
  "kumoAssetFieldValue", "kumoAsset", "kumoTemplateField", "kumoAssetTemplate",
  "aiProviderConfig", "inferenceCache", "ticketSimilarity", "detectedPattern",
];

/** The model that carries the audit trail — reported separately because the purge takes it too. */
export const AUDIT_MODEL = "auditLog";

/** The script that snapshots the database before a purge, and the one that puts it back. */
export const SNAPSHOT_CAPTURE_SCRIPT = "snapshot-capture.ts";
export const SEED_FROM_SNAPSHOTS_SCRIPT = "seed-from-snapshots.ts";

/** The two directories the child scripts are run from and into, respectively (`apps/api/src`). */
const API_SRC = path.join(__dirname, "..");

export interface WipedModel {
  model: string;
  rows: number;
}

export interface WipeResult {
  /** Rows deleted across every model. */
  rows: number;
  /** Models that actually lost rows. */
  tables: number;
  /** Per-model figures, in the child-before-parent order above, models with no rows omitted. */
  models: WipedModel[];
}

/** The client a wipe can run on: the server's pool, or a transaction for a rehearsal. */
type SampleDataClient = PrismaClient | Prisma.TransactionClient;

/**
 * Delete everything on `WIPE_MODELS`, in order, tolerating a model the generated client does not have.
 *
 * The tolerance is not laziness: the list is kept ahead of the schema on purpose so that a table added
 * later is purged by the list rather than forgotten, and a delegate that does not exist yet must not
 * stop the models after it from being emptied.
 */
export async function wipeBusinessData(
  client: SampleDataClient,
  onDeleted?: (model: string, rows: number) => void,
): Promise<WipeResult> {
  const delegates = client as unknown as Record<string, { deleteMany?: () => Promise<{ count: number }> }>;
  let rows = 0;
  let tables = 0;
  const models: WipedModel[] = [];

  for (const modelName of WIPE_MODELS) {
    const model = delegates[modelName];
    if (model && typeof model.deleteMany === "function") {
      try {
        const result = await model.deleteMany();
        if (result.count > 0) {
          rows += result.count;
          tables += 1;
          models.push({ model: modelName, rows: result.count });
          onDeleted?.(modelName, result.count);
        }
      } catch { /* table may not exist yet */ }
    }
  }

  return { rows, tables, models };
}

export interface SnapshotManifest {
  /** The manifest file, named relative to the repository so the receipt reads the same everywhere. */
  file: string;
  /** When the snapshot was taken, ISO, or null when the manifest does not say. */
  capturedAt: string | null;
  /** How many fixture files the snapshot wrote. */
  files: number;
  /** How many records those fixtures hold, as the capture counted them. */
  records: number;
  /** Records per model, as the capture counted them. */
  tables: Record<string, number>;
}

/**
 * Walk up from this file to the repository root, which is where `turbo.json` lives.
 *
 * The API runs from `src` under `tsx` and from `dist` when built, and the repository's own guards and
 * templates have to be found from both; walking up is what `routes/system.ts` does to find
 * `BuildNotes.md`, and doing it differently here would be a second rule for the same problem.
 */
function findRepoRoot(): string | null {
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (existsSync(path.join(dir, "turbo.json"))) return dir;
    const parent = path.resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/** The repository root, or null when this file is running outside a checkout. */
export const repoRoot = findRepoRoot();

/**
 * Read a repository-relative file, or null when it is not present.
 *
 * The file is looked for under the root found above and then under each directory between this file and
 * it, so a path that is written relative to the repository works whether this runs from `src`, from
 * `dist`, or from a checkout whose root is found differently.
 */
export function readRepoFile(relativePath: string): string | null {
  const candidates: string[] = [];
  if (repoRoot) candidates.push(path.join(repoRoot, relativePath));
  let dir = __dirname;
  for (let i = 0; i < 6; i++) {
    candidates.push(path.join(dir, relativePath));
    const parent = path.resolve(dir, "..");
    if (parent === dir) break;
    dir = parent;
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return readFileSync(candidate, "utf8");
    } catch { /* try the next candidate */ }
  }
  return null;
}

/** True when the repository-relative path exists on this working copy. */
export function repoFileExists(relativePath: string): boolean {
  return readRepoFile(relativePath) !== null;
}

/**
 * The newest snapshot on disk, read from the manifest the capture writes.
 *
 * The manifest rather than the fixture files: it is written last, it names what is inside, and it is
 * what the purge receipt quotes, so the receipt and the screen cannot describe different snapshots.
 */
export function readSnapshotManifest(): SnapshotManifest | null {
  const raw = readRepoFile(path.join("apps", "api", "src", "snapshots", "_manifest.json"));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { capturedAt?: unknown; totalRecords?: unknown; tables?: unknown };
    const tables = (parsed.tables && typeof parsed.tables === "object" ? parsed.tables : {}) as Record<string, number>;
    return {
      file: "apps/api/src/snapshots/_manifest.json",
      capturedAt: typeof parsed.capturedAt === "string" ? parsed.capturedAt : null,
      files: Object.keys(tables).length,
      records: typeof parsed.totalRecords === "number" ? parsed.totalRecords : 0,
      tables,
    };
  } catch {
    return null;
  }
}

export interface ScriptRunOptions {
  /** How long the child may run. Generous, because a capture reads every table. */
  timeoutMs?: number;
}

/**
 * Run one of the API's own maintenance scripts as a child process, exactly as the CLI did.
 *
 * `stdio: "inherit"` keeps the CLI's output on the caller's console; a route's child inherits the
 * server's, which is where a long operation's progress belongs. The timeout exists so a request cannot
 * wait forever on a child that has wedged — the CLI used no timeout because a person was watching it.
 */
export function runApiScript(script: string, options: ScriptRunOptions = {}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 15 * 60_000;
  return new Promise((resolve, reject) => {
    const child = spawn(`npx tsx "${path.join(API_SRC, script)}"`, {
      cwd: API_SRC,
      stdio: "inherit",
      shell: true,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
    });

    const timer = setTimeout(() => {
      child.kill();
      reject(new Error(`${script} did not finish within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.on("error", (error) => { clearTimeout(timer); reject(error); });
    child.on("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${script} exited with code ${code ?? "unknown"}`));
    });
  });
}

export interface DisableResult extends WipeResult {
  /** The snapshot that was taken first, as the manifest describes it. */
  snapshot: SnapshotManifest | null;
}

export interface DisableOptions extends ScriptRunOptions {
  /** Called once per model that lost rows, in wipe order. The CLI prints from here. */
  onDeleted?: (model: string, rows: number) => void;
  /** Called as each step begins, so a caller can narrate without knowing the order. */
  onStep?: (step: "snapshot" | "wipe" | "flag") => void;
}

/**
 * Disable sample data: snapshot first, then wipe, then set the marker.
 *
 * The order is the safeguard and is not negotiable: the snapshot is what `db:sample-on` reseeds from,
 * so a wipe that ran before it would leave nothing to restore. The marker is set last, because while it
 * is set snapshot captures are locked — setting it first would lock out the capture this needs.
 */
export async function disableSampleData(
  client: SampleDataClient,
  options: DisableOptions = {},
): Promise<DisableResult> {
  options.onStep?.("snapshot");
  await runApiScript(SNAPSHOT_CAPTURE_SCRIPT, options);

  options.onStep?.("wipe");
  const wiped = await wipeBusinessData(client, options.onDeleted);

  options.onStep?.("flag");
  setSampleDataDisabled(true);

  return { ...wiped, snapshot: readSnapshotManifest() };
}

/**
 * Enable sample data: reseed from the preserved snapshot, then clear the marker.
 *
 * The marker is cleared last, so a reseed that failed part-way leaves the snapshot locked rather than
 * letting the auto-snapshot middleware capture a half-restored database over the good fixture.
 */
export async function enableSampleData(options: ScriptRunOptions = {}): Promise<void> {
  await runApiScript(SEED_FROM_SNAPSHOTS_SCRIPT, options);
  setSampleDataDisabled(false);
}
