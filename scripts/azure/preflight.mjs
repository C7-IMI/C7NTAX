#!/usr/bin/env node
/**
 * Deployment preflight (PLAN-016).
 *
 * Runs before any Azure deployment, and is safe to run locally at any time. It checks the
 * things that would otherwise fail *during* a deploy — a stale lockfile, a missing
 * migration baseline, an environment variable the API needs but nobody documented, a
 * broken guard — so the failure happens here instead of halfway through a production push.
 *
 *   node scripts/azure/preflight.mjs            # everything except the image build
 *   node scripts/azure/preflight.mjs --docker   # also build the container image
 *
 * Exits non-zero on the first category of failure it finds; every check is reported.
 */import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const withDocker = process.argv.includes("--docker");

let failures = 0;
let warnings = 0;
const ok = m => console.log(`  ok    ${m}`);
const fail = m => { failures++; console.log(`  FAIL  ${m}`); };
const warn = m => { warnings++; console.log(`  warn  ${m}`); };

function run(command) {
  try { return { ok: true, out: execSync(command, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim() }; }
  catch (error) { return { ok: false, out: `${error.stdout ?? ""}${error.stderr ?? ""}`.trim() || String(error.message) }; }
}

console.log("repository");
{
  const lock = existsSync(path.join(root, "pnpm-lock.yaml"));
  lock ? ok("pnpm-lock.yaml present") : fail("pnpm-lock.yaml is missing — the image build needs it");
  const frozen = run("pnpm install --frozen-lockfile --lockfile-only --reporter=silent");
  frozen.ok ? ok("lockfile matches the manifests") : fail(`lockfile is out of date — run pnpm install (${frozen.out.split("\n")[0]})`);
  const branch = run("git rev-parse --abbrev-ref HEAD");
  if (branch.ok) {
    branch.out === "main" ? ok(`on ${branch.out}`) : warn(`on ${branch.out}, not main — deploy tags will not match a release commit`);
    const dirty = run("git status --porcelain");
    dirty.ok && dirty.out
      ? warn(`${dirty.out.split("\n").length} uncommitted file(s) — the image tag is derived from the commit, so the deploy would not be reproducible`)
      : ok("working tree clean");
  }
}

console.log("\napplication guards");
{
  const guards = run("pnpm guard:routes");
  guards.ok ? ok(`route guards: ${guards.out.split("\n").at(-2)?.trim() ?? "passed"}`) : fail(`route guards: ${guards.out.split("\n").slice(-6).join(" | ")}`);
  const deps = run("pnpm guard:deps");
  deps.ok ? ok("dependency baseline: no unaccepted advisories") : fail(`dependency baseline: ${deps.out.split("\n").at(-2) ?? "failed"}`);
}

console.log("\nmigrations");
{
  const migrationsDir = path.join(root, "apps", "api", "prisma", "migrations");
  if (!existsSync(migrationsDir)) {
    fail("apps/api/prisma/migrations is missing — production schema sync uses prisma migrate deploy");
  } else {
    const entries = readdirSync(migrationsDir, { withFileTypes: true }).filter(e => e.isDirectory());
    entries.length
      ? ok(`${entries.length} migration(s): ${entries.map(e => e.name).join(", ")}`)
      : fail("no migrations are checked in — the baseline has not been generated");
    const lockfile = path.join(migrationsDir, "migration_lock.toml");
    existsSync(lockfile) ? ok("migration_lock.toml present") : warn("migration_lock.toml is missing; prisma will write it on the next migrate command");
  }
}

console.log("\ncontainer image");
{
  const dockerfile = path.join(root, "Dockerfile");
  if (!existsSync(dockerfile)) {
    fail("Dockerfile is missing");
  } else {
    const body = readFileSync(dockerfile, "utf8");
    ok("Dockerfile present");
    /USER\s+node/.test(body) ? ok("runs as a non-root user") : fail("the image does not set a non-root USER");
    body.includes("HEALTHCHECK") ? ok("declares a HEALTHCHECK") : warn("no HEALTHCHECK — Container Apps probes must be configured instead");
    body.includes("--frozen-lockfile") ? ok("installs with --frozen-lockfile") : warn("the image install is not locked to the lockfile");
    if (withDocker) {
      const info = run("docker info --format {{.ServerVersion}}");
      if (!info.ok) {
        fail("--docker was requested but the Docker daemon is not reachable");
      } else {
        const tag = `c7ntax:preflight-${Date.now()}`;
        console.log(`  ...   building ${tag} (this takes a few minutes)`);
        const build = run(`docker build -q -t ${tag} .`);
        build.ok ? ok(`image builds (${build.out.slice(0, 12)})`) : fail(`image build failed: ${build.out.split("\n").slice(-8).join(" | ")}`);
        if (build.ok) run(`docker rmi ${tag}`);
      }
    } else {
      warn("image build skipped (pass --docker to build it)");
    }
  }
}

console.log("\ninfrastructure contract");
{
  // PLAN-030. These are the two properties that decide whether an infrastructure run can move
  // something it must not: what the app is running, and where traffic goes.
  const mainPath = path.join(root, "infra", "main.bicep");
  if (!existsSync(mainPath)) {
    fail("infra/main.bicep is missing");
  } else {
    const main = readFileSync(mainPath, "utf8");
    /\bparam\s+imageTag\s+string\s*=/m.test(main)
      ? fail("infra/main.bicep gives imageTag a default — deploy-env.ps1 must pass the tag the app is running (§1.3)")
      : ok("imageTag has no default, so a Bicep run cannot introduce an image of its own");

    // Review §5. Traffic has to be *restated*, not omitted: a Bicep deployment is a PUT of the whole
    // resource, and an absent `ingress.traffic` reads as the default — `latestRevision: true` —
    // which hands 100% to a revision the health gate has not looked at. The template therefore
    // declares the traffic rule and restates the serving revision, which the script reads before it
    // creates a new one and passes. An empty `activeRevision` is by design (it means "nothing is
    // serving yet"), so the guard is that the default is *empty* — never a revision name the
    // template picked for itself.
    const activeRevisionParam = main.match(/\bparam\s+activeRevision\s+string\s*=\s*'([^']*)'/m);
    const activeRevisionRestated = /\brevisionName\s*:\s*activeRevision\b/m.test(main);
    if (!activeRevisionParam) {
      fail("infra/main.bicep has no `param activeRevision string = ''` — the ingress traffic rule cannot restate the serving revision (review §5)");
    } else if (activeRevisionParam[1] !== "") {
      fail(`infra/main.bicep defaults activeRevision to '${activeRevisionParam[1]}' — the template would pin a revision of its own choosing, not the one serving (review §5)`);
    } else if (!activeRevisionRestated) {
      fail("infra/main.bicep does not use activeRevision as the ingress traffic revisionName — traffic would fall back to the latest revision (review §5)");
    } else {
      ok("activeRevision defaults to empty and restates the serving revision in the ingress traffic rule");
    }

    main.includes("activeRevisionsMode: 'Multiple'")
      ? ok("activeRevisionsMode is Multiple")
      : fail("activeRevisionsMode is not Multiple — a Bicep run would flip back the mode the script sets (§1.3)");
  }
  const deployPath = path.join(root, "scripts", "azure", "deploy-env.ps1");
  if (!existsSync(deployPath)) {
    fail("scripts/azure/deploy-env.ps1 is missing");
  } else {
    const deploy = readFileSync(deployPath, "utf8");
    deploy.includes("activeRevision=")
      ? ok("deploy-env.ps1 passes activeRevision to the Bicep step")
      : fail("deploy-env.ps1 does not pass activeRevision — a Bicep run would reset traffic to the latest revision (review §5)");
    /properties\.trafficWeight==/.test(deploy)
      ? ok("deploy-env.ps1 reads the revision serving 100% of traffic before creating a new one")
      : fail("deploy-env.ps1 does not read the serving revision (properties.trafficWeight) before the revision step (review §5)");
  }
  const paramsDir = path.join(root, "infra", "params");
  for (const file of existsSync(paramsDir) ? readdirSync(paramsDir) : []) {
    if (!file.endsWith(".bicepparam")) continue;
    const body = readFileSync(path.join(paramsDir, file), "utf8");
    const empty = [...body.matchAll(/^param\s+(jwtSecret|kumoMasterKey|postgresAdminPassword)\s*=\s*''/gm)].map(m => m[1]);
    empty.length
      ? fail(`infra/params/${file} sets ${empty.join(", ")} to an empty string — read it with readEnvironmentVariable instead (§2.2)`)
      : ok(`infra/params/${file}: no empty secret values`);
  }
}

console.log("\nenvironment contract");
{
  const templatePath = path.join(root, "infra", "env", ".env.production.example");
  if (!existsSync(templatePath)) {
    fail("infra/env/.env.production.example is missing");
  } else {
    const documented = new Set(
      readFileSync(templatePath, "utf8")
        .split("\n")
        .map(line => line.match(/^([A-Z][A-Z0-9_]*)=/)?.[1])
        .filter(Boolean),
    );
    // Variables the API reads that are optional or local-only.
    const ignored = new Set([
      "C7NTAX_ROOT", "DD_READER_BASE_URL", "EMAIL_EWS_MAX_MESSAGES", "EMAIL_EWS_TIMEOUT_MS",
      "EMAIL_IMAP_ALLOW_SELF_SIGNED", "EWS_ALLOW_SELF_SIGNED", "EWS_ENDPOINT", "GRAPH_API_BASE",
      "GRAPH_TOKEN_BASE", "AUTH_TEST_BYPASS", "AUTH_TEST_BYPASS_ACCOUNT", "AUTH_TEST_BYPASS_TOKEN_TTL",
    ]);
    const sources = ["apps/api/src", "packages/email/src", "packages/shared/src", "packages/integrations/src"];
    const used = new Set();
    for (const dir of sources) {
      const files = run(`git ls-files "${dir.replace(/\\/g, "/")}"`).out.split("\n").filter(f => f.endsWith(".ts"));
      for (const file of files) {
        // A worktree mid-edit can name files that are staged for deletion; skipping them keeps
        // the preflight useful before a commit instead of crashing on it.
        if (!existsSync(path.join(root, file))) continue;
        const body = readFileSync(path.join(root, file), "utf8");
        for (const match of body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) used.add(match[1]);
      }
    }
    const undocumented = [...used].filter(name => !documented.has(name) && !ignored.has(name) && !name.startsWith("npm_"));
    undocumented.length === 0
      ? ok(`all ${used.size} variables the source reads are documented (or explicitly local-only)`)
      : fail(`undocumented in the template: ${undocumented.join(", ")}`);
    for (const name of ["JWT_SECRET", "KUMO_MASTER_KEY", "DATABASE_URL", "WEB_ORIGIN"]) {
      documented.has(name) ? ok(`${name} documented`) : fail(`${name} is missing from the template`);
    }
  }
}

console.log("\nworkflow");
{
  const workflow = path.join(root, ".github", "workflows", "deploy-azure.yml");
  existsSync(workflow) ? ok("deploy-azure.yml present") : fail(".github/workflows/deploy-azure.yml is missing");
  const security = path.join(root, ".github", "workflows", "security.yml");
  existsSync(security) ? ok("security.yml present") : warn("the security gate workflow is missing");
}

console.log(`\n${failures} failure(s), ${warnings} warning(s)`);
process.exit(failures === 0 ? 0 : 1);
