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
 *
 * The operation itself lives in `services/sampleDataOperations.ts`, because the Developer section's purge
 * screen performs the same act and two implementations would be two definitions of "what a purge
 * removes". This file is now what a command line adds: argument parsing, the log lines, and its own
 * database connection.
 */

import { PrismaClient } from "@prisma/client";
import { isSampleDataDisabled } from "./services/sampleDataState";
import { disableSampleData, enableSampleData } from "./services/sampleDataOperations";

const prisma = new PrismaClient();

async function main(): Promise<void> {
  const mode = (process.argv[2] || "").toLowerCase();
  if (mode !== "off" && mode !== "on") {
    console.error("Usage: npx tsx src/sample-data-toggle.ts off|on");
    process.exit(1);
  }

  if (mode === "off") {
    if (isSampleDataDisabled()) {
      console.log("[SampleData] Sample data is already disabled — no action taken.");
      return;
    }

    console.log("[SampleData] Disabling sample data...\n");

    // 1. Capture a snapshot of the current state, 2. remove all business data so the application appears
    //    empty, 3. set the disabled flag — which locks the snapshot and pauses auto-capture.
    const result = await disableSampleData(prisma, {
      onStep: (step) => {
        if (step === "snapshot") console.log("[SampleData] Capturing snapshot before clearing...");
        if (step === "wipe") console.log("\n[SampleData] Removing sample/business data...");
      },
      onDeleted: (model, rows) => console.log(`  ✓ Deleted ${rows} ${model} records`),
    });

    console.log(`[SampleData] Removed ${result.rows} business records (identity & platform config preserved).`);
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

    // 1. Reseed from the preserved snapshot files, then 2. clear the flag — which resumes
    //    snapshot-after-change captures. The flag stays set during the reseed so captures stay locked.
    await enableSampleData();

    console.log("\n[SampleData] Sample data enabled.");
    console.log("[SampleData] Snapshot-after-change process resumed.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
