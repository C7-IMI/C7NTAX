#!/usr/bin/env node
/**
 * Validates the Bicep templates (PLAN-016).
 *
 * The templates are the part of the deployment package that cannot be exercised without a
 * subscription, so at least their syntax and resource-property schemas are checked here —
 * the same check `az bicep build` performs. Uses the Bicep CLI from PATH, or from
 * BICEP_PATH, and explains how to get it when neither is available.
 *
 *   node scripts/azure/validate-bicep.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

function bicepCommand() {
  if (process.env.BICEP_PATH) return process.env.BICEP_PATH;
  for (const name of process.platform === "win32" ? ["bicep.exe", "bicep"] : ["bicep"]) {
    try {
      execFileSync(name, ["--version"], { stdio: "ignore" });
      return name;
    } catch { /* try the next name */ }
  }
  return null;
}

const bicep = bicepCommand();
if (!bicep) {
  console.error("The Bicep CLI is not available.");
  console.error("Install it with: az bicep install");
  console.error("or download the standalone binary and set BICEP_PATH, e.g.");
  console.error("  BICEP_PATH=%TEMP%\\bicep-cli\\bicep.exe node scripts/azure/validate-bicep.mjs");
  process.exit(1);
}

const version = execFileSync(bicep, ["--version"], { encoding: "utf8" }).trim();
console.log(`bicep: ${version.split("\n")[0]}`);

const outDir = mkdtempSync(path.join(tmpdir(), "bicep-out-"));
const targets = [
  path.join(root, "infra", "main.bicep"),
  ...readdirSync(path.join(root, "infra", "params")).map(f => path.join(root, "infra", "params", f)),
];

let failures = 0;
for (const file of targets) {
  if (!existsSync(file)) { console.log(`  FAIL  ${path.relative(root, file)} is missing`); failures++; continue; }
  try {
    const args = file.endsWith(".bicepparam") ? ["build-params", file, "--stdout"] : ["build", file, "--stdout"];
    const output = execFileSync(bicep, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
    const warnings = output.split("\n").filter(line => /:\s*(Warning|Error)\s/.test(line));
    if (warnings.length) {
      failures++;
      console.log(`  FAIL  ${path.relative(root, file)}`);
      for (const warning of warnings) console.log(`        ${warning}`);
    } else {
      console.log(`  ok    ${path.relative(root, file)}`);
    }
  } catch (error) {
    failures++;
    console.log(`  FAIL  ${path.relative(root, file)}`);
    for (const line of String(error.stdout || error.stderr || error.message).split("\n").slice(0, 10)) console.log(`        ${line}`);
  }
}

rmSync(outDir, { recursive: true, force: true });
console.log(failures === 0 ? "\nall templates compile without warnings" : `\n${failures} template(s) failed`);
process.exit(failures === 0 ? 0 : 1);
