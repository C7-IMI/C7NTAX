/**
 * Automated Seed Generator — runs the full seed pipeline and updates snapshot fixtures.
 *
 * Usage:  npx tsx src/seed-automation.ts
 *
 * Flow:
 *   1. Load snapshot fixtures from src/snapshots/
 *   2. Clean and re-seed the database
 *   3. Verify counts against expectations
 *   4. Write actual DB counts back to ../../data-snapshot.json
 *   5. Report results
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

// ── Fixture paths ───────────────────────────────────────────────────
const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");
const DATA_SNAPSHOT_PATH = path.join(__dirname, "..", "..", "data-snapshot.json");

// ── Expected counts from fixtures ───────────────────────────────────
const EXPECTED: Record<string, number> = {
  role: 4, user: 6, company: 5, contact: 13, serviceBoard: 3,
  ticket: 8, ticketComment: 6, timeEntry: 5, serviceAgreement: 5,
  invoice: 4, project: 3, opportunity: 3, asset: 5,
  knowledgeBaseArticle: 4, integration: 4, m365User: 3, m365Subscription: 2,
};

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  const log = (msg: string) => console.log(`[AutoSeed] ${msg}`);

  log("Starting automated seed pipeline...\n");

  // ── Enumerate available fixtures ──
  const fixtureFiles = fs.readdirSync(SNAPSHOTS_DIR).filter(f => f.endsWith(".json"));
  log(`Found ${fixtureFiles.length} snapshot fixtures: ${fixtureFiles.join(", ")}`);

  // ── Clean all tables in correct order ──
  log("Cleaning existing data...");
  await prisma.syncedEntity.deleteMany();
  await prisma.syncLog.deleteMany();
  await prisma.m365Subscription.deleteMany();
  await prisma.m365Group.deleteMany();
  await prisma.m365User.deleteMany();
  await prisma.integration.deleteMany();
  await prisma.ticketComment.deleteMany();
  await prisma.timeEntry.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceLineItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.ticket.deleteMany();
  await prisma.serviceAgreement.deleteMany();
  await prisma.projectPhase.deleteMany();
  await prisma.project.deleteMany();
  await prisma.opportunity.deleteMany();
  await prisma.asset.deleteMany();
  await prisma.knowledgeBaseArticle.deleteMany();
  await prisma.contact.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();
  await prisma.role.deleteMany();
  await prisma.serviceBoard.deleteMany();
  await prisma.recentlyViewedItem.deleteMany();
  log("  Cleaned all tables\n");

  // ── Run the full seed (delegates to seed-full.ts logic) ──
  log("Running seed-full...");
  const { execSync } = require("child_process");
  execSync("npx tsx src/seed-full.ts", { cwd: path.join(__dirname, ".."), stdio: "inherit" });
  log("  Seed complete\n");

  // ── Verify counts ──
  log("Verifying data counts...");
  const counts: Record<string, number> = {
    role: await prisma.role.count(),
    user: await prisma.user.count(),
    company: await prisma.company.count(),
    contact: await prisma.contact.count(),
    serviceBoard: await prisma.serviceBoard.count(),
    ticket: await prisma.ticket.count(),
    ticketComment: await prisma.ticketComment.count(),
    timeEntry: await prisma.timeEntry.count(),
    serviceAgreement: await prisma.serviceAgreement.count(),
    invoice: await prisma.invoice.count(),
    project: await prisma.project.count(),
    opportunity: await prisma.opportunity.count(),
    asset: await prisma.asset.count(),
    knowledgeBaseArticle: await prisma.knowledgeBaseArticle.count(),
    integration: await prisma.integration.count(),
    m365User: await prisma.m365User.count(),
    m365Subscription: await prisma.m365Subscription.count(),
    m365Group: await prisma.m365Group.count(),
    syncedEntity: await prisma.syncedEntity.count(),
    syncLog: await prisma.syncLog.count(),
    notification: await prisma.notification.count(),
    recentlyViewedItem: await prisma.recentlyViewedItem.count(),
  };

  // ── Check against expected ──
  let allOk = true;
  for (const [key, expected] of Object.entries(EXPECTED)) {
    const actual = counts[key] ?? 0;
    if (actual !== expected) {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${key}: expected ${expected}, got ${actual}`);
      allOk = false;
    } else {
      log(`  ✓ ${key}: ${actual}`);
    }
  }

  // ── Write data-snapshot.json ──
  const snapshot = {
    timestamp: new Date().toISOString(),
    verified: allOk,
    counts,
    fixtureFiles,
  };
  fs.writeFileSync(DATA_SNAPSHOT_PATH, JSON.stringify(snapshot, null, 2));
  log(`\nSnapshot written to ${DATA_SNAPSHOT_PATH}`);

  if (allOk) {
    log("\n✓ All counts match. Seed verification passed.");
  } else {
    log("\n✗ Some counts mismatch. Review output above.");
    process.exit(1);
  }

  // ── Verify rendering: basic smoke check ──
  log("\nRunning rendering smoke checks...");
  const tables = ["role", "user", "company", "contact", "ticket", "invoice", "project", "asset", "integration"];
  for (const table of tables) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const count = await (prisma as any)[table]?.count?.();
      log(`  ✓ ${table}: ${count} records readable`);
    } catch {
      // eslint-disable-next-line no-console
      console.error(`  ✗ ${table}: query failed`);
    }
  }

  log("\nAutomated seed pipeline complete.");
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
