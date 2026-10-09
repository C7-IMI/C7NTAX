/**
 * The contract behind Developer → Prepare for Live Deployment, and the vocabulary that screen speaks.
 *
 * The screen exists because PLAN-030's own second review found a gate that could not see the database
 * (`/api/health` proved only that Node was listening, so a revision with a wrong `DATABASE_URL` took
 * 100% of traffic). A wizard that greened a check it never ran would be repeating that defect in a
 * nicer font — which is why this file has three rules the rest of the page is built on:
 *
 * 1. **There are five states, not two.** `done`, `attention`, `blocked`, `decision` and `unverified`.
 *    The last two exist because 2.3 is *deferred by decision* rather than forgotten, and because
 *    nothing in the deployment package has ever reached ARM. `unverified` is a distinct state in the
 *    vocabulary and in the legend — never a shade of green.
 * 2. **An unknown state is never `done`.** {@link normaliseState} answers `unverified` for anything it
 *    does not recognise, including a missing field, so a response this screen cannot read degrades
 *    towards "we do not know" rather than towards a pass.
 * 3. **A successful read is rendered exactly as it answered.** The eight steps below are a *fallback for
 *    a failed read* — {@link emptyModel} — and nothing else. When `GET /api/developer/deployment`
 *    answers, every step, item, decision, bar entry and report row on the page comes from that payload:
 *    the skeleton is never merged into it. (An earlier version merged the two, and a payload of eight
 *    steps rendered as sixteen.)
 *
 * ── The response this is written against (read from the running API, 2026-10-09) ──────────────
 *
 *   GET /api/developer/deployment →
 *   { generatedAt, destination: { id, label, source },
 *     plan: { file, commit, unverified },
 *     counts: { done, attention, blocked, decision, unverified },
 *     steps: [ { number, id, title, scope, state, summary, blockedBy, owedTo, plan, decides, run,
 *                items: [ { id, title, state, evidence, ifSkipped, derived, blocking } ] } ],
 *     advisories: [ { title, detail, plan } ],
 *     decisions:  [ { id, title, recommendation, detail, blocking, plan } ],
 *     bar:        [ { order, item, state, detail } ],
 *     handoff: { runtime, database, mail, provenance },
 *     unread: [ … ] }
 *
 * Everything the page shows is a field of that payload: an item's evidence is `evidence`, its "skip it"
 * sentence is `ifSkipped`, a step's note is `blockedBy` or `owedTo`, and the panel the mockup calls
 * "What this step actually decides" is `decides`. Nothing here is invented, and nothing here is a
 * state: the states come from that endpoint and nowhere else.
 */

/* ── The five states ─────────────────────────────────────────────────────────────────────────── */

export type DeploymentStateKey = "done" | "attention" | "blocked" | "decision" | "unverified";

export const DEPLOYMENT_STATES: readonly DeploymentStateKey[] = [
  "done",
  "attention",
  "blocked",
  "decision",
  "unverified",
];

/**
 * The legend, written once so the track, the checklist and the hand-off cannot describe the same state
 * three different ways. The wording is the mockup's, which is the plan's.
 */
export const STATE_LEGEND: { key: DeploymentStateKey; label: string; blurb: string }[] = [
  { key: "done", label: "Done", blurb: "The check ran and passed, with the evidence it was checked against." },
  {
    key: "attention",
    label: "Attention",
    blurb: "Ran, and found something that needs a person — a placeholder, a known pre-existing failure.",
  },
  { key: "blocked", label: "Blocked", blurb: "Cannot pass until a named thing changes. The card names the thing." },
  {
    key: "decision",
    label: "Decision owed",
    blurb: "Not a task. An owner and a place to record the answer, not a checkbox.",
  },
  {
    key: "unverified",
    label: "Could not verify",
    blurb: "The check did not run. Never shown as a pass — the round-2 defect was exactly this.",
  },
];

export const STATE_LABEL: Record<DeploymentStateKey, string> = {
  done: "Done",
  attention: "Attention",
  blocked: "Blocked",
  decision: "Decision owed",
  unverified: "Could not verify",
};

/** The sentence a card carries when the API did not supply one: "Blocked by: …", "Evidence: …". */
export const STATE_NOTE_LABEL: Record<DeploymentStateKey, string> = {
  done: "Evidence",
  attention: "Found",
  blocked: "Blocked by",
  decision: "Owed to",
  unverified: "Could not verify",
};

/**
 * The destinations this wizard knows about. Only Azure has a package behind it; AWS is drawn because the
 * plan says which steps are shared and which are Azure-specific, and the shared ones do not change.
 */
export const DESTINATIONS = [
  { id: "azure" as const, label: "Azure", hint: "Target: Azure — Bicep, PLAN-016 / PLAN-030" },
  {
    id: "aws" as const,
    label: "AWS",
    hint: "Target: AWS — the shared steps are the same; no equivalent package in this plan",
  },
];

/* ── The model ───────────────────────────────────────────────────────────────────────────────── */

/**
 * A recorded answer, as the API stores and returns it.
 *
 * The write endpoint is `POST /developer/deployment/records` with `{ kind, id, note }`, where `id` is a
 * **decision's own id** (`2.3`) for `kind: "decision"`, or a **checklist item's id** (`5.1`) for
 * `kind: "check"` — the ids are read out of the report itself, so a cross-kind id is refused rather than
 * filed against the wrong list. The GET then attaches each record to its own decision and to its own
 * checklist item as `record`, and lists them all in `records`, so the screen needs neither a second read
 * nor any matching of its own.
 */
export interface DeploymentRecord {
  kind: "decision" | "check";
  id: string;
  /** What that id names, as the report titles it — so a reader needs no second lookup. */
  subject: string | null;
  note: string;
  /**
   * What to print as "recorded by" — the person's **name**, captured when they signed the answer off.
   *
   * The API stores the name beside the id so a later rename cannot rewrite who answered. This field
   * carries the name and falls back to the id only for a record written before the name was captured,
   * which is why every render site can print it directly; `recordedById` is the account.
   */
  recordedBy: string | null;
  /** The recorder's user id, for the link back to the account. */
  recordedById: string | null;
  recordedByRole: string | null;
  recordedAt: string | null;
}

export interface DeploymentItem {
  id: string;
  title: string | null;
  state: DeploymentStateKey;
  /** What the item was checked against — the API's own words, including the file it was read from. */
  evidence: string | null;
  /** What happens if the item is skipped. */
  ifSkipped: string | null;
  /**
   * True when the state was decided by **reading this repository** rather than by running anything.
   * It is shown on the item, because "we read `main.bicep`" and "a check ran" are different claims and
   * this screen exists to keep them apart.
   */
  derived: boolean;
  /** False means the item does not hold the deployment back. */
  blocking: boolean;
  /** What the operator wrote down about this check, if anything. */
  record: DeploymentRecord | null;
}

export interface DeploymentStep {
  number: number;
  id: string;
  title: string | null;
  /** Shared steps are the same whatever the destination; the others name theirs. */
  scope: "shared" | "azure" | "aws" | null;
  state: DeploymentStateKey;
  summary: string | null;
  /** The named thing a blocked step is waiting on — the API's `blockedBy`. */
  blockedBy: string | null;
  /** Who owes the answer for a decision-state step — the API's `owedTo`. */
  owedTo: string | null;
  /** Where the step comes from: the plan's section, or the code it was derived from. */
  plan: string | null;
  /** What the step actually decides. */
  decides: string | null;
  /** How it is run — the commands, as the API reports them. */
  run: string[];
  items: DeploymentItem[];
}

export interface DeploymentDecision {
  id: string;
  title: string | null;
  recommendation: string | null;
  /** The reasoning behind the recommendation. */
  detail: string | null;
  blocking: boolean;
  plan: string | null;
  /** The operator's answer, written against this decision's own id — see {@link DeploymentRecord}. */
  record: DeploymentRecord | null;
}

export interface DeploymentAdvisory {
  title: string;
  detail: string | null;
  plan: string | null;
}

export interface DeploymentBarItem {
  order: number;
  item: string;
  state: DeploymentStateKey;
  detail: string | null;
}

export interface ReportRow {
  label: string;
  value: string;
  /** "placeholder" and "warning" are drawn as an aside; anything else is plain. */
  flag: "placeholder" | "warning" | null;
}

export interface ReportGroup {
  id: string;
  title: string;
  rows: ReportRow[];
}

/** The five figures the API reports, kept exactly as it reports them. */
export interface PayloadCounts {
  done: number;
  attention: number;
  blocked: number;
  decision: number;
  unverified: number;
}

export interface DeploymentCounts extends PayloadCounts {
  steps: number;
  advisories: number;
  /** Decisions still awaiting an answer. */
  owed: number;
  /** True when the five state figures were derived here rather than read from the payload. */
  derived: boolean;
}
export interface DeploymentModel {
  generatedAt: string | null;
  destination: { id: string; label: string; source: string | null };
  /** `plan.file`, `plan.commit` and the plan's own statement of what has not been verified. */
  planFile: string | null;
  planCommit: string | null;
  planUnverified: string | null;
  /** The payload's `counts`, or `null` when it did not send them. */
  counts: PayloadCounts | null;
  steps: DeploymentStep[];
  advisories: DeploymentAdvisory[];
  decisions: DeploymentDecision[];
  bar: DeploymentBarItem[];
  report: ReportGroup[];
  /**
   * Every record the deployment holds, including any whose subject the report no longer names. Those are
   * shown separately rather than dropped — the API keeps them on purpose, because a check that lost its id
   * is exactly when somebody needs to read what was decided about it.
   */
  records: DeploymentRecord[];
  /** What the API said it could not read, in its own words. */
  unreadable: string[];
}

/* ── Defensive readers ───────────────────────────────────────────────────────────────────────
 * A page that throws because a field moved is worse than one that says which field it could not read.
 * Every reader answers `null`/`[]`/`false` for anything it does not recognise, and `normaliseState`
 * never guesses "done".
 */

function readString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

function readArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : [];
}

function readObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function readBool(value: unknown): boolean {
  return value === true;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function readCount(value: unknown): number | null {
  const n = readNumber(value);
  return n === null ? null : Math.max(0, Math.trunc(n));
}

function readStringArray(value: unknown): string[] {
  return readArray<unknown>(value).filter((entry): entry is string => typeof entry === "string" && entry.trim() !== "");
}

/** Anything unrecognised is `unverified` — see rule 2 at the top of this file. */
export function normaliseState(value: unknown): DeploymentStateKey {
  return typeof value === "string" && (DEPLOYMENT_STATES as readonly string[]).includes(value)
    ? (value as DeploymentStateKey)
    : "unverified";
}

function readScope(value: unknown): DeploymentStep["scope"] {
  return value === "azure" || value === "aws" || value === "shared" ? value : null;
}

/* ── The fallback, for a failed read only ────────────────────────────────────────────────────
 * Titles, scope, summaries and the one plan-derived sentence per step. **No states and no items**,
 * except for the sanitisation step, whose surface list is a fact about this repository rather than
 * about the deployment. Nothing here may appear once the read succeeds.
 */

interface StepFallback {
  number: number;
  id: string;
  title: string;
  scope: DeploymentStep["scope"];
  summary: string;
  /** Prefixed with its label: "Blocked by: …", "Owed to: …". */
  note: string | null;
  plan: string;
}

export const STEP_FALLBACK: readonly StepFallback[] = [
  {
    number: 1,
    id: "target",
    title: "Target and naming",
    scope: "azure",
    summary:
      "The region is whatever resource group the run finds, and four names have to be globally free before anything is created.",
    note: "Owed to: the operator — the template defaults location to resourceGroup().location and no parameter file overrides it.",
    plan: "PLAN-030 §5, §8.12 · briefing, “What production will be created with”",
  },
  {
    number: 2,
    id: "parameters",
    title: "Parameters and secrets",
    scope: "shared",
    summary:
      "Two of the parameter file's values are placeholders rather than choices, and one of them puts a dead hostname in every link the app builds.",
    note: "Blocked by: webOrigin is still https://app.c7ntax.example.com",
    plan: "PLAN-030 §2.2, §2.7 · briefing, “Before the first production deployment”",
  },
  {
    number: 3,
    id: "infrastructure",
    title: "Infrastructure",
    scope: "azure",
    summary:
      "The eight Phase 1 blockers are applied in the template — none of it has been deployed.",
    note: null,
    plan: "PLAN-030 §1, §7 · Review round 1 §1–§6",
  },
  {
    number: 4,
    id: "database",
    title: "Database",
    scope: "shared",
    summary: "c7ntax, VNet-injected with no public endpoint and zone-redundant HA — and the app still connects as the server administrator.",
    note: "Owed to: the operator — 2.3 is deferred by decision, not dropped.",
    plan: "PLAN-030 §2.3, §8.1, §8.11–§8.12",
  },
  {
    number: 5,
    id: "readiness",
    title: "Readiness gate",
    scope: "shared",
    summary:
      "The promotion gate asks /api/ready — a SELECT 1 with a 2 s budget — and liveness stays on /api/health.",
    note: null,
    plan: "PLAN-030 §8.14 · PLAN-030-Review-Round-2.md §2",
  },
  {
    number: 6,
    id: "ingress",
    title: "Network and ingress",
    scope: "azure",
    summary:
      "The origin must be unreachable except through the ingress layer, and the API has no X-Azure-FDID check yet. D1 is undecided.",
    note: "Blocked by: D1 is undecided and lockIngressToFrontDoor is still false",
    plan: "PLAN-030 §2.1, §8.4, §8.6 · infra/README.md §4",
  },
  {
    number: 7,
    id: "sanitisation",
    title: "Sanitisation",
    scope: "shared",
    summary:
      "Strip what must not travel: sample data, demo accounts, the outbound-mail sandbox, integration credentials, placeholder origins, issued API keys, authentication conveniences.",
    note: "Owed to: the operator and the destination",
    plan: "apps/api/src/sample-data-toggle.ts · packages/shared/src/appConfiguration.ts",
  },
  {
    number: 8,
    id: "validate",
    title: "Validate and hand off",
    scope: "shared",
    summary: "The guards, the preflight, the two-pass first-run create, the saved what-if — then the report.",
    note: "Owed to: the operator, against a throwaway dev resource group",
    plan: "PLAN-030 §3, §8.11, §8.13–§8.14 · the root package.json guards",
  },
];

/**
 * The sanitisation step's seven surfaces, as a fallback: the contract is `sample-data-toggle.ts` and
 * `appConfiguration.ts`, which are facts about this repository and stay true when the read fails.
 */
const SURFACE_FALLBACK: { id: string; title: string; evidence: string; ifSkipped: string }[] = [
  {
    id: "7.1",
    title: "Sample and seed data",
    evidence:
      "WIPE_MODELS in sample-data-toggle.ts — tickets, contracts, invoices, Kumo assets, chat, surveys, ticket categories, service boards, integration, webhookConfig, m365Subscription, aiProviderConfig. Removed by the reversible purge on the purge screen, snapshot first.",
    ifSkipped: "the sample dataset is promoted with the instance, so the first thing production shows is somebody's demo tenant",
  },
  {
    id: "7.2",
    title: "Demo accounts",
    evidence:
      "user — preserved by KEEP_MODELS on purpose so the instance stays usable, and reviewed rather than wiped: the purge cannot tell a demo account from an administrator.",
    ifSkipped: "an account created for a demonstration keeps working in production",
  },
  {
    id: "7.3",
    title: "The outbound-mail sandbox",
    evidence:
      "SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_USER, SMTP_PASS, SMTP_FROM, read by GET /api/system/deployment. Attention when mail.configured is false, or when the host is a sandbox.",
    ifSkipped: "mail is accepted and never delivered, and the first symptom is a client who never received anything",
  },
  {
    id: "7.4",
    title: "Integration credentials",
    evidence:
      "connectors stored under integrations.emailConnectors, integrations.emailCloudConnectors and integrations.graphApi, with integrations.liveStatus deciding whether a check is trusted or made. Reissued against the production tenant, not copied.",
    ifSkipped: "a development tenant's credential is promoted, and the production integration then reads and writes in the wrong tenant",
  },
  {
    id: "7.5",
    title: "Placeholder origins",
    evidence:
      "WEB_ORIGIN / CORS_ORIGIN (https://app.c7ntax.example.com), portal.publicUrl, EMAIL_OAUTH_REDIRECT_URI — the same ⚠ as step 2.",
    ifSkipped: "the destination answers with a hostname that does not exist and browser calls from the real origin are refused",
  },
  {
    id: "7.6",
    title: "Issued API keys",
    evidence:
      "ApiKey — prefix searchable, only the SHA-256 of the secret stored, sourceKind (rmm, siem, flexpoint), revokedAt, expiresAt; screen at Administration → API access. Shown as an inventory with its last use, not a count.",
    ifSkipped: "a key issued for a test reaches production with the scopes it was given there",
  },
  {
    id: "7.7",
    title: "Authentication conveniences",
    evidence:
      "sessions.testBypass (refused outright when NODE_ENV is production) and sessions.sso pointed at a development tenant — both environment-only, so neither is visible from this screen.",
    ifSkipped: "a sign-in shortcut or a development identity provider is live in production",
  },
];

/**
 * The page with nothing read: the plan's own eight steps, none of them a state and none of them an
 * item — deliberately not a green one. This is what the screen falls back to when
 * `GET /api/developer/deployment` does not answer, and it is **only** used then.
 */
export function emptyModel(reason: string): DeploymentModel {
  const steps: DeploymentStep[] = STEP_FALLBACK.map((step) => ({
    number: step.number,
    id: step.id,
    title: step.title,
    scope: step.scope,
    state: "unverified",
    summary: step.summary,
    blockedBy: step.note?.startsWith("Blocked by:") ? step.note.replace(/^Blocked by: /, "") : null,
    owedTo: step.note?.startsWith("Owed to:") ? step.note.replace(/^Owed to: /, "") : null,
    plan: step.plan,
    decides: null,
    run: [],
    items:
      step.id === "sanitisation"
        ? SURFACE_FALLBACK.map((surface) => ({
            id: surface.id,
            title: surface.title,
            state: "unverified" as const,
            evidence: surface.evidence,
            ifSkipped: surface.ifSkipped,
            derived: false,
            blocking: true,
            record: null,
          }))
        : [],
  }));

  return {
    generatedAt: null,
    destination: { id: "azure", label: "Azure — Bicep, PLAN-016 / PLAN-030", source: null },
    planFile: "PlanDocs/PLAN-030-Azure-Bicep-Go-Live-Hardening.md",
    planCommit: null,
    planUnverified: reason,
    counts: null,
    steps,
    advisories: [],
    decisions: [],
    bar: [],
    report: [],
    records: [],
    unreadable: [reason],
  };
}

/* ── Reading the response ──────────────────────────────────────────────────────────────────── */

/**
 * Whether a body is a deployment payload at all.
 *
 * Used by the hook to decide between "the read succeeded" and "this was an error page", and by the
 * record call to tell an updated payload from a plain acknowledgement.
 */
export function isDeploymentPayload(raw: unknown): boolean {
  return Array.isArray(readObject(raw).steps);
}

/** A recorded answer, from the `record` the GET attaches to its own subject. */
function normaliseRecord(raw: unknown): DeploymentRecord | null {
  const record = readObject(raw);
  const note = readString(record.note);
  if (!note) return null;
  return {
    kind: record.kind === "check" ? "check" : "decision",
    id: readString(record.id) ?? "",
    subject: readString(record.subject),
    note,
    recordedBy: readString(record.recordedByName) ?? readString(record.recordedBy),
    recordedById: readString(record.recordedBy),
    recordedByRole: readString(record.recordedByRole),
    recordedAt: readString(record.recordedAt),
  };
}

function normaliseItem(raw: unknown, index: number): DeploymentItem {
  const record = readObject(raw);
  return {
    id: readString(record.id) ?? `item-${index + 1}`,
    title: readString(record.title),
    state: normaliseState(record.state),
    evidence: readString(record.evidence),
    ifSkipped: readString(record.ifSkipped),
    derived: readBool(record.derived),
    blocking: readBool(record.blocking),
    record: normaliseRecord(record.record),
  };
}

function normaliseStep(raw: unknown, index: number): DeploymentStep {
  const record = readObject(raw);
  return {
    number: readNumber(record.number) ?? index + 1,
    id: readString(record.id) ?? `step-${index + 1}`,
    title: readString(record.title),
    scope: readScope(record.scope),
    state: normaliseState(record.state),
    summary: readString(record.summary),
    blockedBy: readString(record.blockedBy),
    owedTo: readString(record.owedTo),
    plan: readString(record.plan),
    decides: readString(record.decides),
    run: readStringArray(record.run),
    items: readArray<unknown>(record.items).map(normaliseItem),
  };
}

function normaliseDecision(raw: unknown, index: number): DeploymentDecision {
  const record = readObject(raw);
  return {
    id: readString(record.id) ?? `decision-${index + 1}`,
    title: readString(record.title),
    recommendation: readString(record.recommendation),
    detail: readString(record.detail),
    blocking: readBool(record.blocking),
    plan: readString(record.plan),
    record: normaliseRecord(record.record),
  };
}

function normaliseAdvisory(raw: unknown): DeploymentAdvisory {
  const record = readObject(raw);
  return {
    title: readString(record.title) ?? "Advisory",
    detail: readString(record.detail),
    plan: readString(record.plan),
  };
}

function normaliseBarItem(raw: unknown, index: number): DeploymentBarItem {
  const record = readObject(raw);
  return {
    order: readNumber(record.order) ?? index + 1,
    item: readString(record.item) ?? readString(record.title) ?? "Bar item",
    state: normaliseState(record.state),
    detail: readString(record.detail),
  };
}

function row(label: string, value: string | null, flag: ReportRow["flag"] = null): ReportRow {
  return { label, value: value ?? "not reported", flag };
}

/**
 * The hand-off report, from `handoff: { runtime, database, mail, provenance }`.
 *
 * Each group is written out field by field rather than spread, so a field the API renames shows as
 * "not reported" instead of disappearing — and so the two rows that matter most (`webOrigin` and the
 * database role) carry the flag that says the value is a placeholder or a privileged login.
 */
function normaliseReport(raw: unknown): ReportGroup[] {
  const handoff = readObject(raw);
  const runtime = readObject(handoff.runtime);
  const database = readObject(handoff.database);
  const mail = readObject(handoff.mail);
  const provenance = readObject(handoff.provenance);
  const groups: ReportGroup[] = [];

  if (Object.keys(runtime).length > 0) {
    groups.push({
      id: "runtime",
      title: "Runtime",
      rows: [
        row("nodeEnv", readString(runtime.nodeEnv)),
        row("webOrigin", readString(runtime.webOrigin), readBool(runtime.webOriginPlaceholder) ? "placeholder" : null),
        row("port", readNumber(runtime.port)?.toString() ?? null),
        row("servesWeb", runtime.servesWeb === undefined ? null : String(readBool(runtime.servesWeb))),
      ],
    });
  }
  if (Object.keys(database).length > 0) {
    groups.push({
      id: "database",
      title: "Database",
      rows: [
        row("name", readString(database.name)),
        row("reachableHost", readString(database.reachableHost)),
        row(
          "connectsAs",
          readString(database.connectsAs),
          readBool(database.connectsAsAdministrator) ? "warning" : null,
        ),
        row(
          "tlsMode",
          readString(database.tlsMode),
          readString(database.tlsMode) && readString(database.tlsMode) !== "verify-full" ? "warning" : null,
        ),
      ],
    });
  }
  if (Object.keys(mail).length > 0) {
    groups.push({
      id: "mail",
      title: "Outbound mail",
      rows: [
        row(
          "configured",
          mail.configured === undefined ? null : String(readBool(mail.configured)),
          readBool(mail.configured) ? null : "warning",
        ),
        row(
          "host",
          readString(mail.host) ? `${readString(mail.host)}:${readNumber(mail.port) ?? "?"}` : null,
        ),
        row("secure", mail.secure === undefined ? null : String(readBool(mail.secure))),
        row("from", readString(mail.from), readBool(mail.fromPlaceholder) ? "placeholder" : null),
      ],
    });
  }
  if (Object.keys(provenance).length > 0) {
    groups.push({
      id: "provenance",
      title: "Provenance",
      rows: [
        row("commit", readString(provenance.commit)),
        row("bicepCompiled", provenance.bicepCompiled === undefined ? null : String(readBool(provenance.bicepCompiled))),
        row("migrations", readNumber(provenance.migrations)?.toString() ?? null),
        row("migrationsNewest", readString(provenance.migrationsNewest)),
        row("what-if saved", readString(provenance.whatIfSaved)),
        row("guards", readString(provenance.guards)),
      ],
    });
  }
  return groups;
}

/**
 * Turn the payload into the model — **only** the payload, with no fallback folded in.
 *
 * The eight steps the page names in its own prose are the payload's eight steps; if it sends five, five
 * are drawn and the other three are absent rather than invented. Fields the payload leaves out are
 * `null` and render as "not read", which is the only honest thing to do with them.
 */
export function normaliseDeployment(raw: unknown): DeploymentModel {
  const record = readObject(raw);
  const destination = readObject(record.destination);
  const plan = readObject(record.plan);
  const counts = readObject(record.counts);
  const payloadCounts: PayloadCounts | null =
    readCount(counts.done) === null
      ? null
      : {
          done: readCount(counts.done) ?? 0,
          attention: readCount(counts.attention) ?? 0,
          blocked: readCount(counts.blocked) ?? 0,
          decision: readCount(counts.decision) ?? 0,
          unverified: readCount(counts.unverified) ?? 0,
        };

  const unreadable = readArray<unknown>(record.unread ?? record.unreadable).filter(
    (entry): entry is string => typeof entry === "string" && entry.trim() !== "",
  );

  return {
    generatedAt: readString(record.generatedAt),
    destination: {
      id: readString(destination.id) ?? "azure",
      label: readString(destination.label) ?? "Azure",
      source: readString(destination.source),
    },
    planFile: readString(plan.file),
    planCommit: readString(plan.commit),
    planUnverified: readString(plan.unverified),
    counts: payloadCounts,
    steps: readArray<unknown>(record.steps)
      .map(normaliseStep)
      .sort((a, b) => a.number - b.number),
    advisories: readArray<unknown>(record.advisories).map(normaliseAdvisory),
    decisions: readArray<unknown>(record.decisions).map(normaliseDecision),
    bar: readArray<unknown>(record.bar).map(normaliseBarItem).sort((a, b) => a.order - b.order),
    report: normaliseReport(record.handoff),
    records: readArray<unknown>(record.records)
      .map(normaliseRecord)
      .filter((entry): entry is DeploymentRecord => entry !== null),
    unreadable,
  };
}

/* ── Counting ───────────────────────────────────────────────────────────────────────────────── */

/**
 * The five state figures come from the payload's own `counts` when it sends them, and are derived from
 * the steps it actually sent when it does not — never from both, and never from a fallback that was
 * not rendered. `derived` says which of the two happened, so the footer can be read with that in mind.
 */
export function countDeployment(model: DeploymentModel): DeploymentCounts {
  const derived: PayloadCounts = { done: 0, attention: 0, blocked: 0, decision: 0, unverified: 0 };
  for (const step of model.steps) derived[step.state] += 1;

  return {
    ...(model.counts ?? derived),
    steps: model.steps.length,
    advisories: model.advisories.length,
    owed: model.decisions.filter((decision) => !decision.record).length,
    derived: model.counts === null,
  };
}

/**
 * The records the report no longer names a subject for.
 *
 * The API keeps them on purpose and says so; this screen shows them rather than dropping them, because a
 * check that lost its id is exactly when somebody needs to read what was decided about it.
 */
export function unattachedRecords(model: DeploymentModel): DeploymentRecord[] {
  const attached = new Set<string>();
  for (const decision of model.decisions) if (decision.record) attached.add(`decision:${decision.id}`);
  for (const step of model.steps) {
    for (const item of step.items) if (item.record) attached.add(`check:${item.id}`);
  }
  return model.records.filter((record) => !attached.has(`${record.kind}:${record.id}`));
}

/**
 * The one-line summary the whole screen is read from — and it names `unverified` separately, because
 * "could not verify" is not a quiet kind of done.
 */
export function summarise(counts: DeploymentCounts): string {
  return [
    `${counts.steps} steps`,
    `${counts.done} done`,
    `${counts.blocked} blocked`,
    `${counts.decision} decision${counts.decision === 1 ? "" : "s"} owed`,
    `${counts.unverified} could not verify`,
  ].join(" · ");
}

/* ── What a step's state rests on, said once ───────────────────────────────────────────────── */

/**
 * The one sentence a step card and the hand-off carry: the named thing it is blocked by, who owes it,
 * or — when the payload names neither — the evidence of the first item that is not `done`.
 *
 * The evidence case returns `label: null` on purpose: the API's own evidence strings already open with
 * their own lead-in ("derived: …", "could not verify: …"), so prefixing "Evidence:" would say it twice.
 * Nothing here is a summary this screen invented.
 */
export function stepReason(step: DeploymentStep): { label: string | null; text: string } | null {
  if (step.blockedBy) return { label: "Blocked by", text: step.blockedBy };
  if (step.owedTo) return { label: "Owed to", text: step.owedTo };
  const first = step.items.find((item) => item.state !== "done") ?? step.items[0];
  if (first?.evidence) return { label: null, text: first.evidence };
  return null;
}

/** How a step's items fall across the five states, for the chips above a checklist. */
export function itemCounts(step: DeploymentStep): Partial<Record<DeploymentStateKey, number>> {
  const counts: Partial<Record<DeploymentStateKey, number>> = {};
  for (const item of step.items) counts[item.state] = (counts[item.state] ?? 0) + 1;
  return counts;
}

/**
 * The report as text, for the "Export report" action.
 *
 * It is deliberately verbose about what it could not read: an exported report that omitted the
 * unverified items would be a greener document than the screen it came from, which is the one thing
 * this whole page is written to avoid.
 */
export function buildReportText(model: DeploymentModel, counts: DeploymentCounts): string {
  const lines: string[] = [];
  const when = model.generatedAt ? new Date(model.generatedAt).toLocaleString() : new Date().toLocaleString();

  lines.push("Prepare for Live Deployment — deployment report", "");
  lines.push(`Destination: ${model.destination.label}`);
  if (model.planFile) lines.push(`Plan: ${model.planFile}`);
  if (model.planCommit) lines.push(`Commit: ${model.planCommit}`);
  lines.push(`Generated: ${when}`);
  lines.push(
    `Summary: ${summarise(counts)} · ${counts.advisories} advisories${counts.derived ? " (counted from the steps received)" : ""}`,
  );
  if (model.planUnverified) lines.push("", model.planUnverified);
  if (model.unreadable.length > 0) {
    lines.push("", "The deployment reported these as unread:");
    for (const entry of model.unreadable) lines.push(`  · ${entry}`);
  }

  lines.push("", "What was checked", "");
  for (const step of model.steps) {
    lines.push(`${step.number} · ${step.title ?? "untitled"} [${STATE_LABEL[step.state]}]${step.scope ? ` (${step.scope})` : ""}`);
    if (step.plan) lines.push(`    plan: ${step.plan}`);
    const reason = stepReason(step);
    if (reason) lines.push(`    ${reason.label}: ${reason.text}`);
    for (const item of step.items) {
      lines.push(`    - ${item.title ?? item.id} [${STATE_LABEL[item.state]}]${item.derived ? " (read from the repository, not run)" : ""}${item.blocking ? "" : " (does not hold the deployment)"}`);
      if (item.evidence) lines.push(`        checked against: ${item.evidence}`);
      if (item.ifSkipped) lines.push(`        skip it: ${item.ifSkipped}`);
    }
  }

  lines.push("", "What remains the operator's decision", "");
  if (model.decisions.length === 0) lines.push("  (none was read)");
  for (const decision of model.decisions) {
    lines.push(`  ${decision.id} · ${decision.title ?? "untitled"}${decision.blocking ? " [blocking]" : ""}`);
    if (decision.recommendation) lines.push(`      recommendation: ${decision.recommendation}`);
    if (decision.detail) lines.push(`      why: ${decision.detail}`);
    lines.push(
      `      answer: ${decision.record?.note ?? "not recorded yet"}${
        decision.record?.recordedBy ? ` — ${decision.record.recordedBy}` : ""
      }${decision.record?.recordedAt ? ` (${decision.record.recordedAt})` : ""}`,
    );
  }

  const orphans = unattachedRecords(model);
  if (orphans.length > 0) {
    lines.push("", "Recorded answers the report no longer names a subject for", "");
    for (const orphan of orphans) {
      lines.push(`  ${orphan.id} · ${orphan.subject ?? "unnamed"}: ${orphan.note}`);
    }
  }

  lines.push("", "Read from the deployment", "");
  if (model.report.length === 0) lines.push("  (none was read)");
  for (const group of model.report) {
    lines.push(`  ${group.title}`);
    for (const row of group.rows) {
      lines.push(`      ${row.label}: ${row.value}${row.flag ? ` [${row.flag}]` : ""}`);
    }
  }

  lines.push("", "The go-live bar (§8.11), in the order it is held", "");
  if (model.bar.length === 0) lines.push("  (not read)");
  for (const item of model.bar) {
    lines.push(`  ${item.item} — ${STATE_LABEL[item.state].toLowerCase()}${item.detail ? `; ${item.detail}` : ""}`);
  }

  lines.push("", "Advisories — they do not gate the deploy", "");
  if (model.advisories.length === 0) lines.push("  (none was read)");
  for (const advisory of model.advisories) {
    lines.push(`  ${advisory.title}${advisory.detail ? ` — ${advisory.detail}` : ""}${advisory.plan ? ` (${advisory.plan})` : ""}`);
  }

  lines.push(
    "",
    "A check that could not run is recorded as could not verify, never as a pass. Compiling is not deploying.",
  );
  return lines.join("\n");
}
