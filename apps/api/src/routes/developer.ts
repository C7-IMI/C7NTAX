/**
 * The Developer section's API.
 *
 * Five reads and one act, all of which exist because they answer a question nothing else in the product
 * can: what this instance is configured to be (environment), what a purge would destroy before it
 * destroys it (purge/preview), the purge itself, whether the repository's own checks pass on this working
 * copy (health), and where the deployment stands against PLAN-030 (deployment).
 *
 * **Permissions, and the one decision worth stating.** Every route needs `developer:view`. The purge
 * needs `developer:purge` **on top of** it, not instead of it — the two are chained rather than listed
 * together, because `requirePermission` admits a caller holding *any* of the permissions it is given, and
 * a single call naming both would let a `developer:view`-only account empty the database. Both are held
 * only by the `Developer Admin` role; Super Admin and Admin deliberately do not inherit them, so a
 * compromised administrator session is not a purge. A role may hold `developer:view` alone — the
 * environment inspector, the checklist and the deployment report are useful without the destructive act.
 *
 * **The purge is the CLI's own code path.** `POST /purge` calls `disableSampleData`, which is the function
 * `pnpm db:sample-off` now calls, so the two cannot disagree about what a purge removes. What the route
 * adds is what a command line does not need: the typed phrase, a required reason, a receipt kept where the
 * purge cannot delete it, and a refusal when the sample dataset is already off.
 *
 * Two honest notes about running this in a deployment:
 *
 *   · a purge takes as long as the snapshot capture takes, so a client or a reverse proxy may give up
 *     before the answer arrives. The work continues and the receipt is still written — the receipt, not
 *     the connection, is the record. Nothing is half-done if the client disconnects;
 *   · `GET /health` runs child processes, which is why it is a `developer:view` route on an administrator
 *     surface rather than anything a general client is invited to call.
 */
import { Router } from "express";
import { authenticate, requirePermission, type AuthRequest } from "../middleware/auth";
import { Permission } from "@C7NTAX/shared";
import { AppError } from "../middleware/errorHandler";
import { prisma } from "../index";
import {
  SECRET_WITHHELD_NOTE,
  describeEnvironment,
  describeFlags,
  describeSettings,
  environmentBadge,
} from "../services/developerEnvironment";
import {
  countsOf,
  previewPurge,
  validatePurgeRequest,
  writePurgeAuditRow,
  writePurgeReceipt,
  type ReceiptDraft,
} from "../services/developerPurge";
import { disableSampleData } from "../services/sampleDataOperations";
import { isSampleDataDisabled } from "../services/sampleDataState";
import { healthCatalogue, runRepoHealth } from "../services/developerHealth";
import {
  buildDeploymentReportWithRecords,
  saveDeploymentRecord,
  validateDeploymentRecord,
} from "../services/developerDeployment";

export const developerRouter = Router();
developerRouter.use(authenticate);

/** One purge at a time. Two concurrent purges would take two snapshots of two different databases. */
let purgeInFlight = false;

/**
 * The environment inspector: what this instance is configured to be.
 *
 * Every declared environment name with whether it is set here, the value in force, and — for a name that
 * looks like a credential — a hint and the fact that the value is withheld rather than the value. Plus
 * the badge, the flag registry and the effective `app_settings` per configuration section.
 */
developerRouter.get("/environment", requirePermission(Permission.DeveloperView), (_req: AuthRequest, res, next) => {
  try {
    res.json({
      badge: environmentBadge(),
      env: describeEnvironment(),
      flags: describeFlags(),
      settings: describeSettings(),
      /** Said in the payload, not only in the code that read it. */
      secretsWithheld: SECRET_WITHHELD_NOTE,
      generatedAt: new Date().toISOString(),
    });
  } catch (e) { next(e); }
});

/**
 * The dry run: what a purge would remove, what it would preserve, and the models in neither list that
 * therefore survive it.
 */
developerRouter.get("/purge/preview", requirePermission(Permission.DeveloperView), async (_req: AuthRequest, res, next) => {
  try {
    res.json(await previewPurge());
  } catch (e) { next(e); }
});

/**
 * The purge.
 *
 * Refusals, each naming the field that failed: a phrase that is not the one the dry run returned, a
 * reason that is not a sentence, a sample dataset that is already disabled, and a purge that is already
 * running. Everything after that is `db:sample-off`'s own behaviour, called rather than re-implemented.
 */
developerRouter.post(
  "/purge",
  requirePermission(Permission.DeveloperPurge),
  requirePermission(Permission.DeveloperView),
  async (req: AuthRequest, res, next) => {
    try {
      const validated = validatePurgeRequest(req.body);
      if (!validated.ok) {
        const fields = validated.failures.map((failure) => failure.field).join(" and ");
        throw new AppError(
          `Purge refused — the ${fields} ${validated.failures.length === 1 ? "was" : "were"} not accepted. ` +
            validated.failures.map((failure) => failure.message).join(" "),
          400,
          validated.failures,
        );
      }

      if (purgeInFlight) {
        throw new AppError("A purge is already running on this instance. Wait for it to finish before starting another.", 409);
      }
      /**
       * Already disabled is a refusal rather than a no-op. `db:sample-off` returns quietly in that state,
       * and a route that returned quietly would answer a `200` for an act that did not happen — which is
       * the one thing this screen must never do. Re-enabling first (`db:sample-on`) is what makes a second
       * purge meaningful, because only then is there a dataset to remove.
       */
      if (isSampleDataDisabled()) {
        throw new AppError(
          "Sample data is already disabled on this instance, so there is nothing to remove. Run `pnpm db:sample-on` " +
            "first if you meant to reseed and purge again.",
          409,
        );
      }

      /** The dry run immediately before the act, so the receipt can say what it expected and what it got. */
      const before = await previewPurge();

      purgeInFlight = true;
      let wiped;
      try {
        wiped = await disableSampleData(prisma, { timeoutMs: 15 * 60_000 });
      } finally {
        purgeInFlight = false;
      }

      const draft: ReceiptDraft = {
        actor: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
        ip: req.ip || req.socket.remoteAddress || null,
        reason: validated.reason,
        phrase: validated.phrase,
        before: before.dryRun,
        removed: { rows: wiped.rows, tables: wiped.tables },
        preserved: countsOf(before.preserved),
        unlisted: { rows: countsOf(before.unlisted).rows, models: before.unlisted.filter((model) => model.count > 0).length },
        snapshot: wiped.snapshot,
      };

      // The audit row is written after the wipe, because the wipe deletes `auditLog`; the durable copy in
      // `SystemConfig` is written after that, under the reserved `sample_data:` prefix.
      const auditId = await writePurgeAuditRow(draft);
      const receipt = await writePurgeReceipt({ ...draft, auditId });

      res.json(receipt);
    } catch (e) { next(e); }
  },
);

/**
 * The repository's own checks, as they answer on this working copy.
 *
 * A failing check never fails the request: the answer *is* the failure list, and an HTTP 500 instead of
 * "plugin metadata: fail" would hide the thing the panel exists to show. A check that could not run is
 * `skip` with the reason — never a pass.
 */
developerRouter.get("/health", requirePermission(Permission.DeveloperView), async (_req: AuthRequest, res, next) => {
  const catalogue = healthCatalogue();
  try {
    res.json({ checks: await runRepoHealth(), catalogue, generatedAt: new Date().toISOString() });
  } catch (e) {
    /**
     * `runRepoHealth` collects failures rather than throwing, so reaching here means something outside a
     * single check went wrong. Every check is then reported as `skip` with that reason, because a list
     * that came back empty would read as "nothing to check" — the opposite of the truth.
     */
    const reason = e instanceof Error ? e.message : String(e);
    res.json({
      checks: catalogue.map((entry) => ({
        id: entry.id,
        label: entry.label,
        command: entry.command,
        status: "skip" as const,
        detail: `could not run: ${reason}`,
        ms: 0,
      })),
      catalogue,
      error: reason,
      generatedAt: new Date().toISOString(),
    });
  }
});

/**
 * Where the deployment stands against PLAN-030: eight steps, each with a state drawn from five values and
 * a checklist that names what its state was decided from — and what happens if the item is skipped.
 *
 * It also carries what an operator has **recorded** about it: every decision and every checklist item that
 * has been answered comes back with its own `record`, so the screen shows the answer without a second read.
 */
developerRouter.get("/deployment", requirePermission(Permission.DeveloperView), async (_req: AuthRequest, res, next) => {
  try {
    res.json(await buildDeploymentReportWithRecords());
  } catch (e) { next(e); }
});

/**
 * Record the answer to a decision or a check.
 *
 * `{ kind, id, note }`, refused with **400** naming the field that failed — an unknown `kind`, an `id` this
 * report does not name under that kind (a checklist id submitted as a decision is refused rather than filed
 * against the wrong list), or an empty `note`. Recording is **not** destructive, so this needs
 * `developer:view` like its siblings and deliberately not `developer:purge`: deciding what to do about the
 * ingress is not the same act as emptying the database.
 *
 * The answer is kept in `SystemConfig` under the reserved `deployment:record:` prefix, which is the same
 * mechanism the purge receipt uses — reserved in `routes/system.ts` beside `sample_data:`, so no HTTP caller
 * can read or rewrite one there, and untouched by a purge. Recording again **replaces** the answer.
 *
 * The response is the whole updated payload the GET would have returned, plus `saved` naming the record that
 * was just written — one response to re-render from rather than a write followed by a read. `201` when the
 * subject had no answer and one was created; `200` when an earlier answer was replaced.
 */
developerRouter.post(
  "/deployment/records",
  requirePermission(Permission.DeveloperView),
  async (req: AuthRequest, res, next) => {
    try {
      const validated = validateDeploymentRecord(req.body);
      if (!validated.ok) {
        const fields = validated.failures.map((failure) => failure.field).join(" and ");
        throw new AppError(
          `Record refused — the ${fields} ${validated.failures.length === 1 ? "was" : "were"} not accepted. ` +
            validated.failures.map((failure) => failure.message).join(" "),
          400,
          validated.failures,
        );
      }

      const { record, created } = await saveDeploymentRecord({
        kind: validated.kind,
        id: validated.id,
        note: validated.note,
        subject: validated.subject,
        actor: req.user?.userId ?? null,
        actorRole: req.user?.role ?? null,
      });

      const payload = await buildDeploymentReportWithRecords();
      res.status(created ? 201 : 200).json({ ...payload, saved: record });
    } catch (e) { next(e); }
  },
);
