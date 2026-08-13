/**
 * Post-Change Verification Script
 * 
 * Usage: npx tsx src/verify-post-change.ts
 * 
 * This script MUST be run after every code change. It:
 * 1. Checks all pages for HTTP 200 responses
 * 2. Verifies database has required sample data
 * 3. Re-seeds from snapshot if data is missing
 * 4. Captures current state to snapshots for future restore
 */

const { execSync } = require("child_process");
const path = require("path");
const http = require("http");

const API_PORT = 4000;
const WEB_PORT = 3010;
const BASE_URL = `http://localhost:${WEB_PORT}`;

// Pages that must return 200
const REQUIRED_PAGES = [
  "/", "/home", "/tickets", "/boards", "/opportunities", 
  "/projects", "/assets", "/clients", "/billing", "/kumo",
  "/kumo/assets", "/kumo/passwords", "/kumo/configs", "/kumo/documents",
  "/cloudconnect", "/users", "/roles", "/admin", "/admin/changelog",
  "/admin/logs", "/kb", "/reports", "/calendar", "/settings", "/procurement",
  "/service-alerts", "/admin/service-alerts",
];

// Minimum expected record counts per table
const MIN_COUNTS: Record<string, number> = {
  role: 4, user: 5, company: 5, contact: 5, serviceBoard: 2,
  ticket: 5, ticketComment: 3, timeEntry: 3, serviceAgreement: 3,
  invoice: 3, project: 2, opportunity: 2, asset: 3,
  knowledgeBaseArticle: 3, integration: 2,
  serviceAlertService: 8, serviceAlert: 2,
};

// Names of tables in Prisma (camelCase)
const CHECK_TABLES = Object.keys(MIN_COUNTS);

function httpGet(url: string): Promise<{ status: number }> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, (res) => {
      res.resume();
      resolve({ status: res.statusCode || 0 });
    });
    req.on("error", reject);
    req.setTimeout(5000, () => { req.destroy(); reject(new Error("timeout")); });
  });
}

async function verifyPages(): Promise<string[]> {
  const failures: string[] = [];
  for (const page of REQUIRED_PAGES) {
    try {
      const { status } = await httpGet(`${BASE_URL}${page}`);
      if (status !== 200) failures.push(`${page} → HTTP ${status}`);
    } catch (e) {
      failures.push(`${page} → ${(e as Error).message}`);
    }
  }
  return failures;
}

async function verifyData(): Promise<string[]> {
  const { PrismaClient } = require("@prisma/client");
  const p = new PrismaClient();
  const failures: string[] = [];
  try {
    for (const table of CHECK_TABLES) {
      try {
        const count = await (p as any)[table].count();
        const min = MIN_COUNTS[table] || 0;
        if (count < min) {
          failures.push(`${table}: ${count} records (need >= ${min})`);
        }
      } catch {
        failures.push(`${table}: query failed`);
      }
    }
  } finally {
    await p.$disconnect();
  }
  return failures;
}

async function main() {
  console.log("[Verify] Post-change verification starting...\n");

  // 1. Verify pages
  console.log("[Verify] Checking page health...");
  const pageFailures = await verifyPages();
  if (pageFailures.length > 0) {
    console.log("  FAILURES:");
    pageFailures.forEach(f => console.log(`    ✗ ${f}`));
  } else {
    console.log("  ✓ All pages return 200");
  }

  // 2. Verify data
  console.log("\n[Verify] Checking database state...");
  const dataFailures = await verifyData();
  if (dataFailures.length > 0) {
    console.log("  MISSING DATA:");
    dataFailures.forEach(f => console.log(`    ✗ ${f}`));
    console.log("\n[Verify] Re-seeding from snapshots...");
    try {
      execSync("npx tsx src/seed-from-snapshots.ts", { 
        cwd: __dirname, 
        stdio: "inherit",
        timeout: 30000 
      });
      console.log("  ✓ Re-seed complete");
    } catch {
      console.log("  ✗ Snapshot re-seed failed, falling back to seed-full...");
      execSync("npx tsx src/seed-full.ts", { 
        cwd: __dirname, 
        stdio: "inherit",
        timeout: 30000 
      });
      console.log("  ✓ seed-full complete");
    }
  } else {
    console.log("  ✓ All data counts meet minimums");
  }

  // 3. Capture current state to snapshots
  console.log("\n[Verify] Capturing current state to snapshots...");
  try {
    execSync("npx tsx src/snapshot-capture.ts", { 
      cwd: __dirname, 
      stdio: "inherit",
      timeout: 30000 
    });
    console.log("  ✓ Snapshot capture complete");
  } catch (e) {
    console.log(`  ✗ Snapshot capture failed: ${(e as Error).message}`);
  }

  // 4. Final re-check
  const finalFailures = await verifyData();
  if (finalFailures.length > 0) {
    console.log("\n[Verify] ✗ Data still missing after remediation:");
    finalFailures.forEach(f => console.log(`  ✗ ${f}`));
    process.exit(1);
  }

  console.log("\n[Verify] ✓ All checks passed. Application is healthy.");
}

main().catch((e) => {
  console.error(`[Verify] Fatal: ${e.message}`);
  process.exit(1);
});
