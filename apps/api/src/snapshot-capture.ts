/**
 * Snapshot Capture — dumps current database state into snapshot fixture files.
 *
 * Usage:  npx tsx src/snapshot-capture.ts
 *
 * This reads every entity table and writes the data to src/snapshots/*.json.
 * These fixtures are then used by seed-from-snapshots.ts to re-seed.
 */

import { PrismaClient } from "@prisma/client";
import * as fs from "fs";
import * as path from "path";

const prisma = new PrismaClient();

const SNAPSHOTS_DIR = path.join(__dirname, "snapshots");

interface TableDef {
  name: string;          // Prisma model name (camelCase)
  fileName: string;      // output JSON file
  select?: Record<string, boolean>;  // fields to select (omit sensitive)
}

const TABLES: TableDef[] = [
  { name: "role", fileName: "roles.json" },
  { name: "user", fileName: "users.json" },
  { name: "company", fileName: "companies.json" },
  { name: "contact", fileName: "contacts.json" },
  { name: "serviceBoard", fileName: "service-boards.json" },
  { name: "ticket", fileName: "tickets.json" },
  { name: "ticketComment", fileName: "ticket-comments.json" },
  { name: "timeEntry", fileName: "time-entries.json" },
  { name: "serviceAgreement", fileName: "service-agreements.json" },
  { name: "invoice", fileName: "invoices.json" },
  { name: "invoiceLineItem", fileName: "invoice-line-items.json" },
  { name: "payment", fileName: "payments.json" },
  { name: "project", fileName: "projects.json" },
  { name: "projectPhase", fileName: "project-phases.json" },
  { name: "opportunity", fileName: "opportunities.json" },
  { name: "asset", fileName: "assets.json" },
  { name: "knowledgeBaseArticle", fileName: "kb-articles.json" },
  { name: "integration", fileName: "integrations.json",
    select: { id: true, kind: true, name: true, enabled: true, status: true,
              credentials: true, settings: true, lastSyncAt: true,
              errorMessage: true, createdAt: true, updatedAt: true } },
  { name: "m365User", fileName: "m365-users.json" },
  { name: "m365Group", fileName: "m365-groups.json" },
  { name: "m365Subscription", fileName: "m365-subscriptions.json" },
  { name: "syncedEntity", fileName: "synced-entities.json" },
  { name: "syncLog", fileName: "sync-logs.json" },
  { name: "notification", fileName: "notifications.json" },
  { name: "kumoAsset", fileName: "kumo-assets.json" },
  { name: "kumoAssetTemplate", fileName: "kumo-templates.json" },
  { name: "kumoPassword", fileName: "kumo-passwords.json" },
  { name: "kumoDocument", fileName: "kumo-documents.json" },
  { name: "kumoFolder", fileName: "kumo-folders.json" },
  { name: "kumoServer", fileName: "kumo-servers.json" },
  { name: "kumoLink", fileName: "kumo-links.json" },
  { name: "kumoDomain", fileName: "kumo-domains.json" },
  { name: "kumoCertificate", fileName: "kumo-certificates.json" },
  { name: "kumoFile", fileName: "kumo-files.json" },
  { name: "recentlyViewedItem", fileName: "recently-viewed.json" },
  { name: "expense", fileName: "expenses.json" },
  { name: "alertRule", fileName: "alert-rules.json" },
  { name: "alertLog", fileName: "alert-logs.json" },
];

async function main(): Promise<void> {
  const log = (msg: string) => console.log(`[SnapshotCapture] ${msg}`);

  log("Capturing current database state to snapshot fixtures...\n");

  const summary: Record<string, number> = {};
  let totalRecords = 0;

  for (const table of TABLES) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const model = (prisma as any)[table.name];
      if (!model || typeof model.findMany !== "function") {
        log(`  ⊘ ${table.name}: model not found, skipping`);
        continue;
      }

      const rows = await model.findMany({ select: table.select });
      const filePath = path.join(SNAPSHOTS_DIR, table.fileName);

      fs.writeFileSync(filePath, JSON.stringify(rows, null, 2));
      summary[table.name] = rows.length;
      totalRecords += rows.length;
      log(`  ✓ ${table.name}: ${rows.length} records → ${table.fileName}`);
    } catch (e) {
      log(`  ✗ ${table.name}: ${(e as Error).message}`);
    }
  }

  // Write summary manifest
  const manifest = {
    capturedAt: new Date().toISOString(),
    totalRecords,
    tables: summary,
  };
  fs.writeFileSync(
    path.join(SNAPSHOTS_DIR, "_manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  log(`\nCapture complete: ${totalRecords} total records across ${Object.keys(summary).length} tables.`);
  log(`Snapshots saved to ${SNAPSHOTS_DIR}/`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
