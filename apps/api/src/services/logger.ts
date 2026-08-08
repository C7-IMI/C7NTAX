import fs from "fs";
import path from "path";

/**
 * DevErrorLogger — verbose, human-readable error logging with timestamps.
 * Writes to `dev-errors.log` in the project root.
 * Captures Express errors, worker failures, unhandled rejections, and Prisma errors.
 */

const LOG_FILE = path.resolve(__dirname, "../../dev-errors.log");
const MAX_LOG_SIZE_MB = 10;

// ── Helpers ──────────────────────────────────────────────────────────

function getGitInfo(): { branch: string; commit: string } {
  return { branch: "unknown", commit: "unknown" };
}

function formatTimestamp(): string {
  const now = new Date();
  return now.toISOString().replace("T", " ").slice(0, 23);
}

function getMemoryUsage(): string {
  const m = process.memoryUsage();
  return `heap=${(m.heapUsed / 1024 / 1024).toFixed(1)}MB rss=${(m.rss / 1024 / 1024).toFixed(1)}MB`;
}

function rotateIfNeeded(): void {
  try {
    const stat = fs.statSync(LOG_FILE);
    if (stat.size > MAX_LOG_SIZE_MB * 1024 * 1024) {
      const rotated = LOG_FILE.replace(".log", `.${Date.now()}.log`);
      fs.renameSync(LOG_FILE, rotated);
      fs.appendFileSync(LOG_FILE, `[LOG ROTATED] Previous log archived to: ${path.basename(rotated)}\n\n`);
    }
  } catch {
    // File doesn't exist yet — fine
  }
}

function writeLine(line: string): void {
  rotateIfNeeded();
  try {
    fs.appendFileSync(LOG_FILE, line + "\n");
  } catch {
    console.error("[Logger] Failed to write to log file:", LOG_FILE);
  }
}

// ── Public API ───────────────────────────────────────────────────────

export const logger = {
  /**
   * Log an Express error (from middleware or route handler).
   */
  error(context: string, err: Error, meta?: Record<string, unknown>): void {
    const git = getGitInfo();
    const lines = [
      "",
      "══════════════════════════════════════════════════════════════════",
      `  TIMESTAMP : ${formatTimestamp()}`,
      `  LEVEL     : ERROR`,
      `  CONTEXT   : ${context}`,
      `  GIT       : ${git.branch} (${git.commit})`,
      `  MEMORY    : ${getMemoryUsage()}`,
      `  MESSAGE   : ${err.message}`,
    ];
    if (meta && Object.keys(meta).length > 0) {
      lines.push(`  METADATA  : ${JSON.stringify(meta, null, 2).replace(/\n/g, "\n              ")}`);
    }
    if (err.stack) {
      lines.push("  ── Stack Trace ──");
      err.stack.split("\n").forEach((line) => {
        lines.push(`    ${line.trim()}`);
      });
    }
    // Unwrap Prisma errors for readability
    if ((err as { clientVersion?: string }).clientVersion) {
      lines.push(`  PRISMA    : v${(err as { clientVersion?: string }).clientVersion}`);
    }
    lines.push("══════════════════════════════════════════════════════════════════");
    writeLine(lines.join("\n"));
  },

  /**
   * Log a warning (non-fatal issue).
   */
  warn(context: string, message: string, meta?: Record<string, unknown>): void {
    const lines = [
      "",
      `──────────────────────────────────────────────────────────────────`,
      `  ${formatTimestamp()}  WARN  [${context}]  ${message}`,
    ];
    if (meta) {
      lines.push(`  Metadata: ${JSON.stringify(meta)}`);
    }
    lines.push("──────────────────────────────────────────────────────────────────");
    writeLine(lines.join("\n"));
  },

  /**
   * Log an info message (startup, configuration, lifecycle events).
   */
  info(context: string, message: string): void {
    const line = `  ${formatTimestamp()}  INFO  [${context}]  ${message}`;
    writeLine(line);
  },

  /**
   * Write a startup banner marking server initialization.
   */
  startup(): void {
    const git = getGitInfo();
    const lines = [
      "",
      "╔══════════════════════════════════════════════════════════════════╗",
      "║                    C7 OVERWATCH — DEV ERRORS                     ║",
      "╠══════════════════════════════════════════════════════════════════╣",
      `║  Started  : ${formatTimestamp()}`.padEnd(68) + "║",
      `║  Version  : 1.0.0`.padEnd(68) + "║",
      `║  Git      : ${git.branch} (${git.commit})`.padEnd(68) + "║",
      `║  Node     : ${process.version}`.padEnd(68) + "║",
      `║  Platform : ${process.platform} ${process.arch}`.padEnd(68) + "║",
      "╚══════════════════════════════════════════════════════════════════╝",
      "",
    ];
    writeLine(lines.join("\n"));
    console.log(`[DevErrorLogger] Writing to ${LOG_FILE}`);
  },

  /**
   * Get the path to the log file.
   */
  getLogPath(): string {
    return LOG_FILE;
  },
};

// ── Global handlers ──────────────────────────────────────────────────

// Catch unhandled promise rejections (async errors without .catch)
process.on("unhandledRejection", (reason: unknown) => {
  const err = reason instanceof Error ? reason : new Error(String(reason));
  logger.error("unhandledRejection", err, { type: typeof reason });
  console.error("[FATAL] Unhandled rejection — see dev-errors.log");
});

// Catch uncaught exceptions (sync errors)
process.on("uncaughtException", (err: Error) => {
  logger.error("uncaughtException", err);
  console.error("[FATAL] Uncaught exception — see dev-errors.log. Exiting in 3s.");
  setTimeout(() => process.exit(1), 3000);
});
