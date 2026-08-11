/**
 * Auto-Snapshot Service — automatically captures database state to snapshots
 * after any write operation, with debouncing to avoid excessive disk I/O.
 *
 * Triggered by middleware on POST/PUT/PATCH/DELETE routes after response completes.
 * Waits 5 seconds after the last write before capturing.
 */

import { exec } from "child_process";
import * as path from "path";
import type { Request, Response, NextFunction } from "express";

let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingCapture = false;
const DEBOUNCE_MS = 5000;
const CAPTURE_SCRIPT = path.join(__dirname, "..", "snapshot-capture.ts");
// Skip auto-capture on these paths (health checks, auth, etc.)
const SKIP_PATHS = ["/api/health", "/api/auth/", "/api/users/me"];

function runCapture(): void {
  pendingCapture = true;
  exec(
    `npx tsx "${CAPTURE_SCRIPT}"`,
    { cwd: path.join(__dirname, ".."), timeout: 30000, env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" } },
    (err, stdout) => {
      pendingCapture = false;
      if (err) {
        console.error(`[AutoSnapshot] Capture failed: ${err.message}`);
      } else {
        const summary = stdout.split("\n").find(l => l.includes("Capture complete"));
        if (summary) console.log(`[AutoSnapshot] ${summary.trim()}`);
      }
    }
  );
}

export function scheduleSnapshotCapture(): void {
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (!pendingCapture) runCapture();
  }, DEBOUNCE_MS);
}

/**
 * Express middleware — hooks into response finish to trigger snapshot capture
 * after successful write operations (POST/PUT/PATCH/DELETE with 2xx/3xx status).
 * Place this BEFORE your route handlers.
 */
export function autoSnapshotMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Only hook writes
  const method = req.method.toUpperCase();
  if (!["POST", "PUT", "PATCH", "DELETE"].includes(method)) {
    return next();
  }

  // Skip certain paths
  if (SKIP_PATHS.some(p => req.path.startsWith(p))) {
    return next();
  }

  // Hook into response finish
  res.on("finish", () => {
    const status = res.statusCode;
    if (status >= 200 && status < 400) {
      scheduleSnapshotCapture();
    }
  });

  next();
}
