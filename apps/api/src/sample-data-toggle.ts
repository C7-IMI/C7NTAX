/**
 * Sample Data Toggle — disables or enables the sample dataset.
 *
 * Usage:  npx tsx src/sample-data-toggle.ts off   (disable sample data)
 *         npx tsx src/sample-data-toggle.ts on    (enable sample data)
 *
 * OFF ("disable sample data" / "turn off sample data"):
 *   1. Capture a snapshot of the current database (established process).
 *   2. Remove all sample/business data so the application appears empty.
 *   3. Set the disabled flag. While disabled:
 *        - no automatic snapshot captures run (snapshot is locked),
 *        - no automatic reseed happens after changes.
 *
 * ON ("enable sample data" / "turn on sample data"):
 *   1. Reseed from the preserved snapshot files (established process).
 *   2. Clear the disabled flag — normal snapshot-after-change resumes.
 *
 * Identity and platform configuration are preserved on disable so the
 * application stays usable (login, RBAC, system settings, locales).
 */

import { execSync } from "child_process";
import * as path from "path";
import { PrismaClient } from "@prisma/client";
import { isSampleDataDisabled, setSampleDataDisabled } from "./services/sampleDataState";

const prisma = new PrismaClient();

// Models preserved on disable (identity + platform config)
const KEEP_MODELS = new Set([
  "user", "role", "session", "refreshToken", "tenant",
  "systemConfig", "ssoConfig", "fieldPermission",
  "locale", "translation", "currency", "exchangeRate", "retentionPolicy",
]);

// Wipe order: children before parents
const WIPE_MODELS: string[] = [
  "kbArticleTicket", "kbArticleAttachment", "kbArticleVersion", "knowledgeBaseArticle", "kbCategory",
  "surveyAnswer", "surveyResponse", "surveyQuestion", "survey",
  "projectTaskDependency", "projectTask", "projectPhase", "project",
  "contractMilestone", "contract", "assetAssignment", "asset",
  "poLineItem", "purchaseOrder", "vendor",
  "workflowExecution", "workflowRuleAction", "workflowRule",
  "chatMessage", "chatSession",
  "reportSchedule", "report",
  "ticketAttachment", "ticketComment", "timeEntry", "ticket", "ticketCategory", "emailConnector", "serviceBoard",
  "invoiceLineItem", "payment", "invoice", "serviceAgreement",
  "salesActivity", "opportunity",
  "notification", "auditLog", "alertLog", "alertRule", "expense", "recentlyViewedItem",
  "m365Subscription", "m365Group", "m365User", "syncedEntity", "syncLog", "integration", "webhookConfig",
  "technicianSkill", "scheduleEntry", "ptoRequest", "holiday", "bulkOperation", "calendarSyncConfig",
  "kumoFile", "kumoCertificate", "kumoDomain", "kumoLink", "kumoDocumentRevision",
  "kumoDocument", "kumoFolder", "kumoPasswordAccessLog", "kumoPassword",
  "kumoNetworkDevice", "kumoWorkstation", "kumoServer",
  "kumoAssetFieldValue", "kumoAsset", "kumoTemplateField", "kumoAssetTemplate",
  "aiProviderConfig", "inferenceCache", "ticketSimilarity", "detectedPattern",
];

async function wipeBusinessData(): Promise<number> {
  let total = 0;
  for (const modelName of WIPE_MODELS) {
    const model = (prisma as any)[modelName];
    if (model && typeof model.deleteMany === "function") {
      try {
        const result = await model.deleteMany();
        if (result.count > 0) {
          console.log(`  ✓ Deleted ${result.count} ${modelName} records`);
          total += result.count;
        }
      } catch { /* table may not exist yet */ }
    }
  }
  return total;
}

async function main(): Promise<void> {
  const mode = (process.argv[2] || "").toLowerCase();
  if (mode !== "off" && mode !== "on") {
    console.error("Usage: npx tsx src/sample-data-toggle.ts off|on");
    process.exit(1);
  }

  const scriptDir = __dirname;

  if (mode === "off") {
    if (isSampleDataDisabled()) {
      console.log("[SampleData] Sample data is already disabled — no action taken.");
      return;
    }

    console.log("[SampleData] Disabling sample data...\n");

    // 1. Capture a snapshot of the current state (established process)
    console.log("[SampleData] Capturing snapshot before clearing...");
    execSync(`npx tsx "${path.join(scriptDir, "snapshot-capture.ts")}"`, {
      cwd: scriptDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
    });

    // 2. Remove all business data so the application appears empty
    console.log("\n[SampleData] Removing sample/business data...");
    const removed = await wipeBusinessData();
    console.log(`[SampleData] Removed ${removed} business records (identity & platform config preserved).`);

    // 3. Set the disabled flag — locks the snapshot and pauses auto-capture
    setSampleDataDisabled(true);
    console.log("\n[SampleData] Sample data disabled.");
    console.log("[SampleData] Snapshot is locked — it will not be overwritten until sample data is re-enabled.");
    console.log("[SampleData] Automatic reseed after changes is paused.");
  } else {
    // mode === "on"
    if (!isSampleDataDisabled()) {
      console.log("[SampleData] Sample data is already enabled — no action taken.");
      return;
    }

    console.log("[SampleData] Enabling sample data...\n");

    // 1. Reseed from the preserved snapshot files (established process)
    //    The disabled flag is still set during reseed so captures stay locked.
    execSync(`npx tsx "${path.join(scriptDir, "seed-from-snapshots.ts")}"`, {
      cwd: scriptDir,
      stdio: "inherit",
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
    });

    // 2. Clear the disabled flag — resumes snapshot-after-change captures
    setSampleDataDisabled(false);
    console.log("\n[SampleData] Sample data enabled.");
    console.log("[SampleData] Snapshot-after-change process resumed.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
