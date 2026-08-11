/**
 * Seed from Snapshots — re-seeds the database from snapshot fixture files.
 *
 * Usage:  npx tsx src/seed-from-snapshots.ts
 *
 * This reads every snapshot JSON file in src/snapshots/ and inserts the data
 * into the database. It preserves foreign key relationships by seeding in
 * dependency order. Run snapshot-capture.ts first to generate the fixtures.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");

// Seed order matters: parents before children
const SEED_ORDER: { fileName: string; model: string }[] = [
  { fileName: "roles.json", model: "role" },
  { fileName: "users.json", model: "user" },
  { fileName: "companies.json", model: "company" },
  { fileName: "contacts.json", model: "contact" },
  { fileName: "service-boards.json", model: "serviceBoard" },
  { fileName: "tickets.json", model: "ticket" },
  { fileName: "ticket-comments.json", model: "ticketComment" },
  { fileName: "time-entries.json", model: "timeEntry" },
  { fileName: "service-agreements.json", model: "serviceAgreement" },
  { fileName: "invoices.json", model: "invoice" },
  { fileName: "invoice-line-items.json", model: "invoiceLineItem" },
  { fileName: "payments.json", model: "payment" },
  { fileName: "projects.json", model: "project" },
  { fileName: "project-phases.json", model: "projectPhase" },
  { fileName: "opportunities.json", model: "opportunity" },
  { fileName: "assets.json", model: "asset" },
  { fileName: "kb-articles.json", model: "knowledgeBaseArticle" },
  { fileName: "integrations.json", model: "integration" },
  { fileName: "m365-users.json", model: "m365User" },
  { fileName: "m365-groups.json", model: "m365Group" },
  { fileName: "m365-subscriptions.json", model: "m365Subscription" },
  { fileName: "synced-entities.json", model: "syncedEntity" },
  { fileName: "sync-logs.json", model: "syncLog" },
  { fileName: "notifications.json", model: "notification" },
  { fileName: "kumo-templates.json", model: "kumoAssetTemplate" },
  { fileName: "kumo-template-fields.json", model: "kumoTemplateField" },
  { fileName: "kumo-assets.json", model: "kumoAsset" },
  { fileName: "kumo-asset-field-values.json", model: "kumoAssetFieldValue" },
  { fileName: "kumo-passwords.json", model: "kumoPassword" },
  { fileName: "kumo-folders.json", model: "kumoFolder" },
  { fileName: "kumo-documents.json", model: "kumoDocument" },
  { fileName: "kumo-servers.json", model: "kumoServer" },
  { fileName: "kumo-links.json", model: "kumoLink" },
  { fileName: "kumo-domains.json", model: "kumoDomain" },
  { fileName: "kumo-certificates.json", model: "kumoCertificate" },
  { fileName: "kumo-files.json", model: "kumoFile" },
  { fileName: "recently-viewed.json", model: "recentlyViewedItem" },
  { fileName: "expenses.json", model: "expense" },
  { fileName: "alert-rules.json", model: "alertRule" },
  { fileName: "alert-logs.json", model: "alertLog" },
];

// Reverse order for clean deletion
const CLEAN_ORDER = [...SEED_ORDER].reverse();

async function main(): Promise<void> {
  const log = (msg: string) => console.log(`[SeedFromSnapshots] ${msg}`);

  log("Re-seeding database from snapshot fixtures...\n");

  // ── Clean existing data (reverse dependency order) ──
  log("Cleaning existing data...");
  for (const entry of CLEAN_ORDER) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = (prisma as any)[entry.model];
    if (model && typeof model.deleteMany === "function") {
      try {
        const result = await model.deleteMany();
        if (result.count > 0) log(`  ✓ Deleted ${result.count} ${entry.model} records`);
      } catch { /* table might not exist yet */ }
    }
  }
  log("");

  // ── Seed from snapshots (dependency order) ──
  log("Seeding from snapshot files...");
  let totalSeeded = 0;

  for (const entry of SEED_ORDER) {
    const filePath = path.join(SNAPSHOTS_DIR, entry.fileName);
    if (!fs.existsSync(filePath)) {
      continue; // skip missing fixtures silently
    }

    try {
      const rows: Record<string, unknown>[] = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (rows.length === 0) continue;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[entry.model];
      if (!model || typeof model.createMany !== "function") {
        log(`  ⊘ ${entry.model}: model not found, skipping`);
        continue;
      }

      // Use createMany for bulk inserts (much faster)
      await model.createMany({ data: rows, skipDuplicates: true });
      totalSeeded += rows.length;
      log(`  ✓ ${entry.model}: ${rows.length} records from ${entry.fileName}`);
    } catch (e) {
      log(`  ✗ ${entry.model}: ${(e as Error).message}`);
    }
  }

  log(`\nSeed complete: ${totalSeeded} total records seeded.`);
  log(`Database is now a replica of the snapshot state.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
