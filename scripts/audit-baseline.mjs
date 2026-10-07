#!/usr/bin/env node
/**
 * Dependency audit baseline (PLAN-018 Phase 1 step 5, Phase 3 step 1).
 *
 *   node scripts/audit-baseline.mjs --write    regenerate security/audit-baseline.json
 *   node scripts/audit-baseline.mjs            check the tree against the baseline (CI gate)
 *   node scripts/audit-baseline.mjs --json     print the current report without comparing
 *
 * The check fails on:
 *   · any production advisory that is not in the accepted list (any severity), because
 *     production advisories are in code we ship; and
 *   · any high or critical advisory anywhere that is not accepted, because the build
 *     machine matters too (a compromised build machine ships compromised artefacts).
 * Everything else is reported as a warning so the gate stays meaningful.
 *
 * Accepted risks are matched on package + advisory identity, never on a count, so adding
 * a new advisory for an already-accepted package still fails.
 */
import { execSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const baselinePath = path.join(root, "security", "audit-baseline.json");

const args = process.argv.slice(2);
const write = args.includes("--write");
const jsonOnly = args.includes("--json");

/** Runs pnpm audit and returns the advisories as a flat, comparable list. */
function audit(extraArgs) {
  let raw;
  const command = ["pnpm", "audit", "--json", ...extraArgs].join(" ");
  try {
    raw = execSync(command, { cwd: root, maxBuffer: 64 * 1024 * 1024, encoding: "utf8", shell: true });
  } catch (error) {
    // pnpm exits non-zero when it finds advisories; the JSON report is on stdout.
    raw = error.stdout;
    if (!raw) throw error;
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("pnpm audit did not return JSON — is the workspace installed?");
  }
}

function flatten(report, prod) {
  const advisories = report.advisories ?? {};
  const out = [];
  for (const [id, a] of Object.entries(advisories)) {
    // pnpm reports `module_name`; npm reports `module`.
    const module = a.module_name ?? a.module ?? "unknown";
    out.push({
      key: `${module}|${a.github_advisory_id || a.cves?.[0] || id}`,
      id: Number(id),
      module,
      severity: a.severity,
      title: a.title,
      vulnerableVersions: a.vulnerable_versions,
      patchedVersions: a.patched_versions === "<0.0.0" ? "no fix published" : a.patched_versions,
      cves: a.cves ?? [],
      ghsa: a.github_advisory_id ?? null,
      url: a.url,
      prod,
      paths: [...new Set((a.findings ?? []).flatMap(f => f.paths ?? []))].slice(0, 4),
    });
  }
  return out;
}

const prodReport = audit(["--prod"]);
const allReport = audit([]);
const prodAdvisories = flatten(prodReport, true);
const prodKeys = new Set(prodAdvisories.map(a => a.key));
const all = flatten(allReport, false);
const merged = [
  ...prodAdvisories,
  ...all.filter(a => !prodKeys.has(a.key)),
].sort((a, b) => (a.module === b.module ? a.key.localeCompare(b.key) : a.module.localeCompare(b.module)));

const bySeverity = merged.reduce((acc, a) => { acc[a.severity] = (acc[a.severity] ?? 0) + 1; return acc; }, {});
const report = {
  generatedAt: new Date().toISOString(),
  command: "node scripts/audit-baseline.mjs --write",
  packageManager: (() => {
    try { return execSync("pnpm --version", { cwd: root, encoding: "utf8", shell: true }).trim(); }
    catch { return "unknown"; }
  })(),
  totals: {
    advisories: merged.length,
    production: prodAdvisories.length,
    bySeverity,
  },
  advisories: merged,
};

const previous = existsSync(baselinePath) ? JSON.parse(readFileSync(baselinePath, "utf8")) : { accepted: [] };
const previousAccepted = new Map((previous.accepted ?? []).map(a => [a.key, a]));

if (jsonOnly) {
  console.log(JSON.stringify(report, null, 2));
  process.exit(0);
}

if (write) {
  ok(`advisories: ${report.totals.advisories} (${report.totals.production} in production)`);
  for (const [severity, count] of Object.entries(bySeverity).sort()) ok(`  ${severity}: ${count}`);
  for (const a of report.advisories) ok(`  ${a.prod ? "prod " : "dev  "} ${a.severity.padEnd(8)} ${a.module} ${a.ghsa || a.cves[0] || ""}`);
  const baseline = {
    generatedAt: report.generatedAt,
    command: report.command,
    packageManager: report.packageManager,
    totals: report.totals,
    accepted: report.advisories
      .filter(a => previousAccepted.has(a.key))
      .map(a => previousAccepted.get(a.key)),
    advisories: report.advisories,
  };
  mkdirSync(path.join(root, "security"), { recursive: true });
  writeFileSync(baselinePath, JSON.stringify(baseline, null, 2) + "\n");
  ok(`wrote ${path.relative(root, baselinePath)}`);
  process.exit(0);
}

function ok(message) { console.log(message); }

/**
 * The security overrides are declared twice, on purpose — see the note in `pnpm-workspace.yaml`.
 * pnpm 9 reads them only from the root `pnpm` field in package.json, pnpm 10+ only from the
 * workspace file, and the two toolchains are both in play depending on how the tree is resolved.
 * Two copies drift, and a drifted copy is a security floor that quietly stops applying, so the
 * sets are held equal here rather than by a comment asking politely.
 */
function compareOverrides() {
  const pkg = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  const inPackageJson = pkg.pnpm?.overrides ?? {};
  const raw = readFileSync(path.join(root, "pnpm-workspace.yaml"), "utf8");
  const block = raw.split(/^overrides:\s*$/m)[1];
  const inWorkspace = {};
  if (block) {
    for (const line of block.split("\n")) {
      const match = /^\s+("?[^":#]+"?):\s*["']?([^"'#]+?)["']?\s*$/.exec(line);
      if (match) inWorkspace[match[1].replace(/"/g, "")] = match[2].trim();
    }
  }

  const onlyPackage = Object.keys(inPackageJson).filter(k => !(k in inWorkspace));
  const onlyWorkspace = Object.keys(inWorkspace).filter(k => !(k in inPackageJson));
  const differing = Object.keys(inPackageJson).filter(
    k => k in inWorkspace && String(inPackageJson[k]) !== inWorkspace[k],
  );

  if (onlyPackage.length || onlyWorkspace.length || differing.length) {
    console.error("\nthe security overrides in package.json and pnpm-workspace.yaml have drifted:\n");
    for (const k of onlyPackage) console.error(`  x ${k} is in package.json only`);
    for (const k of onlyWorkspace) console.error(`  x ${k} is in pnpm-workspace.yaml only`);
    for (const k of differing) {
      console.error(`  x ${k}: package.json has ${inPackageJson[k]}, pnpm-workspace.yaml has ${inWorkspace[k]}`);
    }
    console.error("\nAn override only one package manager reads is a floor that stops applying.");
    return false;
  }
  console.log(`override parity: ${Object.keys(inPackageJson).length} security floors declared in both files`);
  return true;
}

if (!existsSync(baselinePath)) {
  console.error("security/audit-baseline.json is missing — run: node scripts/audit-baseline.mjs --write");
  process.exit(1);
}

const acceptedKeys = new Set((previous.accepted ?? []).map(a => a.key));
const acceptedList = previous.accepted ?? [];
const failures = [];
const warnings = [];

for (const a of report.advisories) {
  if (acceptedKeys.has(a.key)) continue;
  const label = `${a.module} ${a.ghsa || a.cves[0] || `advisory ${a.id}`} (${a.severity}, ${a.prod ? "production" : "dev"}, vulnerable ${a.vulnerableVersions}, patched ${a.patchedVersions})`;
  if (a.prod) failures.push(`${label} — new production advisory`);
  else if (a.severity === "high" || a.severity === "critical") failures.push(`${label} — new high-severity advisory`);
  else warnings.push(label);
}

for (const a of acceptedList) {
  if (!report.advisories.some(x => x.key === a.key)) {
    warnings.push(`${a.module} ${a.ghsa || a.cves?.[0] || ""} is no longer reported — remove it from the accepted list`);
  }
}

console.log(`dependency audit: ${report.totals.advisories} advisories (${report.totals.production} in production), ${acceptedList.length} accepted`);
if (warnings.length) {
  console.log(`\nwarnings (${warnings.length}):`);
  for (const w of warnings) console.log(`  ! ${w}`);
}
if (failures.length) {
  console.log(`\nunaccepted advisories (${failures.length}):`);
  for (const f of failures) console.log(`  x ${f}`);
  console.log("\nFix them, or record them in security/audit-baseline.json with a reason and re-run with --write.");
  process.exit(1);
}
if (!compareOverrides()) process.exit(1);
console.log("\nno unaccepted production or high-severity advisories");
