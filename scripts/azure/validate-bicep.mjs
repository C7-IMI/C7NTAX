#!/usr/bin/env node
/**
 * Validates the Bicep templates (PLAN-016).
 *
 * The templates are the part of the deployment package that cannot be exercised without a
 * subscription, so at least their syntax and resource-property schemas are checked here —
 * the same check `az bicep build` performs. Uses the Bicep CLI from PATH, or from
 * BICEP_PATH, and explains how to get it when neither is available.
 *
 * A `.bicepparam` file reads its deploy-time values out of the environment
 * (`readEnvironmentVariable`, PLAN-030 §2.2), which is what makes a deployment that is
 * missing a secret fail before it starts — but it also means `build-params` fails when they
 * are not exported here. The variables the files ask for are filled in with obvious
 * placeholders for the length of this check, so the gate still tests the templates rather
 * than the operator's shell. Nothing is deployed; the values never leave this process.
 *
 *   node scripts/azure/validate-bicep.mjs
 */
import { execFileSync } from "node:child_process";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
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

const paramDir = path.join(root, "infra", "params");
const paramFiles = readdirSync(paramDir).map(f => path.join(paramDir, f));

// Every variable the parameter files expect, filled in only when it is not already exported.
const placeholders = new Set();
for (const file of paramFiles) {
  if (!file.endsWith(".bicepparam")) continue;
  for (const match of readFileSync(file, "utf8").matchAll(/readEnvironmentVariable\(\s*'([^']+)'/g)) {
    if (process.env[match[1]] === undefined) {
      // Long enough for the templates' @minLength constraints, and obviously not a secret.
      process.env[match[1]] = "validation-placeholder-not-a-secret-0123456789";
      placeholders.add(match[1]);
    }
  }
}
if (placeholders.size) {
  console.log(`note: filled in for this check only: ${[...placeholders].sort().join(", ")}`);
}

const outDir = mkdtempSync(path.join(tmpdir(), "bicep-out-"));
const targets = [
  path.join(root, "infra", "main.bicep"),
  ...paramFiles,
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
