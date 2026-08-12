/**
 * Snapshot Poller — background service that periodically scans for new data
 * and triggers snapshot captures at varying intervals.
 *
 * Runs independently of the request-driven auto-snapshot middleware.
 * Detects changes from any source (API, direct DB, external syncs, etc.).
 */

import { exec } from "child_process";
import * as path from "path";
import { prisma } from "../index";
import { isSampleDataDisabled } from "./sampleDataState";

// ── Configuration ──────────────────────────────────────────────────

/** Base interval between polls in ms (5 minutes) */
const BASE_INTERVAL_MS = 5 * 60 * 1000;

/** Maximum random jitter added to base interval (±50%) */
const JITTER_RANGE_MS = 2.5 * 60 * 1000;

/** How many "no change" cycles before extending the interval (backoff) */
const BACKOFF_CYCLES = 3;

/** Maximum backoff multiplier (8× base = 40 minutes) */
const MAX_BACKOFF = 8;

/** Minimum interval in ms (1 minute — never poll faster than this) */
const MIN_INTERVAL_MS = 60 * 1000;

// ── State ──────────────────────────────────────────────────────────

let pollTimer: ReturnType<typeof setTimeout> | null = null;
let consecutiveNoChange = 0;
let currentBackoff = 1;
let lastRecordCount = 0;
let isRunning = false;
let paused = false;

/** Table list that the snapshot capture covers — used for change detection */
const WATCHED_TABLES = [
  "role", "user", "company", "contact", "serviceBoard",
  "ticket", "ticketComment", "timeEntry", "serviceAgreement",
  "invoice", "invoiceLineItem", "payment", "project", "projectPhase",
  "opportunity", "asset", "knowledgeBaseArticle", "integration",
  "m365User", "m365Group", "m365Subscription", "syncedEntity", "syncLog",
  "notification", "kumoAsset", "kumoAssetTemplate", "kumoTemplateField",
  "kumoAssetFieldValue", "kumoPassword", "kumoDocument", "kumoFolder",
  "kumoServer", "kumoLink", "kumoDomain", "kumoCertificate", "kumoFile",
  "recentlyViewedItem", "expense", "alertRule", "alertLog",
];

// ── Helpers ────────────────────────────────────────────────────────

const CAPTURE_SCRIPT = path.join(__dirname, "..", "snapshot-capture.ts");

function log(msg: string): void {
  console.log(`[SnapshotPoller] ${msg}`);
}

/** Count total records across all watched tables */
async function countAllRecords(): Promise<number> {
  let total = 0;
  for (const table of WATCHED_TABLES) {
    try {
      const model = (prisma as any)[table];
      if (model && typeof model.count === "function") {
        total += await model.count();
      }
    } catch { /* table might not exist yet */ }
  }
  return total;
}

/** Run the snapshot capture script */
function runCapture(): Promise<void> {
  return new Promise((resolve, reject) => {
    log("New data detected — triggering snapshot capture...");
    exec(
      `npx tsx "${CAPTURE_SCRIPT}"`,
      {
        cwd: path.join(__dirname, ".."),
        timeout: 30000,
        env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
      },
      (err, stdout) => {
        if (err) {
          log(`Capture failed: ${err.message}`);
          reject(err);
        } else {
          const summary = stdout.split("\n").find(l => l.includes("Capture complete"));
          if (summary) log(summary.trim());
          resolve();
        }
      }
    );
  });
}

/** Compute the next poll interval with jitter and backoff */
function nextInterval(): number {
  const jitter = Math.floor(Math.random() * JITTER_RANGE_MS * 2) - JITTER_RANGE_MS;
  const backoffMs = BASE_INTERVAL_MS * currentBackoff;
  return Math.max(MIN_INTERVAL_MS, backoffMs + jitter);
}

// ── Core poll cycle ────────────────────────────────────────────────

async function poll(): Promise<void> {
  if (paused) {
    scheduleNext();
    return;
  }

  isRunning = true;
  try {
    // While sample data is disabled the snapshot is locked — no captures
    if (isSampleDataDisabled()) {
      lastRecordCount = await countAllRecords();
      scheduleNext();
      isRunning = false;
      return;
    }
    const count = await countAllRecords();
    if (count !== lastRecordCount) {
      const delta = count - lastRecordCount;
      log(`Record count changed: ${lastRecordCount} → ${count} (${delta > 0 ? "+" : ""}${delta})`);
      await runCapture();
      lastRecordCount = count;
      consecutiveNoChange = 0;
      currentBackoff = 1;
    } else {
      consecutiveNoChange++;
      log(`No change detected (cycle ${consecutiveNoChange})`);
      if (consecutiveNoChange >= BACKOFF_CYCLES) {
        currentBackoff = Math.min(currentBackoff * 2, MAX_BACKOFF);
        log(`Backoff increased to ${currentBackoff}× (${(BASE_INTERVAL_MS * currentBackoff) / 60000} min)`);
      }
    }
  } catch (e) {
    log(`Poll error: ${(e as Error).message}`);
  } finally {
    isRunning = false;
    scheduleNext();
  }
}

function scheduleNext(): void {
  const interval = nextInterval();
  log(`Next poll in ${Math.round(interval / 1000)}s`);
  pollTimer = setTimeout(poll, interval);
}

// ── Public API ─────────────────────────────────────────────────────

/** Start the background poller. Call once during app startup. */
export async function startSnapshotPoller(): Promise<void> {
  log("Starting snapshot poller...");
  lastRecordCount = await countAllRecords();
  log(`Initial record count: ${lastRecordCount}`);
  scheduleNext();
}

/** Stop the poller gracefully. */
export function stopSnapshotPoller(): void {
  if (pollTimer) {
    clearTimeout(pollTimer);
    pollTimer = null;
  }
  log("Poller stopped");
}

/** Pause/resume polling (e.g., during maintenance). */
export function setPaused(p: boolean): void {
  paused = p;
  log(p ? "Poller paused" : "Poller resumed");
  if (!p && !pollTimer && !isRunning) scheduleNext();
}

/** Force an immediate poll + capture. */
export async function forcePoll(): Promise<void> {
  if (pollTimer) clearTimeout(pollTimer);
  await poll();
}

/** Get current poller status. */
export function getStatus() {
  return {
    running: isRunning,
    paused,
    lastRecordCount,
    consecutiveNoChange,
    currentBackoff,
    nextPollMs: 0, // approximate — actual varies with jitter
  };
}
