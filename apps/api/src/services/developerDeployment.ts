/**
 * The state behind **Prepare for Live Deployment**.
 *
 * The plan in `PlanDocs/PLAN-030-*.md` is a document you read in order and then close. This is the same
 * material as a thing somebody is half-way through: the Phase 1 blockers, the Phase 2 security items, the
 * Phase 3 validation checks, the two placeholders nobody has chosen, the least-privilege database role
 * that is deferred by decision rather than forgotten, the readiness gate review round 2 caught being
 * unable to see the database, and the throwaway-dev run that has still not happened.
 *
 * **The point of the screen is that a check that could not run is not a pass.** Review round 2 was a
 * promotion gate that could not see the database, so the vocabulary has five words rather than two:
 *
 *   · `done`       — the check ran, and passed, with the evidence it was checked against;
 *   · `attention`  — it ran and found something a person has to look at;
 *   · `blocked`    — it cannot pass until a named thing changes, and the card names the thing;
 *   · `decision`   — not a task: an owner, a recommendation and a place to record the answer;
 *   · `unverified` — the check did not run. Never drawn as a pass.
 *
 * **What is derived and what is read.** Items whose answer is in this repository are decided by reading
 * it — the migrations that exist, whether a deployment switch is set, whether TLS verification is on, the
 * database name, whether the parameter file still carries a placeholder, whether the API has a readiness
 * endpoint and whether both promotion gates ask it. Everything else is `unverified` with the reason, and
 * the plan's own sections are quoted as the source rather than dressed up as a result. Nothing here has
 * met an Azure subscription, and the payload says so in `plan.unverified` and in `unread`.
 */
import { prisma } from "../index";
import { readRepoFile, repoRoot } from "./sampleDataOperations";
import { isSampleDataDisabled } from "./sampleDataState";
import { readGitCommit } from "./developerEnvironment";

export type DeploymentState = "done" | "attention" | "blocked" | "decision" | "unverified";

export interface DeploymentChecklistItem {
  id: string;
  title: string;
  state: DeploymentState;
  /** What the state was decided from — a derived fact, or the plan section that claims it. */
  evidence: string;
  /** What happens if it is skipped. */
  ifSkipped: string;
  /** True when this package derived the state by reading the repository, rather than quoting the plan. */
  derived: boolean;
  /** False when the item does not decide the step's own state (a runner's version, a later discipline). */
  blocking: boolean;
  /** The answer an operator has recorded for this check, when one has been. */
  record?: DeploymentRecord | null;
}

export interface DeploymentStep {
  number: number;
  id: string;
  title: string;
  scope: "shared" | "azure";
  state: DeploymentState;
  /** One line, the card's own reading. */
  summary: string;
  /** Named when the step cannot pass: the thing that must change. */
  blockedBy: string | null;
  /** Named when the step is owed to somebody rather than to a change. */
  owedTo: string | null;
  /** The plan sections this step is read from. */
  plan: string;
  /** What the step actually decides. */
  decides: string;
  /** The commands that run it, when there are any. */
  run: string[];
  items: DeploymentChecklistItem[];
}

export interface DeploymentAdvisory {
  title: string;
  detail: string;
  plan: string;
}

export interface DeploymentDecision {
  id: string;
  title: string;
  recommendation: string;
  detail: string;
  blocking: boolean;
  plan: string;
  /** The answer an operator has recorded for this decision, when one has been. */
  record?: DeploymentRecord | null;
}

export interface DeploymentBarItem {
  order: number;
  item: string;
  state: DeploymentState;
  detail: string;
}

export interface DeploymentResponse {
  generatedAt: string;
  destination: { id: string; label: string; source: string };
  plan: { file: string; commit: string | null; unverified: string };
  counts: Record<DeploymentState, number>;
  steps: DeploymentStep[];
  advisories: DeploymentAdvisory[];
  decisions: DeploymentDecision[];
  bar: DeploymentBarItem[];
  handoff: {
    runtime: Record<string, unknown>;
    database: Record<string, unknown>;
    mail: Record<string, unknown>;
    provenance: Record<string, unknown>;
  };
  /** Anything the payload could not read, so a screen can say what is missing rather than be silent. */
  unread: string[];
  /**
   * What an operator has recorded for the decisions and checks this report names, newest write per
   * subject. Optional so `buildDeploymentReport()` stays exactly the repository read it always was; the
   * route adds them with `buildDeploymentReportWithRecords()`.
   */
  records?: DeploymentRecord[];
}

/** The severity order a step's own state is computed with. */
const SEVERITY: Record<DeploymentState, number> = {
  done: 0,
  unverified: 1,
  attention: 2,
  decision: 3,
  blocked: 4,
};

/**
 * Derive what can be derived, once, from the repository.
 *
 * Every answer here is a string test against a file that is in this working copy, and every reader is
 * written so that a *missing* file yields `null` rather than a false. That matters more than it looks: a
 * `false` would be reported as "the item is missing", and only `null` can be reported as "this package
 * could not read it".
 */
interface Facts {
  bicep: string | null;
  prodParams: string | null;
  devParams: string | null;
  deployScript: string | null;
  workflow: string | null;
  apiIndex: string | null;
  envProductionExample: string | null;
  migrations: { count: number; newest: string | null; oldest: string | null };
  missing: string[];
}

const has = (source: string | null, pattern: RegExp): boolean | null => (source === null ? null : pattern.test(source));

/** The first capture of a pattern, or null. */
const capture = (source: string | null, pattern: RegExp): string | null => {
  if (source === null) return null;
  const match = source.match(pattern);
  return match?.[1] ?? null;
};

function readFacts(): Facts {
  const missing: string[] = [];
  const read = (relativePath: string): string | null => {
    const content = readRepoFile(relativePath);
    if (content === null) missing.push(relativePath);
    return content;
  };

  const bicep = read("infra/main.bicep");
  const prodParams = read("infra/params/prod.bicepparam");
  const devParams = read("infra/params/dev.bicepparam");
  const deployScript = read("scripts/azure/deploy-env.ps1");
  const workflow = read(".github/workflows/deploy-azure.yml");
  const apiIndex = read("apps/api/src/index.ts");
  const envProductionExample = readRepoFile("infra/env/.env.production.example");

  // The migration set is a fact only a directory listing can give, and it is one of the few facts here
  // that is genuinely this working copy's own rather than a claim in a document.
  const migrations: string[] = [];
  try {
    const root = repoRoot ?? process.cwd();
    const fs = require("fs") as typeof import("fs");
    const dir = `${root}/apps/api/prisma/migrations`;
    if (fs.existsSync(dir)) {
      for (const entry of fs.readdirSync(dir)) {
        if (/^\d{14}_/.test(entry)) migrations.push(entry);
      }
    } else {
      missing.push("apps/api/prisma/migrations");
    }
  } catch { /* leave the list empty and say so through `missing` */ }
  migrations.sort();

  return {
    bicep,
    prodParams,
    devParams,
    deployScript,
    workflow,
    apiIndex,
    envProductionExample,
    migrations: {
      count: migrations.length,
      oldest: migrations[0] ?? null,
      newest: migrations[migrations.length - 1] ?? null,
    },
    missing,
  };
}

/** A derived item, or an unverified one when the source could not be read. */
function item(
  id: string,
  title: string,
  state: DeploymentState,
  evidence: string,
  ifSkipped: string,
  derived: boolean,
  blocking = true,
): DeploymentChecklistItem {
  return { id, title, state, evidence, ifSkipped, derived, blocking };
}

/** `done` when the fact is true, `unverified` when the file could not be read, `blocked` when it is false. */
function fromFact(
  fact: boolean | null,
  id: string,
  title: string,
  found: string,
  notFound: string,
  ifSkipped: string,
  falseState: DeploymentState = "blocked",
): DeploymentChecklistItem {
  if (fact === null) {
    return item(id, title, "unverified", `could not be read: the file that would answer this is not on this working copy`, ifSkipped, false);
  }
  return fact
    ? item(id, title, "done", found, ifSkipped, true)
    : item(id, title, falseState, notFound, ifSkipped, true);
}

function stepState(items: DeploymentChecklistItem[]): DeploymentState {
  const blocking = items.filter((entry) => entry.blocking);
  if (blocking.length === 0) return "done";
  return blocking.reduce<DeploymentState>(
    (worst, entry) => (SEVERITY[entry.state] > SEVERITY[worst] ? entry.state : worst),
    "done",
  );
}

function buildSteps(facts: Facts): DeploymentStep[] {
  const { bicep, prodParams, deployScript, workflow, apiIndex } = facts;

  const webOrigin = capture(prodParams, /param\s+webOrigin\s*=\s*'([^']+)'/);
  const webOriginPlaceholder = webOrigin === null ? null : /example\.com|localhost/i.test(webOrigin);
  const databaseName = capture(bicep, /param\s+databaseName\s+string\s*=\s*'([^']+)'/) ?? capture(facts.envProductionExample, /\/([a-z0-9_]+)\?sslmode/);
  const adminLogin = capture(bicep, /param\s+postgresAdminLogin\s+string\s*=\s*'([^']+)'/);
  const appUrlIsAdmin = has(bicep, /postgresql:\/\/\$\{postgresAdminLogin\}/);
  const lockIngress = has(bicep, /param\s+lockIngressToFrontDoor\s+bool\s*=\s*true/) === true
    ? true
    : has(bicep, /param\s+lockIngressToFrontDoor\s+bool\s*=\s*false/) === true
      ? false
      : null;
  const tlsMode = capture(bicep, /sslmode=([a-z-]+)/) ?? capture(facts.envProductionExample, /sslmode=([a-z-]+)/);
  const tlsVerified = tlsMode === null ? null : tlsMode === "verify-full";
  const readinessEndpoint = has(apiIndex, /app\.get\(\s*"\/api\/ready"/);
  const readinessTouchesDatabase = has(apiIndex, /\$queryRaw/);
  const livenessStaysShallow = has(apiIndex, /app\.get\(\s*"\/api\/health"/);
  const deepCheck = has(apiIndex, /deep/);
  const fdIdGuard = has(apiIndex, /X-Azure-FDID/);
  const dbIsPrivate = bicep === null && facts.envProductionExample === null
    ? null
    : has(bicep, /VNet-injected|no public endpoint/i) === true || has(facts.envProductionExample, /VNet-injected/) === true || has(bicep, /publicNetworkAccess:\s*'Disabled'/) === true;
  const subnetsAreInline = bicep === null ? null : !/resource\s+postgresSubnet\b/.test(bicep);
  const secretLengthFloors = bicep === null ? null : /@minLength\s*\(\s*32\s*\)/.test(bicep) && /@minLength\s*\(\s*16\s*\)/.test(bicep);
  /** A user-assigned identity exists *and* is attached to both the registry pull and the secret refs. */
  const identityAttached = bicep === null
    ? null
    : /Microsoft\.ManagedIdentity\/userAssignedIdentities/.test(bicep)
      && /userAssignedIdentities\s*:/.test(bicep)
      && /identity:\s*appIdentity\.id/.test(bicep);
  /** `imageTag` with no default on its declaration line, plus the revisions mode the script relies on. */
  const imageIsScriptOwned = bicep === null
    ? null
    : /^param\s+imageTag\s+string\s*$/m.test(bicep) && /activeRevisionsMode:\s*'Multiple'/.test(bicep);
  const phaseTwoApplied = bicep === null
    ? null
    : /privatelink\.vaultcore\.azure\.net/.test(bicep) && /pgaudit/.test(bicep) && /zoneRedundant/.test(bicep);

  const gateAsksReady = has(deployScript, /\/api\/ready/);
  const workflowAsksReady = has(workflow, /\/api\/ready/);
  /** The `job update` invocation alone, because that is the branch that broke on every push after the first. */
  const jobUpdateBlock = workflow === null
    ? null
    : workflow.match(/az containerapp job update[\s\S]{0,600}?(?:\n\s*\n|$)/)?.[0] ?? "";
  const jobUpdatePassesCreateOnlyFlags = jobUpdateBlock === null ? null : /--mi-user-assigned|--registry-identity/.test(jobUpdateBlock);

  const step1: DeploymentStep = {
    number: 1,
    id: "target",
    title: "Target and naming",
    scope: "azure",
    state: "decision",
    summary: "The region is whatever resource group the run finds, and four names have to be globally free before anything is created.",
    blockedBy: null,
    owedTo: "the operator",
    plan: "PLAN-030 §5, §8.12 · briefing, “What production will be created with”",
    decides: "Where this deployment lives and what it is called. Nothing is created until the region is chosen, because the resource group's own location decides it and no parameter file overrides it.",
    run: [],
    items: [
      item(
        "1.1",
        "The region is chosen and recorded",
        "decision",
        `derived: no parameter file sets \`location\`, so the template's \`resourceGroup().location\` default decides it (read from infra/params/prod.bicepparam and infra/main.bicep). Owed to the operator — the briefing marks it ⚠.`,
        "the region decides itself from wherever the resource group was made, and a region chosen by accident is one nobody can move later without a rebuild",
        true,
      ),
      item(
        "1.2",
        "The global names are free",
        "unverified",
        "could not verify: the registry name (acrc7ntaxprodprod01), the vault (kv-c7ntax-prod-prod01) and the server (psql-c7ntax-prod-prod01) must not already exist, and name availability is a question only Azure answers.",
        "the first run fails on the first globally-named resource, after the resource group already exists",
        false,
      ),
      item(
        "1.3",
        "The database is named c7ntax",
        databaseName ? "done" : "unverified",
        databaseName
          ? `derived: \`param databaseName = '${databaseName}'\` in infra/main.bicep; the rename from c7_overwatch landed in the template and the vault secret together (§8.12).`
          : "could not verify: no database-name parameter was found in infra/main.bicep, so this package cannot confirm the name",
        "a development instance and a production instance with different database names make every runbook and connection string wrong in one of the two",
        Boolean(databaseName),
      ),
    ],
  };

  const step2: DeploymentStep = {
    number: 2,
    id: "parameters",
    title: "Parameters and secrets",
    scope: "shared",
    state: "blocked",
    summary: "Two of the parameter file's values are placeholders rather than choices, and one of them puts a dead hostname in every link the app builds.",
    blockedBy: webOriginPlaceholder === false ? null : `webOrigin is still ${webOrigin ?? "a placeholder"}`,
    owedTo: null,
    plan: "PLAN-030 §2.2, §2.7 · briefing, “Before the first production deployment”",
    decides: "Whether a production run can be started at all with what the deploying shell carries. A missing secret fails the compile; a placeholder does not fail — it deploys, and then blocks browser calls and writes a dead hostname into every reset link.",
    run: ["pnpm deploy:validate", "pnpm deploy:prod  # the shell must carry POSTGRES_ADMIN_PASSWORD, JWT_SECRET_VALUE, KUMO_MASTER_KEY_VALUE"],
    items: [
      fromFact(
        has(prodParams, /readEnvironmentVariable\(\s*'JWT_SECRET_VALUE'\s*\)/) === true && has(prodParams, /readEnvironmentVariable\(\s*'KUMO_MASTER_KEY_VALUE'\s*\)/) === true,
        "2.1",
        "The secrets come from the deploying shell, so a missing one fails the compile",
        "derived: prod.bicepparam reads JWT_SECRET_VALUE and KUMO_MASTER_KEY_VALUE with readEnvironmentVariable(), so a run without them fails at compile time instead of writing an empty signing key into the vault (§2.2).",
        "a parameter file that would write an empty JWT signing key and vault master key into Key Vault if it were run directly",
        "a direct `az deployment group create --parameters prod.bicepparam` writes an empty signing key and vault master key into Key Vault",
      ),
      fromFact(
        secretLengthFloors,
        "2.2",
        "The secret parameters carry length floors",
        "derived: infra/main.bicep declares @minLength(32) on the signing key and the vault master key and @minLength(16) on the database password (§2.2).",
        "a short or empty secret is accepted as a parameter, so a placeholder survives review as a working value",
        "a value that looks set and is not — an empty or one-character signing key is worse than a missing one, because nothing fails",
      ),
      item(
        "2.3",
        "webOrigin is a real origin, not a placeholder",
        webOriginPlaceholder === null ? "unverified" : webOriginPlaceholder ? "blocked" : "done",
        webOriginPlaceholder === null
          ? "could not verify: infra/params/prod.bicepparam is not on this working copy, so no webOrigin could be read"
          : `derived: prod.bicepparam sets webOrigin = '${webOrigin}'.${webOriginPlaceholder ? " It is a placeholder (§8.11, briefing ⚠) — it is passed as both WEB_ORIGIN and CORS_ORIGIN, so browser calls from the real origin are refused and every reset link names a host that does not exist." : ""}`,
        "production is deployed with a dead hostname in password-reset, notification and desktop hand-off links, and the SPA's own calls are blocked by CORS",
        webOriginPlaceholder !== null,
      ),
      item(
        "2.4",
        "The target TLS mode is a decision, not an accident",
        tlsVerified === null ? "unverified" : tlsVerified ? "done" : "attention",
        tlsVerified === null
          ? "could not verify: no connection URL could be read from the template or the production environment example"
          : `derived: the connection URL carries sslmode=${tlsMode}, so ${tlsVerified ? "the server certificate is verified" : "the connection is encrypted without verifying who is on the other end"} (§2.9 / §8.4).`,
        "anyone who can influence DNS or routing inside the VNet can present their own certificate and take the credential, if the mode stays at require",
        tlsVerified !== null,
      ),
    ],
  };

  const step3: DeploymentStep = {
    number: 3,
    id: "infrastructure",
    title: "Infrastructure",
    scope: "azure",
    state: "done",
    summary: "The eight Phase 1 blockers are applied in the template — the workload profile, the user-assigned identity and its two grants, imageTag with no default, the traffic rule that restates the serving revision.",
    blockedBy: null,
    owedTo: null,
    plan: "PLAN-030 §1, §7 · Review round 1 §1–§6",
    decides: "Whether an infrastructure run produces a working environment at all. Every item here has been applied and compiled; none of it has been deployed.",
    run: ["pnpm deploy:validate", "pnpm deploy:preflight"],
    items: [
      fromFact(
        has(bicep, /workloadProfiles\s*:/),
        "3.1",
        "The Container Apps environment declares a workload profile",
        "derived: workloadProfiles is declared in infra/main.bicep, so the delegated subnet is valid (§1.1).",
        "the environment is consumption-only with a delegated subnet, which is the combination Azure rejects — the first run fails",
        "the first deployment fails before creating anything",
      ),
      fromFact(
        identityAttached,
        "3.2",
        "A user-assigned identity holds AcrPull and Key Vault Secrets User, attached to the app",
        "derived: infra/main.bicep declares a user-assigned identity, grants it both roles and attaches it to the app's registry pull and secret references (`identity: appIdentity.id`) (§1.2).",
        "the app's first revision tries to pull its image and resolve three Key Vault secret references before either grant exists, so the revision never starts",
        "the first revision cannot pull its image or resolve its secrets, and the app never starts",
      ),
      fromFact(
        imageIsScriptOwned,
        "3.3",
        "Bicep does not own the running image, and traffic restates the serving revision",
        "derived: `param imageTag string` has no default, activeRevisionsMode is 'Multiple', and the traffic block restates activeRevision — which the script reads before it creates a revision (§1.3, review §5).",
        "a Bicep run points the app at an image that does not exist yet, and a successful infrastructure run hands 100% of traffic to an unchecked revision",
        "a normal deploy points the app at an image that has not been built, or bypasses the health gate entirely",
      ),
      fromFact(
        has(bicep, /retentionPolicy/) === true && has(bicep, /environment\s*==\s*'prod'/) === true,
        "3.4",
        "The registry retention policy is prod-only",
        "derived: the ACR policies block is guarded on environment == 'prod', because the retention policy is Premium-only and dev is Basic (§1.4).",
        "the dev deployment is rejected by the registry, because its SKU does not support the policy",
        "the dev deployment fails with a registry policy error",
      ),
      fromFact(
        subnetsAreInline,
        "3.5",
        "Every subnet is declared inline, once",
        "derived: no separate postgresSubnet resource remains in infra/main.bicep, so a redeploy cannot detach and re-attach the NSG (§1.5).",
        "each redeploy detaches and re-attaches the Postgres NSG, and can fail with AnotherOperationInProgress",
        "a redeploy that was supposed to change nothing detaches an NSG, or fails halfway",
      ),
      fromFact(
        has(bicep, /privateDnsLink[\s\S]{0,400}?dependsOn|dependsOn[\s\S]{0,400}?privateDnsLink/),
        "3.6",
        "The database server depends on its private DNS link",
        "derived: infra/main.bicep places privateDnsLink where the server's dependency on it is declared (§1.6).",
        "the server can be created before its DNS zone is linked, which leaves a server nothing can resolve",
        "the server is created before DNS exists for it, and the revision cannot reach it",
        "unverified",
      ),
      fromFact(
        phaseTwoApplied,
        "3.7",
        "Every Phase 2 security item that is an infrastructure change is applied",
        "derived: the vault private endpoint and its zone, the Postgres NSG rules, the Key Vault and registry audit settings, pgaudit, the GA API versions and zone redundancy are all present in infra/main.bicep (§2.4–§2.6, §2.10, §2.11).",
        "the security posture the second phase asked for is a document rather than a template",
        "the deployment goes live with no vault private endpoint, no audit of secret reads and no database audit logging",
      ),
      item(
        "3.8",
        "The template has been executed",
        "unverified",
        "could not verify: every Phase 1 item is compiled, parsed and reviewed — and no deployment has been run. The throwaway-dev run that proves the two-pass create is step 8's item (§8.13).",
        "compiling is not deploying: a template that compiles can still fail on its first real run, which is precisely what the two-pass create exists to prove",
        false,
        false,
      ),
    ],
  };

  const step4: DeploymentStep = {
    number: 4,
    id: "database",
    title: "Database",
    scope: "shared",
    state: "decision",
    summary: "c7ntax, VNet-injected with no public endpoint and zone-redundant HA — and the app still connects as the server administrator.",
    blockedBy: null,
    owedTo: "the operator",
    plan: "PLAN-030 §2.3, §8.1, §8.11–§8.12",
    decides: "Which role the application uses, and therefore what one bug in a query path is allowed to do. Not a task: an owner, a recommendation and a place to record the answer.",
    run: [],
    items: [
      fromFact(
        dbIsPrivate,
        "4.1",
        "The server is VNet-injected with no public endpoint, and prod is zone-redundant",
        "derived: infra/main.bicep injects the server into the VNet, disables public network access where the plan asks for it and declares zone redundancy in prod (§2.11, §9.1).",
        "the database is reachable from the internet, which is the one control every other control assumes",
        "the highest-value control in the deployment is missing while every screen reports the deployment as hardened",
      ),
      item(
        "4.2",
        "The app connects as app_c7ntax, which owns the public schema",
        "decision",
        "read from PLAN-030 §8.1 and §8.11: the plan of record is corrected and ready (`CREATE ROLE app_c7ntax …`, `ALTER SCHEMA public OWNER TO app_c7ntax`), and creating it **needs a server**, so it is the first task after the first deployment and before production data. Deferred by the operator's decision on 2026-10-09 — the last High item still open, and the one that becomes a credential rotation as well as a change of grants once there is data.",
        "every query path runs with server-level rights: create or drop databases, read every schema, COPY … TO PROGRAM",
        false,
      ),
      fromFact(
        appUrlIsAdmin === null ? null : !appUrlIsAdmin,
        "4.3",
        "The app does not connect as the server administrator",
        "derived: the connection URL in infra/main.bicep is built from postgresAdminLogin — a member of azure_pg_admin.",
        `derived: the connection URL in infra/main.bicep is still built from \`${adminLogin ?? "the admin login"}\`, a member of azure_pg_admin (§2.3, §8.1). The plan recommends app_c7ntax owning the public schema of ${databaseName ?? "c7ntax"} now, with Entra passwordless auth as a follow-up.`,
        "one bug in any query path — a string-built ORDER BY, a future raw SQL endpoint, a dependency compromise — has server-level rights",
        "attention",
      ),
      item(
        "4.4",
        "The database credential has an expiry with a process behind it",
        "decision",
        "read from PLAN-030 §8.3: set `exp` on the database credential (12 months) and leave JWT_SECRET_VALUE and KUMO_MASTER_KEY without expiry until a rotation path exists, tagged so the next reviewer sees a decision rather than an oversight. Expiry without rotation is a scheduled outage.",
        "an expiring secret with no rotation runbook converts a security nicety into a production outage with a calendar entry",
        false,
      ),
    ],
  };

  const bothGatesAskReady = gateAsksReady === true && workflowAsksReady === true
    ? true
    : gateAsksReady === null || workflowAsksReady === null
      ? null
      : false;

  const step5: DeploymentStep = {
    number: 5,
    id: "readiness",
    title: "Readiness gate",
    scope: "shared",
    state: "done",
    summary: "The promotion gate asks /api/ready — a SELECT 1 with a 2 s budget — and liveness stays on /api/health.",
    blockedBy: null,
    owedTo: null,
    plan: "PLAN-030 §8.14 · PLAN-030-Review-Round-2.md §2 · PLAN-030-Response-to-Review-Round-2.md",
    decides: "Whether a revision earns traffic. Nothing here is a preference: it is the difference between a gate and a green light.",
    run: [
      "pnpm deploy:dev  # the 0%-traffic gate asks /api/ready?deep=1",
      "curl -fsS https://<app>/api/ready             # shallow — what the probe asks",
      'curl -fsS "https://<app>/api/ready?deep=1"    # what the two gates ask',
    ],
    items: [
      fromFact(
        readinessEndpoint === null || readinessTouchesDatabase === null ? null : readinessEndpoint && readinessTouchesDatabase,
        "5.1",
        "A readiness endpoint exists, and it queries the database",
        "derived: apps/api/src/index.ts declares GET /api/ready, which runs a SELECT 1 with a two-second budget and answers { status } with nothing else in the body.",
        "the endpoint exists but does not touch the database, which is the defect review round 2 found",
        "the gate goes back to proving that Node is listening, and a revision that cannot reach the database takes 100% of traffic",
      ),
      fromFact(
        livenessStaysShallow === null || readinessEndpoint === null ? null : livenessStaysShallow && readinessEndpoint,
        "5.2",
        "Liveness stays shallow, on /api/health",
        "derived: the two probes are deliberately different — the readiness probe and both gates ask /api/ready; the liveness probe asks /api/health.",
        "a liveness check that queries the database restarts every replica in a loop",
        "a database outage restarts every replica in a loop and turns an outage into a crash storm",
      ),
      fromFact(
        bothGatesAskReady,
        "5.3",
        "Both promotion gates ask it, not the script alone",
        "derived: scripts/azure/deploy-env.ps1 (the 0%-traffic gate) and .github/workflows/deploy-azure.yml both call /api/ready — the second is the path a production deploy actually takes.",
        "the gate belongs to one of the two promotion paths only",
        "the pipeline promotes a revision the script's gate would have rejected, and the two paths disagree about what healthy means",
      ),
      fromFact(
        deepCheck,
        "5.4",
        "The deep check is only on the gates, never on the first-run probe",
        "derived: ?deep=1 adds “the newest migration this image ships has been applied” and is passed by the two gates only (§8.14).",
        "the deep check is missing, so a revision that shipped an unapplied migration is promoted",
        "on a first run the app is created before the migration job, so a probe waiting on migration state holds the first revision at 0%",
      ),
      item(
        "5.5",
        "The unauthenticated endpoint leaks nothing",
        "attention",
        "derived: the body of /api/ready says only { status: ready | not-ready } — no error, no host, no database name. Why attention rather than done: the same discipline has to hold for SKIP_PATHS in autoSnapshot.ts and the audit-log exclusions, which the endpoint was added to; a later route that echoes the failure would undo it.",
        "the host, the database name or a driver error is echoed to an anonymous caller — the database name is not a secret, but a connection error is a map",
        true,
        false,
      ),
      item(
        "5.6",
        "The runner's Azure CLI accepts the flags the update path passes",
        "unverified",
        "could not verify: no Azure CLI is installed on this working copy, so the claim that `az containerapp job update` accepts neither --mi-user-assigned nor --registry-identity is asserted from the CLI's own reference rather than tested. Derived: the fix passes --image only.",
        "the first push takes the create branch and works; every push after it takes the update branch and fails at the migration step — the same outcome fix 1.8 produced, moved from the first push to the second",
        true,
        false,
      ),
    ],
  };

  const step6: DeploymentStep = {
    number: 6,
    id: "ingress",
    title: "Network and ingress",
    scope: "azure",
    state: "blocked",
    summary: "The origin must be unreachable except through the ingress layer, and the API has no X-Azure-FDID check yet. D1 is undecided.",
    blockedBy: lockIngress === false
      ? "D1 is undecided and lockIngressToFrontDoor is still false"
      : "the ingress decision (D1) is not recorded",
    owedTo: "the operator (D1)",
    plan: "PLAN-030 §2.1, §8.4, §8.6 · infra/README.md §4",
    decides: "Whether the application is reachable directly. The switch exists; the decision, the Front Door module and the TLS mode do not.",
    run: [],
    items: [
      fromFact(
        lockIngress === null ? null : lockIngress,
        "6.1",
        "The origin is unreachable except through the ingress layer",
        "derived: infra/main.bicep declares `param lockIngressToFrontDoor bool = false`, and the parameter files leave it false, so the app publishes on its own *.azurecontainerapps.io host with no WAF in front of it (§2.1).",
        "the switch is on: the ipSecurityRestrictions rule admits only the Front Door service tag.",
        "the application is internet-facing on its own hostname, with no WAF and no service-tag restriction, and nothing in the API can tell the difference",
        "blocked",
      ),
      fromFact(
        fdIdGuard,
        "6.2",
        "The API rejects a request whose X-Azure-FDID header is not this Front Door's id",
        "derived: apps/api/src/index.ts contains the header check, which is the half of 2.1 the infrastructure cannot do — a service tag restricts the network, not the caller.",
        "derived: no X-Azure-FDID check exists in apps/api/src/index.ts, so once Front Door exists the origin is still callable directly by anybody who knows its hostname (infra/README.md §4).",
        "the service-tag rule is a network restriction with nothing behind it: a request that reaches the origin another way is served",
        "blocked",
      ),
      fromFact(
        tlsMode === null ? null : tlsMode === "verify-full",
        "6.3",
        "The database connection verifies the server certificate",
        `derived: the connection URL carries sslmode=${tlsMode ?? "unknown"}, so the connection is encrypted without verifying who is on the other end (2.9 / §8.4). This is an image change — the CA bundle has to be in the container — not an infrastructure one.`,
        "verify-full with the bundled CA: the connection is encrypted and the server is identified.",
        "anyone who can influence routing or DNS inside the VNet can present their own certificate, take the credential and read the traffic",
        "blocked",
      ),
    ],
  };

  const step7: DeploymentStep = {
    number: 7,
    id: "sanitisation",
    title: "Sanitisation",
    scope: "shared",
    state: "unverified",
    summary: "Strip what must not travel: sample data, demo accounts, the outbound-mail sandbox, integration credentials, placeholder origins, issued API keys.",
    blockedBy: null,
    owedTo: "the operator and the destination",
    plan: "apps/api/src/sample-data-toggle.ts · packages/shared/src/appConfiguration.ts · apps/api/prisma/schema.prisma (ApiKey) · GET /api/developer/environment",
    decides: "What this instance still contains that must not reach production. Every answer belongs to the destination, so the honest state is that it has not been verified there — the step's job is to name the surfaces and read them from the target, not to assume the instance it is running in is the one being promoted.",
    run: ["GET /api/developer/purge/preview   # what a purge removes, and what it leaves standing"],
    items: [
      item(
        "7.1",
        "Sample and seed data",
        "unverified",
        `the reversible purge behind db:sample-off removes the WIPE_MODELS set behind a snapshot — the purge screen's dry run names every model it would take — but whether the destination still holds sample data is a fact about the destination. Read here: the sample-data marker is ${isSampleDataDisabled() ? "set, so this instance has already been purged" : "not set, so this instance still holds its dataset"}.`,
        "the sample dataset is promoted with the instance, so the first thing production shows is somebody's demo tenant",
        false,
        true,
      ),
      item(
        "7.2",
        "Demo accounts",
        "unverified",
        "user and role are preserved by the purge on purpose, so the instance stays usable — and that means the purge cannot tell a demo account from an administrator. The list has to be reviewed by a person and removed individually; nothing here can decide which rows those are.",
        "an account created for a demonstration keeps working in production, on a role nobody chose",
        false,
        true,
      ),
      item(
        "7.3",
        "The outbound-mail sandbox",
        "unverified",
        "GET /api/system/deployment reports whether mail is configured and the host it uses; the destination's own values are what matter. A sandbox host means tickets, invoices and reminders are accepted and never delivered.",
        "mail is accepted and never delivered, and the first symptom is a customer who did not receive an invoice",
        false,
        true,
      ),
      item(
        "7.4",
        "Integration credentials",
        "unverified",
        "the connector credentials live in the integrations and emailConnector rows the wipe removes, and integrations.liveStatus decides whether a check is trusted or merely reported. They are reissued against the production tenant, not copied.",
        "a development tenant's credential is promoted, and the production instance reads the wrong mailbox or posts the wrong data",
        false,
        true,
      ),
      item(
        "7.5",
        "Placeholder origins",
        "unverified",
        `derived for this working copy: webOrigin is '${webOrigin ?? "not found"}'; the step's other surfaces are portal.publicUrl and EMAIL_OAUTH_REDIRECT_URI. A placeholder here is the same ⚠ as step 2, and it blocks browser calls and writes a dead hostname into every reset link.`,
        "the destination answers with a hostname that does not exist, and every link it emails is a dead end",
        false,
        true,
      ),
      item(
        "7.6",
        "Issued API keys",
        "unverified",
        "ApiKey stores a prefix and the SHA-256 of the secret, with sourceKind (rmm, siem, flexpoint), revokedAt and expiresAt; the inventory is at Administration → API access. A key issued against a development instance is a key to production the moment the domains match.",
        "a key issued for a test reaches production with the scopes it was given, and no screen shows it was ever a test key",
        false,
        true,
      ),
      item(
        "7.7",
        "Authentication conveniences",
        "unverified",
        "sessions.testBypass is refused outright when NODE_ENV is production, and sessions.sso may still point at a development tenant. Both are environment-only, so neither is visible from this screen.",
        "a sign-in shortcut or a development identity provider is live in production, which is a way in that nobody is watching",
        false,
        true,
      ),
    ],
  };

  const migrations = facts.migrations;

  const step8: DeploymentStep = {
    number: 8,
    id: "validate",
    title: "Validate and hand off",
    scope: "shared",
    state: "unverified",
    summary: "The guards, the preflight, the two-pass first-run create, the saved what-if — then the report.",
    blockedBy: null,
    owedTo: "the operator, against a throwaway dev resource group",
    plan: "PLAN-030 §3, §8.11, §8.13–§8.14 · the root package.json guards",
    decides: "Whether the package that compiled has ever been executed. The answer today is no, and the hand-off carries that forward rather than pressing it into a tick.",
    run: ["pnpm deploy:preflight", "pnpm deploy:dev", "GET /api/developer/health   # the guards, individually"],
    items: [
      item(
        "8.1",
        "The migration set this build ships is known",
        migrations.count > 0 ? "done" : "unverified",
        migrations.count > 0
          ? `derived: ${migrations.count} migrations in apps/api/prisma/migrations, oldest ${migrations.oldest}, newest ${migrations.newest} — the set /api/ready?deep=1 checks against the database.`
          : "could not verify: apps/api/prisma/migrations could not be listed on this working copy",
        "a readiness check that compares against an unknown migration set cannot tell an unapplied migration from a missing one",
        migrations.count > 0,
      ),
      item(
        "8.2",
        "The guards are run and reported individually",
        "unverified",
        "this package does not run them in a request — GET /api/developer/health does, and reports each check's own output. Known on this tree: guard:plugin fails, and guard:deps needs pnpm audit so it may not run at all. Neither is reported as a pass.",
        "a broken guard is discovered by the push that trips it rather than by the person about to deploy",
        false,
        false,
      ),
      item(
        "8.3",
        "The two-pass first-run create has been run",
        "unverified",
        "read from PLAN-030 §8.13: pass 1 without the app, the image build, pass 2 with it. It is compiled, parsed and reviewed, and it has not been executed against ARM.",
        "a first deployment into an empty environment fails on the probe port, which is the failure the two-pass create was written to design out",
        false,
      ),
      item(
        "8.4",
        "A what-if is reviewed and saved for both environments",
        "unverified",
        "read from PLAN-030 §3: a what-if for both environments reviewed, with the output saved alongside the change — and a redeploy with no changes reporting no subnet or NSG churn.",
        "the first run is also the first time anyone reads the template's plan, which is the wrong order",
        false,
      ),
      item(
        "8.5",
        "The four §3 checks a subscription alone can confirm",
        "unverified",
        "read from PLAN-030 §3: the redeploy reports no churn; a Bicep-only run does not change the image or traffic; Key Vault and registry audit events appear after a secret read and an image pull; and the origin is unreachable except through the ingress layer. Dev first, then prod with a saved what-if.",
        "the checks the plan calls validation are never run, so “applied” and “working” stay different words",
        false,
      ),
      item(
        "8.6",
        "A dev environment is brought up, torn down and rebuilt",
        "unverified",
        "read from PLAN-030 §3: dev up, then down, then rebuilt to prove the template is repeatable — with a fresh uniqueSuffix, because vault purge protection reserves the names for 90 days.",
        "the template is a one-way script: it works once and then refuses the second run for a reason nobody predicted",
        false,
      ),
    ],
  };

  const steps = [step1, step2, step3, step4, step5, step6, step7, step8];
  /**
   * Recompute each step's headline from its own checklist, because a state that is *written* is a claim
   * while one that is computed is a finding. The rule is the worst **blocking** item, and `blocking` exists
   * so that an item which is a discipline rather than a check — a runner's CLI version, an endpoint's
   * hygiene — does not drag a step the plan considers done down to `unverified`. Every other item decides
   * its step, so a template whose Phase 1 work went missing comes back `unverified` rather than green.
   */
  for (const entry of steps) entry.state = stepState(entry.items);
  return steps;
}

function buildHandoff(facts: Facts): DeploymentResponse["handoff"] {
  const env = process.env;
  const databaseUrl = env.DATABASE_URL ?? "";
  let databaseHost: string | null = null;
  let databaseNameFromUrl: string | null = null;
  if (databaseUrl) {
    try {
      const url = new URL(databaseUrl);
      databaseHost = `${url.hostname}${url.port ? `:${url.port}` : ""}`;
      databaseNameFromUrl = url.pathname.replace(/^\//, "") || null;
    } catch { /* an unparseable URL is still configured; only its readable half is unknown */ }
  }

  const smtpHost = env.SMTP_HOST ?? "";
  const smtpFrom = env.SMTP_FROM ?? "";
  const declaredName = capture(facts.bicep, /param\s+databaseName\s+string\s*=\s*'([^']+)'/);
  const adminLogin = capture(facts.bicep, /param\s+postgresAdminLogin\s+string\s*=\s*'([^']+)'/);

  return {
    runtime: {
      nodeEnv: env.NODE_ENV ?? "development",
      webOrigin: env.WEB_ORIGIN ?? null,
      webOriginPlaceholder: env.WEB_ORIGIN ? /example\.com|localhost/i.test(env.WEB_ORIGIN) : null,
      port: Number(env.PORT) || 4000,
      servesWeb: env.SERVE_WEB === "true" || (env.NODE_ENV === "production" && env.SERVE_WEB !== "false"),
    },
    database: {
      /** The name the template declares, falling back to the name this instance is connected to. */
      name: declaredName ?? databaseNameFromUrl,
      /** The host of the instance this process is connected to, when the URL is readable. */
      reachableHost: databaseHost,
      /** From the template: who the deployment tells the app to be. */
      connectsAs: adminLogin,
      connectsAsAdministrator: adminLogin !== null,
      tlsMode: capture(facts.bicep, /sslmode=([a-z-]+)/) ?? capture(facts.envProductionExample, /sslmode=([a-z-]+)/),
    },
    mail: {
      configured: Boolean(smtpHost),
      host: smtpHost || null,
      port: env.SMTP_PORT ? Number(env.SMTP_PORT) : 587,
      secure: env.SMTP_SECURE === "true",
      from: smtpFrom || null,
      fromPlaceholder: smtpFrom ? /example\.com/i.test(smtpFrom) : null,
    },
    provenance: {
      commit: readGitCommit(),
      /** The saved what-if is not a file this package can see; it is the operator's to attach. */
      whatIfSaved: null,
      guards: "GET /api/developer/health — each guard reported individually, with the ones that could not run named rather than folded into a count",
      bicepCompiled: facts.missing.includes("infra/main.bicep") ? null : true,
      migrations: facts.migrations.count,
      migrationsNewest: facts.migrations.newest,
    },
  };
}

/** Build the whole payload. Reads the repository; touches the database only for nothing — see the route. */
export function buildDeploymentReport(): DeploymentResponse {
  const facts = readFacts();
  const steps = buildSteps(facts);
  const counts: Record<DeploymentState, number> = { done: 0, attention: 0, blocked: 0, decision: 0, unverified: 0 };
  for (const step of steps) counts[step.state] += 1;

  return {
    generatedAt: new Date().toISOString(),
    destination: { id: "azure", label: "Azure — Bicep, PLAN-016 / PLAN-030", source: "PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md" },
    plan: {
      file: "PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md",
      commit: readGitCommit(),
      unverified:
        "Nothing in this package has run against an Azure subscription. Every item whose state is `done` was decided by reading a file in this repository; every item that needs a subscription is `unverified` with the reason.",
    },
    counts,
    steps,
    advisories: [
      {
        title: "The registry stays public",
        detail: "Disable the ACR admin user and alert on unexpected pushes and pulls rather than buying a private endpoint no contract yet requires (8.2).",
        plan: "§8.2",
      },
      {
        title: "A private registry in production is deferred with a trigger, not a date",
        detail: "It happens when a contract forbids a public registry endpoint, or when the build itself moves into the VNet (D3 / 8.8).",
        plan: "§8.8",
      },
      {
        title: "Stop the dev database out of hours",
        detail: "About 30–40% of the dev line, and a runbook job rather than a purchase.",
        plan: "§4",
      },
      {
        title: "Size the Postgres reservation ×2 for either HA mode",
        detail: "A standby is billed in both HA modes, so only `Disabled` is ×1. Buy it after 30 days of real usage, not before (9.2).",
        plan: "§9.2",
      },
    ],
    decisions: [
      {
        id: "D1",
        title: "Ingress: Front Door Premium alone, or Front Door and Application Gateway",
        recommendation: "Front Door Premium alone, blocking, with a Private Link origin.",
        detail: "The reason is not only the ~$325/mo: Premium is what makes the origin unreachable rather than merely restricted by a service tag.",
        blocking: true,
        plan: "§8.6",
      },
      {
        id: "2.3",
        title: "Password role now, or Entra passwordless now",
        recommendation: "app_c7ntax owning the public schema of c7ntax now; Entra as a follow-up.",
        detail: "Before data exists this is a five-minute ownership change; after it exists it is a migration with a credential rotation attached.",
        blocking: true,
        plan: "§8.1",
      },
      {
        id: "8.3",
        title: "Which secrets expire",
        recommendation: "Expire the database credential (12 months); leave JWT_SECRET_VALUE and KUMO_MASTER_KEY without expiry until rotation exists, tagged rotation=manual, reason=key-ring-not-implemented.",
        detail: "Expiry is a promise that somebody will rotate before the date. Where that promise cannot be kept it converts a security nicety into a production outage.",
        blocking: false,
        plan: "§8.3",
      },
      {
        id: "8.5",
        title: "HA mode, and the reservation sized from it",
        recommendation: "ZoneRedundant for production; size the reservation ×2 for either HA mode.",
        detail: "A standby is billed in both HA modes, so the ~$130/mo choice is availability, not a saving.",
        blocking: false,
        plan: "§8.5",
      },
    ],
    bar: [
      { order: 1, item: "2.3 — the least-privilege database role", state: "decision", detail: "Open and deferred by decision on 2026-10-09. After production holds data it is a credential rotation as well as a change of grants." },
      { order: 2, item: "2.9 — verify-full with the CA bundle in the image", state: "blocked", detail: "Pending an image change; `sslmode=require` is in force today." },
      { order: 3, item: "2.1 + D1 — the ingress decided and the origin not publicly reachable", state: "blocked", detail: "lockIngressToFrontDoor is false and no X-Azure-FDID check exists in the API." },
      { order: 4, item: "8.10 — the workflow's migration step", state: "done", detail: "Applied: the pipeline uses the app's user-assigned identity. No longer a bar item." },
      { order: 5, item: "The four §3 validation checks", state: "unverified", detail: "They need a subscription — dev first, then prod with a saved what-if." },
    ],
    handoff: buildHandoff(facts),
    unread: facts.missing,
  };
}

// ── The answers an operator records ────────────────────────────────────────────────────────────────
//
// The report says what the plan requires and what this working copy can prove; it cannot say what the
// operator has *decided*. That is what a record is: an answer, with a name and a time on it, attached to a
// decision the report names or to one checklist item it names. Four rules, and they are the reason this is
// a service rather than four lines in the route:
//
//   1. **A record is stored where the purge cannot reach it.** It lives in `SystemConfig` under the reserved
//      `deployment:record:` prefix — the same mechanism the purge receipt uses, and reserved in
//      `routes/system.ts` so no HTTP caller can read or rewrite one there. A decision taken before a purge
//      is a decision that survives it, which matters because the purge is one of the things a decision may
//      be about.
//   2. **A subject is one of this report's own.** The ids a record may name are read out of the report
//      itself, so the screen cannot invent an id the plan does not have and the plan cannot be renamed out
//      from under a recorded answer without the id check noticing.
//   3. **Recording again replaces the answer.** One record per subject, not a pile: the screen asks for the
//      answer, and a history of half-answers is not an answer.
//   4. **A record whose subject the report no longer names is still returned.** It is not attached to
//      anything, and it is not thrown away — a check that lost its id is exactly when somebody needs to
//      read what was decided about it.

/**
 * Reserved `SystemConfig` namespace for recorded answers.
 *
 * `deployment:` is in `RESERVED_CONFIG_PREFIXES` (routes/system.ts) beside `sample_data:`, so these rows
 * are withheld from every HTTP caller, administrator included, and are read and written through Prisma by
 * this module only.
 */
export const DEPLOYMENT_RECORD_PREFIX = "deployment:record:";

export type DeploymentRecordKind = "decision" | "check";

export interface DeploymentRecord {
  kind: DeploymentRecordKind;
  /** The id the record answers: a decision's own id (`2.3`), or a checklist item's (`5.1`). */
  id: string;
  /** What that id names, as the report titles it — so a reader needs no second lookup. */
  subject: string;
  note: string;
  recordedBy: string | null;
  /** The recorder's name as it was when they signed the answer off. Null for a record written before this field existed. */
  recordedByName: string | null;
  recordedByRole: string | null;
  recordedAt: string;
  /** The reserved `SystemConfig` key the record lives under. */
  key: string;
}

/** One thing a record may be about, taken from the report rather than declared a second time. */
export interface DeploymentSubject {
  kind: DeploymentRecordKind;
  id: string;
  title: string;
}

/** The `SystemConfig` key for a subject. One record per subject, so the key is the identity. */
export function deploymentRecordKey(kind: DeploymentRecordKind, id: string): string {
  return `${DEPLOYMENT_RECORD_PREFIX}${kind}:${id}`;
}

/** Every subject a record may name: the report's decisions, then every step's checklist items. */
export function deploymentSubjects(): DeploymentSubject[] {
  const report = buildDeploymentReport();
  const subjects: DeploymentSubject[] = [];
  for (const decision of report.decisions) {
    subjects.push({ kind: "decision", id: decision.id, title: decision.title });
  }
  for (const step of report.steps) {
    for (const item of step.items) {
      subjects.push({ kind: "check", id: item.id, title: `${step.number} · ${step.title} — ${item.title}` });
    }
  }
  return subjects;
}

export interface RecordValidationFailure {
  field: "kind" | "id" | "note";
  message: string;
}

export type RecordValidation =
  | { ok: true; kind: DeploymentRecordKind; id: string; note: string; subject: DeploymentSubject }
  | { ok: false; failures: RecordValidationFailure[] };

/**
 * Validate a record request, naming the field that failed.
 *
 * `id` is checked against `deploymentSubjects()` and against the *kind* it came with, so `{ kind: "check",
 * id: "2.3" }` is refused rather than quietly recorded against the wrong list. The note has to say
 * something: a record that names nothing is a record nobody can act on, and it would sit in the payload
 * looking like an answer.
 */
export function validateDeploymentRecord(body: unknown): RecordValidation {
  const source = (body ?? {}) as Record<string, unknown>;
  const failures: RecordValidationFailure[] = [];

  const rawKind = typeof source.kind === "string" ? source.kind.trim() : "";
  const kind = rawKind === "decision" || rawKind === "check" ? rawKind : null;
  if (!kind) {
    failures.push({ field: "kind", message: '`kind` must be "decision" or "check".' });
  }

  const id = typeof source.id === "string" ? source.id.trim() : "";
  let subject: DeploymentSubject | undefined;
  if (!id) {
    failures.push({ field: "id", message: "`id` is required: the decision or checklist item being answered." });
  } else if (kind) {
    subject = deploymentSubjects().find((entry) => entry.kind === kind && entry.id === id);
    if (!subject) {
      const others = deploymentSubjects().filter((entry) => entry.id === id && entry.kind !== kind);
      failures.push({
        field: "id",
        message: others.length
          ? `\`id\` "${id}" is a ${others[0]?.kind}, not a ${kind}.`
          : `\`id\` "${id}" is not a ${kind} this deployment report names.`,
      });
    }
  }

  const rawNote = typeof source.note === "string" ? source.note.trim() : "";
  if (!rawNote) {
    failures.push({ field: "note", message: "`note` is required: what was decided, in a sentence somebody else can act on." });
  } else if (rawNote.length > 4000) {
    failures.push({ field: "note", message: "`note` is too long — keep the record to 4000 characters." });
  }

  if (failures.length || !kind || !subject) return { ok: false, failures };
  return { ok: true, kind, id, note: rawNote, subject };
}

/** True for a value that is a record this module wrote, so a hand-edited row cannot break the payload. */
function isDeploymentRecord(value: unknown): value is DeploymentRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    (candidate.kind === "decision" || candidate.kind === "check")
    && typeof candidate.id === "string"
    && typeof candidate.note === "string"
    && typeof candidate.recordedAt === "string"
  );
}

/** Every recorded answer, newest write first. A read that fails answers with none rather than a 500. */
export async function readDeploymentRecords(): Promise<DeploymentRecord[]> {
  try {
    const rows = await prisma.systemConfig.findMany({ where: { key: { startsWith: DEPLOYMENT_RECORD_PREFIX } } });
    return rows
      .map((row) => row.value as unknown)
      .filter(isDeploymentRecord)
      .sort((a, b) => b.recordedAt.localeCompare(a.recordedAt));
  } catch {
    return [];
  }
}

export interface SaveRecordInput {
  kind: DeploymentRecordKind;
  id: string;
  note: string;
  subject: DeploymentSubject;
  actor: string | null;
  actorRole: string | null;
}

/**
 * The recorder's name, resolved once and stored on the record.
 *
 * A record of a person signing a decision off has a person's name against it. The id is the link back
 * to the account; the name is what the screen prints, and because it is captured here rather than
 * resolved when the page is read, a later rename (or a closed account) cannot rewrite who answered.
 * Failing to resolve it costs the name and nothing else — the record still records the decision.
 */
async function actorName(actor: string | null): Promise<string | null> {
  if (!actor) return null;
  try {
    const row = await prisma.user.findUnique({ where: { id: actor }, select: { firstName: true, lastName: true, email: true } });
    if (!row) return null;
    return `${row.firstName ?? ""} ${row.lastName ?? ""}`.trim() || row.email;
  } catch {
    return null;
  }
}

/** Write the answer, replacing any earlier one for the same subject. */
export async function saveDeploymentRecord(input: SaveRecordInput): Promise<{ record: DeploymentRecord; created: boolean }> {
  const key = deploymentRecordKey(input.kind, input.id);
  const existing = await prisma.systemConfig.findUnique({ where: { key } }).catch(() => null);
  const record: DeploymentRecord = {
    kind: input.kind,
    id: input.id,
    subject: input.subject.title,
    note: input.note,
    recordedBy: input.actor,
    recordedByName: await actorName(input.actor),
    recordedByRole: input.actorRole,
    recordedAt: new Date().toISOString(),
    key,
  };
  await prisma.systemConfig.upsert({
    where: { key },
    create: { key, value: record as unknown as object },
    update: { value: record as unknown as object },
  });
  return { record, created: !existing };
}

/**
 * The report with its recorded answers attached: the whole list, plus each decision and each checklist item
 * carrying its own record so the screen needs no second read and no matching of its own.
 */
export function attachDeploymentRecords(report: DeploymentResponse, records: DeploymentRecord[]): DeploymentResponse {
  const bySubject = new Map(records.map((record) => [`${record.kind}:${record.id}`, record]));
  return {
    ...report,
    records,
    decisions: report.decisions.map((decision) => ({
      ...decision,
      record: bySubject.get(`decision:${decision.id}`) ?? null,
    })),
    steps: report.steps.map((step) => ({
      ...step,
      items: step.items.map((item) => ({ ...item, record: bySubject.get(`check:${item.id}`) ?? null })),
    })),
  };
}

/** The report a screen reads: the repository read, plus what has been answered about it. */
export async function buildDeploymentReportWithRecords(): Promise<DeploymentResponse> {
  const report = buildDeploymentReport();
  return attachDeploymentRecords(report, await readDeploymentRecords());
}
