/**
 * The purge dry run, the purge's rules, and its receipt.
 *
 * The act itself lives in `services/sampleDataOperations.ts`, shared with the CLI, because a route that
 * re-implemented the wipe would be a second definition of what a purge removes. What is here is what the
 * screen needs around it:
 *
 *   · **the dry run** — per model, what would be deleted, what would be preserved, and the third list
 *     that is the reason the screen exists: models the schema declares that neither list names, and which
 *     therefore *survive* a purge. That is not a defect in the lists; it is the fact an operator has to
 *     see before pressing the button, because 21 models of live-shaped data outliving a "purge" is how
 *     somebody ships demo companies into production;
 *   · **the refusal rules** — the exact phrase, and a reason that is a sentence rather than a word;
 *   · **the receipt** — where it is kept, and the fact that it *cannot* be kept only in the audit trail,
 *     because the purge deletes the audit trail.
 */
import { prisma } from "../index";
import {
  AUDIT_MODEL,
  KEEP_MODELS,
  WIPE_MODELS,
  readRepoFile,
  readSnapshotManifest,
  type SnapshotManifest,
} from "./sampleDataOperations";
import { isSampleDataDisabled } from "./sampleDataState";

/**
 * The phrase the operator must type.
 *
 * Returned by the dry run (`requiredPhrase`) rather than written twice, so the screen cannot invent its
 * own and the server cannot outgrow the one on the page. It says what is about to happen rather than
 * naming a random token: a phrase that can be re-typed from memory is a phrase that gets typed by
 * accident, and one that a person has to read is one they have to mean.
 */
export const PURGE_PHRASE = "purge sample data";

/**
 * Reserved `SystemConfig` namespace for the sample-data feature.
 *
 * It already exists — `RESERVED_CONFIG_PREFIXES` in `routes/system.ts` withholds `sample_data` rows from
 * every HTTP caller, administrator included — and the receipt goes where that rule already protects it
 * rather than inventing a second convention. The row is written through Prisma, which is how a service
 * reads and writes a reserved key.
 */
export const PURGE_RECEIPT_PREFIX = "sample_data:purge:";
/** The row that always holds the newest receipt, so reading the last purge needs no scan. */
export const PURGE_RECEIPT_LATEST = `${PURGE_RECEIPT_PREFIX}last`;

export interface PurgeModelCount {
  model: string;
  count: number;
  /** Why this model is on its list, in the payload rather than in the screen's guess. */
  why: string;
  /** True when the count could not be taken (the generated client has no delegate for it). */
  unreadable?: boolean;
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
  snapshot: (SnapshotManifest & { locked: boolean }) | null;
  /** Rows of `auditLog` inside the removed figure — the trail the purge also takes. */
  auditRows: number | null;
  /** Whether the marker is already set, which locks the snapshot and pauses automatic capture. */
  disabled: boolean;
  requiredPhrase: string;
  /** The order the wipe runs in, said plainly, because children have to go before parents. */
  order: string;
  /** What happens while the marker is set, so the screen can say it before it is set. */
  lockEffect: string;
}

/** The Prisma delegate name for a schema model: `KBArticleVersion` → `kBArticleVersion`. */
function delegateName(model: string): string {
  return model.charAt(0).toLowerCase() + model.slice(1);
}

/** Every model `apps/api/prisma/schema.prisma` declares, as delegate names. */
export function schemaModels(): string[] {
  const source = readRepoFile("apps/api/prisma/schema.prisma");
  if (!source) return [];
  const models: string[] = [];
  for (const match of source.matchAll(/^model\s+(\w+)\s*\{/gm)) {
    if (match[1]) models.push(delegateName(match[1]));
  }
  return models;
}

/**
 * The models neither list names.
 *
 * Computed from the schema rather than hard-coded, because the list is only useful while it is *true*: a
 * model added to the schema tomorrow appears here the next time this is read, which is the whole point —
 * a purge that quietly stopped covering a new table would otherwise look complete.
 */
export function unlistedModels(): string[] {
  const wipe = new Set(WIPE_MODELS);
  const keep = new Set(KEEP_MODELS);
  return schemaModels().filter((model) => !wipe.has(model) && !keep.has(model));
}

/** Count rows for one delegate, or report that the delegate does not exist. */
async function countModel(model: string): Promise<{ count: number; unreadable: boolean }> {
  const delegate = (prisma as unknown as Record<string, { count?: () => Promise<number> } | undefined>)[model];
  if (!delegate || typeof delegate.count !== "function") return { count: 0, unreadable: true };
  try {
    return { count: await delegate.count(), unreadable: false };
  } catch {
    return { count: 0, unreadable: true };
  }
}

/** Run `count` over a list with a small concurrency limit, so 119 counts do not open 119 connections. */
async function countAll(models: readonly string[], why: (model: string) => string, limit = 8): Promise<PurgeModelCount[]> {
  const results: PurgeModelCount[] = [];
  for (let start = 0; start < models.length; start += limit) {
    const batch = models.slice(start, start + limit);
    const counted = await Promise.all(batch.map((model) => countModel(model)));
    batch.forEach((model, index) => {
      const found = counted[index];
      results.push({
        model,
        count: found?.count ?? 0,
        why: found?.unreadable ? `${why(model)} (this client has no ${model} delegate)` : why(model),
        ...(found?.unreadable ? { unreadable: true } : {}),
      });
    });
  }
  return results;
}

/**
 * The dry run: what a purge would remove, what it would preserve, and what it would leave standing.
 *
 * Everything is counted from the live database rather than from the snapshot, because the snapshot is
 * what a purge takes, not what it removes.
 */
export async function previewPurge(): Promise<PurgePreview> {
  const [removed, preserved, unlisted] = await Promise.all([
    countAll(WIPE_MODELS, () => "deleted by db:sample-off — WIPE_MODELS, children before parents"),
    countAll(KEEP_MODELS, () => "kept so the instance stays usable — KEEP_MODELS, identity and platform configuration"),
    countAll(unlistedModels(), () => "declared in schema.prisma and named by neither list, so it survives a purge"),
  ]);

  const rows = removed.reduce((total, model) => total + model.count, 0);
  const tables = removed.filter((model) => model.count > 0).length;
  const auditEntry = removed.find((model) => model.model === AUDIT_MODEL);
  const manifest = readSnapshotManifest();
  const disabled = isSampleDataDisabled();

  return {
    removed,
    preserved,
    unlisted,
    dryRun: { rows, tables },
    snapshot: manifest ? { ...manifest, locked: disabled } : null,
    auditRows: auditEntry?.count ?? null,
    disabled,
    requiredPhrase: PURGE_PHRASE,
    order: "children before parents: the wipe follows WIPE_MODELS in the order it is declared",
    lockEffect:
      "While the marker is set the snapshot is locked — automatic snapshot capture and the automatic reseed " +
      "after a change both stop — and db:sample-on is what clears it and reseeds from the snapshot.",
  };
}

/**
 * Validate the two fields the POST carries, and name the one that failed.
 *
 * A refusal that says only "bad request" makes the caller guess which of two things was wrong, and the
 * phrase is a phrase precisely so that a wrong one is *noticed*. The reason rule is deliberately about
 * shape rather than vocabulary: "a sentence" means at least a few words, so a single `x` cannot stand in
 * for the explanation a future reader will need.
 */
export interface ValidationFailure {
  field: "phrase" | "reason";
  message: string;
}

export function validatePurgeRequest(body: unknown): { ok: true; phrase: string; reason: string } | { ok: false; failures: ValidationFailure[] } {
  const source = (body ?? {}) as Record<string, unknown>;
  const phrase = typeof source.phrase === "string" ? source.phrase : "";
  const reason = typeof source.reason === "string" ? source.reason : "";
  const failures: ValidationFailure[] = [];

  if (phrase.trim() !== PURGE_PHRASE) {
    failures.push({
      field: "phrase",
      message: `The phrase does not match. Type "${PURGE_PHRASE}" exactly as the preview shows it.`,
    });
  }

  const trimmedReason = reason.trim();
  const words = trimmedReason.split(/\s+/).filter(Boolean);
  if (trimmedReason.length < 10 || words.length < 3) {
    failures.push({
      field: "reason",
      message: "A reason is required: a sentence of at least three words, saying why this purge is being run.",
    });
  }

  if (failures.length) return { ok: false, failures };
  return { ok: true, phrase: phrase.trim(), reason: trimmedReason };
}

/** The receipt: what was done, by whom, with what authorisation, and where it was written. */
export interface PurgeReceipt {
  operation: string;
  /** When the purge finished, ISO. */
  at: string;
  actor: string | null;
  actorRole: string | null;
  ip: string | null;
  reason: string;
  /** The phrase that authorised it, recorded as typed. */
  phrase: string;
  dryRun: PurgeCounts;
  removed: PurgeCounts;
  preserved: PurgeCounts;
  unlisted: { rows: number; models: number };
  snapshot: SnapshotManifest | null;
  flag: string;
  /** The key of the audit row, or null when the audit write failed. */
  auditId: string | null;
  /** Where the record was written outside the wiped set — the receipt has to name it. */
  receiptPath: string;
  wrote: string;
}

/** Everything the receipt records, before it is written anywhere. */
export interface ReceiptDraft {
  actor: string | null;
  actorRole: string | null;
  ip: string | null;
  reason: string;
  phrase: string;
  /** What the dry run said, immediately before the purge ran. */
  before: PurgeCounts;
  removed: PurgeCounts;
  preserved: PurgeCounts;
  unlisted: { rows: number; models: number };
  snapshot: SnapshotManifest | null;
}

/** Rows and non-empty tables in a list of per-model counts. */
export function countsOf(models: readonly PurgeModelCount[]): PurgeCounts {
  return {
    rows: models.reduce((total, model) => total + model.count, 0),
    tables: models.filter((model) => model.count > 0).length,
  };
}

/** The audit row, written **after** the wipe so the wipe cannot delete it. Null when the write failed. */
export async function writePurgeAuditRow(draft: ReceiptDraft): Promise<string | null> {
  try {
    const row = await prisma.auditLog.create({
      data: {
        action: "sample_data:purge",
        entity: "sample_data",
        entityId: new Date().toISOString(),
        changes: {
          reason: draft.reason,
          removedRows: draft.removed.rows,
          removedTables: draft.removed.tables,
          preservedRows: draft.preserved.rows,
          unlistedRows: draft.unlisted.rows,
          snapshot: draft.snapshot?.capturedAt ?? null,
          receipt: PURGE_RECEIPT_LATEST,
        },
        userId: draft.actor ?? "system",
        ipAddress: draft.ip,
      },
    });
    return row.id;
  } catch {
    // The durable copy is the one that must not be lost, and it is written next.
    return null;
  }
}

/**
 * Write the receipt where the purge cannot reach it.
 *
 * The audit row is written too — it is the trail every other operator surface reads — but the purge
 * deletes `auditLog`, so a receipt kept *only* there is a receipt destroyed by the act it describes. The
 * `SystemConfig` row under the reserved `sample_data:` prefix is the durable copy, and the response names
 * it so nobody has to guess where the record went.
 */
export async function writePurgeReceipt(draft: ReceiptDraft & { auditId: string | null }): Promise<PurgeReceipt> {
  const at = new Date().toISOString();
  const receipt: PurgeReceipt = {
    operation: "sample-data-purge (db:sample-off)",
    at,
    actor: draft.actor,
    actorRole: draft.actorRole,
    ip: draft.ip,
    reason: draft.reason,
    phrase: draft.phrase,
    dryRun: draft.before,
    removed: draft.removed,
    preserved: draft.preserved,
    unlisted: draft.unlisted,
    snapshot: draft.snapshot,
    flag: "apps/api/src/.sample-data-disabled — snapshot locked, automatic capture and reseed paused",
    auditId: draft.auditId,
    receiptPath: `SystemConfig ${PURGE_RECEIPT_LATEST}`,
    wrote:
      `Kept in SystemConfig under the reserved sample_data: prefix (${PURGE_RECEIPT_LATEST} and ` +
      `${PURGE_RECEIPT_PREFIX}${at}), which the purge does not touch, and in the audit trail as ` +
      `${draft.auditId ? `row ${draft.auditId}` : "a row that could not be written"}. The audit trail is ` +
      "deleted by the purge, which is why the SystemConfig copy exists.",
  };

  await prisma.systemConfig.upsert({
    where: { key: PURGE_RECEIPT_LATEST },
    create: { key: PURGE_RECEIPT_LATEST, value: receipt as unknown as object },
    update: { value: receipt as unknown as object },
  });
  await prisma.systemConfig.upsert({
    where: { key: `${PURGE_RECEIPT_PREFIX}${at}` },
    create: { key: `${PURGE_RECEIPT_PREFIX}${at}`, value: receipt as unknown as object },
    update: { value: receipt as unknown as object },
  });

  return receipt;
}
