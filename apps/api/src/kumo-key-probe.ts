/**
 * Proves how the vault key is resolved from `KUMO_MASTER_KEY`.
 *
 * The bug this guards against was a format mismatch, not a wrong algorithm: the deployment docs say
 * 32 bytes base64 and the code asked for hex of 64+ characters, so a documented key was silently
 * skipped and the vault was encrypted with a key derived from `JWT_SECRET`
 * (KUMO-SECURITY-REVIEW.md, finding 1). The negative case — *a key was supplied and must not be
 * silently ignored* — is the one worth having a test for.
 *
 * Each case runs in its own process, because the key is resolved once and cached and the whole point
 * is that a different environment means a different key.
 *
 *   pnpm probe:kumo-key
 */
import { spawnSync } from "node:child_process";

const CASES: { name: string; env: NodeJS.ProcessEnv; expect: "KUMO_MASTER_KEY" | "JWT_SECRET" | "refuse" }[] = [
  { name: "base64 key (the documented format)", env: { KUMO_MASTER_KEY: Buffer.alloc(32, 7).toString("base64") }, expect: "KUMO_MASTER_KEY" },
  { name: "hex key (64 characters)", env: { KUMO_MASTER_KEY: "ab".repeat(32) }, expect: "KUMO_MASTER_KEY" },
  { name: "base64 key without padding (43 characters)", env: { KUMO_MASTER_KEY: Buffer.alloc(32, 7).toString("base64").replace(/=+$/, "") }, expect: "KUMO_MASTER_KEY" },
  { name: "base64 key for 16 bytes (too short)", env: { KUMO_MASTER_KEY: Buffer.alloc(16, 7).toString("base64") }, expect: "refuse" },
  { name: "base64 key for 48 bytes (too long, 64 characters)", env: { KUMO_MASTER_KEY: Buffer.alloc(48, 7).toString("base64") }, expect: "refuse" },
  { name: "not a key at all", env: { KUMO_MASTER_KEY: "not-a-key!!!" }, expect: "refuse" },
  { name: "hex of the wrong length", env: { KUMO_MASTER_KEY: "ab".repeat(20) }, expect: "refuse" },
  { name: "unset outside production", env: { NODE_ENV: "development", JWT_SECRET: "a-development-secret" }, expect: "JWT_SECRET" },
  { name: "unset in production", env: { NODE_ENV: "production", JWT_SECRET: "a-production-secret" }, expect: "refuse" },
  { name: "set in production", env: { NODE_ENV: "production", KUMO_MASTER_KEY: Buffer.alloc(32, 3).toString("base64") }, expect: "KUMO_MASTER_KEY" },
  { name: "empty string is treated as unset", env: { NODE_ENV: "development", KUMO_MASTER_KEY: "   ", JWT_SECRET: "a-development-secret" }, expect: "JWT_SECRET" },
];

const isChild = process.argv.length > 2 && process.argv[2] === "--case";
const self = __filename;

if (isChild) {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { kumoKeyStatus } = require("./services/kumoCrypto") as typeof import("./services/kumoCrypto");
  try {
    const status = kumoKeyStatus();
    process.stdout.write(JSON.stringify({ ok: true, source: status.source, fingerprint: status.fingerprint }));
  } catch (e) {
    process.stdout.write(JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }));
  }
  process.exit(0);
}

let passed = 0;
let failed = 0;

for (const c of CASES) {
  const env = { ...process.env, NODE_ENV: "development", JWT_SECRET: "", KUMO_MASTER_KEY: "", ...c.env };
  if (c.env.KUMO_MASTER_KEY === undefined) delete env.KUMO_MASTER_KEY;
  if (c.env.KUMO_MASTER_KEY === undefined && c.env.NODE_ENV === undefined) delete env.NODE_ENV;

  const r = spawnSync(process.execPath, ["--import", "tsx", self, "--case"], { env, encoding: "utf8", cwd: __dirname });
  const raw = (r.stdout || "").trim().split("\n").pop() || "";
  let out: { ok: boolean; source?: string; fingerprint?: string; error?: string };
  try {
    out = JSON.parse(raw);
  } catch {
    out = { ok: false, error: `probe produced no JSON (stderr: ${(r.stderr || "").trim().split("\n").slice(-2).join(" | ")})` };
  }

  let ok: boolean;
  let detail: string;
  if (c.expect === "refuse") {
    ok = !out.ok;
    detail = out.ok ? `accepted it, resolving to ${out.source}` : `refused: ${(out.error || "").split(".")[0]}.`;
  } else {
    ok = out.ok && out.source === c.expect;
    detail = out.ok ? `resolved to ${out.source} (${out.fingerprint})` : `threw: ${out.error}`;
  }

  if (ok) passed++;
  else failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${c.name.padEnd(44)} ${detail}`);
}

console.log("");
console.log(`kumo key probe: ${passed} passed / ${failed} failed`);
process.exitCode = failed === 0 ? 0 : 1;