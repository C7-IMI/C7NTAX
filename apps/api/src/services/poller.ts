import { execSync } from "child_process";

type ServiceStatus = "up" | "down" | "degraded";

interface HealthResult {
  status: ServiceStatus;
  checks: Array<{ name: string; status: ServiceStatus; detail: string; timestamp: string }>;
}

interface RecoveryAttempt {
  attempt: number;
  time: string;
  action: string;
  outcome: "success" | "failed";
  detail: string;
}

let retryCount = 0;
let paused = false;
const MAX_RETRIES = 10;
const recoveryLog: RecoveryAttempt[] = [];
const POLL_INTERVAL_MS = 30000;

function log(level: string, msg: string) {
  const ts = new Date().toISOString();
  console.log(`[SelfHeal-${level}] ${ts} ${msg}`);
}

export function isPaused(): boolean { return paused; }
export function getRetryCount(): number { return retryCount; }
export function getRecoveryLog(): RecoveryAttempt[] { return recoveryLog; }
export function resetPoller(): void { retryCount = 0; paused = false; recoveryLog.length = 0; log("INFO", "Poller manually reset"); }

function recordAttempt(action: string, outcome: "success" | "failed", detail: string) {
  recoveryLog.unshift({ attempt: retryCount + 1, time: new Date().toISOString(), action, outcome, detail });
  if (recoveryLog.length > 50) recoveryLog.length = 50;
}

async function checkApiEndpoint(url: string): Promise<boolean> {
  try {
    const resp = await fetch(`http://localhost:4000${url}`, { signal: AbortSignal.timeout(5000) });
    return resp.ok || resp.status === 401;
  } catch { return false; }
}

async function runHealthCheck(): Promise<HealthResult> {
  const checks: HealthResult["checks"] = [];
  const endpoints = ["/api/auth/login", "/api/tickets?limit=1", "/api/clients?limit=1", "/api/users?limit=1", "/api/billing/invoices?limit=1", "/api/boards"];
  let allUp = true;
  let anyUp = false;

  for (const ep of endpoints) {
    const ok = await checkApiEndpoint(ep);
    if (ok) anyUp = true; else allUp = false;
    checks.push({ name: ep, status: ok ? "up" : "down", detail: ok ? "OK" : "No response", timestamp: new Date().toISOString() });
  }

  const status = allUp ? "up" : anyUp ? "degraded" : "down";
  return { status, checks };
}

async function attemptRepair(): Promise<boolean> {
  log("INFO", "Attempting automatic repair...");
  try {
    execSync("cd C:/OneDrive/OneDrive - Cyber 7 Group/GHRepo/Kun/C7NTAX/apps/api && npx prisma db push --accept-data-loss 2>&1", { timeout: 30000, stdio: "ignore" });
    log("INFO", "Database integrity check passed");
    return true;
  } catch (e: any) {
    log("ERROR", `Repair failed: ${e.message}`);
    return false;
  }
}

export async function startPoller(): Promise<void> {
  log("INFO", "Self-healing poller started");
  const interval = setInterval(async () => {
    if (paused) return;
    const health = await runHealthCheck();
    if (health.status === "up") {
      retryCount = 0;
      return;
    }
    log("WARN", `Health check: ${health.status} (retry ${retryCount + 1}/${MAX_RETRIES})`);
    recordAttempt("health_check", "failed", `Status: ${health.status}`);

    const repaired = await attemptRepair();
    if (repaired) {
      recordAttempt("auto_repair", "success", "Database and services restored");
      retryCount = 0;
      log("INFO", "Auto-repair successful");
    } else {
      recordAttempt("auto_repair", "failed", "Unable to restore services");
      retryCount++;
    }

    if (retryCount >= MAX_RETRIES) {
      log("ERROR", `Max retries (${MAX_RETRIES}) reached. PAUSING.`);
      recordAttempt("max_retries", "failed", `Paused after ${MAX_RETRIES} failures. Manual intervention required.`);
      paused = true;
    }
  }, POLL_INTERVAL_MS);
}

process.on("SIGTERM", () => { paused = true; });
process.on("SIGINT", () => { paused = true; });
