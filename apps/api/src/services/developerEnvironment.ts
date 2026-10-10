/**
 * The environment inspector's reading of this instance.
 *
 * Two questions, answered from different places and kept apart on purpose:
 *
 *   1. **What is set, and what is falling back?** Every name the application declares — the ones the
 *      configuration registry names as the environment variable a field replaces, and the ones the API
 *      reads directly — reported as set or falling back to the declared default, with the value that is
 *      actually in force where it is safe to print it.
 *   2. **Which instance is this?** `NODE_ENV`, whether that means production, the host and port, the app
 *      version and the git commit. The badge is what every other screen quotes when it refuses to do
 *      something ("the irreversible controls will not arm here"), so it is reported even when the rest
 *      cannot be.
 *
 * **A secret is never returned, and the payload says so.** The test has three parts, in this order: the
 * registry may declare a field `secret`; a name that looks like a credential is treated as one; and a
 * curated list may override either, because `AUTH_TEST_BYPASS_TOKEN_TTL` contains "token" and is a
 * duration, not a secret. A withheld value is reported as `set` plus a `hint` — the last few characters of
 * a fingerprint — which is enough to confirm *which* value is in place and useless to anybody who reads
 * it. `effective` is null for a secret, and `withheld` says why, so a screen cannot print a blank where a
 * credential used to be and call it a fact.
 */
import { execFileSync } from "child_process";
import { createHash } from "crypto";
import { existsSync, readFileSync } from "fs";
import * as os from "os";
import * as path from "path";
import { CONFIG_SECTIONS, type ConfigFieldSpec } from "@C7NTAX/shared";
import { repoRoot } from "./sampleDataOperations";
import { configValue, environmentSupplied, fallbackValue, savedValue } from "./appSettings";

/**
 * Names that read as a credential. Deliberately broad, because the cost of a false positive is a
 * fingerprint instead of a value, and the cost of a false negative is a credential on a screen.
 *
 * `_pass$` rather than `pass$` is not a detail: `AUTH_TEST_BYPASS` ends in "pass", is not a credential,
 * and *is* a fact an operator should be able to read here — a sign-in bypass that is switched on in a
 * deployment is exactly the kind of thing this screen exists to show. The exact-name overrides below
 * cover the remaining false positives.
 */
const SECRET_NAME_PATTERN = /password|passwd|_pass$|^pass$|secret|token|credential|bearer|_key$|^key$|apikey|api_key|private/i;

/** Names whose *value* is a connection string, and which therefore carry a password inside them. */
const CONNECTION_STRING_NAMES = new Set(["DATABASE_URL", "REDIS_URL"]);

export interface EnvironmentVariable {
  name: string;
  /** Whether the instance's environment supplies the name at all (empty counts as unset). */
  set: boolean;
  /** The value in force — never a secret's value; null when unset or withheld. */
  effective: string | null;
  /** `env` when the environment supplies it, `default` when the declared default is what applies. */
  source: "env" | "default";
  /** True when the value is withheld, whatever the reason. */
  secret: boolean;
  /** For a secret that is set: enough to confirm which value it is, useless to anybody else. */
  hint: string | null;
  /** Where the name is declared — the registry field, a requirement, or the API's own read. */
  declaredBy: string;
  /** What the name is for, when the declaration is not self-explanatory. */
  note?: string;
  /** True when the value was withheld rather than absent. */
  withheld?: boolean;
}

export interface EnvironmentBadge {
  nodeEnv: string;
  isProduction: boolean;
  host: string | null;
  port: number | null;
  version: string | null;
  commit: string | null;
}

/**
 * Names the API reads directly, rather than through the configuration registry.
 *
 * This list is maintained by hand and that is the point: a registry field carries its own environment
 * declaration, but these are read at a call site (`process.env.DATABASE_URL`), and a list that is
 * *generated* from call sites would report a name as declared the moment somebody typo'd one. Each entry
 * says what it is for, so a screen can explain a name nobody recognises.
 */
const DIRECT_READS: ReadonlyArray<{ name: string; note: string; secret?: boolean; fallback?: string }> = [
  { name: "DATABASE_URL", note: "the Prisma connection string, including its password", secret: true },
  { name: "JWT_SECRET", note: "signs session tokens; derives the vault key only when KUMO_MASTER_KEY is unset and we are not in production", secret: true, fallback: "the built-in development secret" },
  { name: "KUMO_MASTER_KEY", note: "encrypts the Kumo vault: 32 bytes base64 or 64 hex characters. Required in production — the API refuses to start without a usable one", secret: true, fallback: "derived from JWT_SECRET outside production" },
  { name: "NODE_ENV", note: "which environment this process believes it is", fallback: "development" },
  { name: "PORT", note: "the port the API listens on", fallback: "4000" },
  { name: "WEB_ORIGIN", note: "the SPA's origin, used for links the app builds and for CORS", fallback: "http://localhost:3010" },
  { name: "CORS_ORIGIN", note: "overrides WEB_ORIGIN for cross-origin calls", fallback: "WEB_ORIGIN" },
  { name: "PUBLIC_BASE_URL", note: "the origin the Outlook add-in's manifest is built against", fallback: "http://localhost:<PORT>" },
  { name: "API_PUBLIC_URL", note: "the origin the email connector's OAuth redirect is built against", fallback: "the request's own host" },
  { name: "WEB_PUBLIC_URL", note: "the origin notification links are built against", fallback: "APP_URL, then none" },
  { name: "APP_URL", note: "the SPA's public address, for links in notifications", fallback: "none" },
  { name: "SERVE_WEB", note: "whether the API also serves the built SPA (one image, one origin)", fallback: "true in production" },
  { name: "WEB_DIST", note: "where the built SPA is on disk, when it is not the default", fallback: "apps/web/dist" },
  { name: "C7NTAX_ROOT", note: "the repository root, when the API runs outside a checkout" , fallback: "found by walking up" },
  { name: "C7NTAX_INTERNAL_API_BASE", note: "the base the in-process AI assistant calls its own API on", fallback: "http://127.0.0.1:<PORT>" },
  { name: "TICKET_ATTACHMENT_DIR", note: "where ticket attachments are stored", fallback: "apps/api/data/ticket-attachments" },
  { name: "OUTLOOK_ADDIN_DIR", note: "the Outlook add-in taskpane on disk", fallback: "outlook-addin/" },
  { name: "OUTLOOK_ADDIN_GUID", note: "the add-in's identity in Office", fallback: "the id in the manifest" },
  { name: "OUTLOOK_ADDIN_INSTALLER_DIR", note: "where the built installers are", fallback: "installer/outlook-addin" },
  { name: "AUTH_TEST_BYPASS_ACCOUNT", note: "the address the development sign-in bypass accepts", secret: false, fallback: "none" },
  { name: "AUTH_TEST_BYPASS_TOKEN_TTL", note: "how long the bypass account's token lasts", secret: false, fallback: "720h" },
  { name: "SSO_CLIENT_ID", note: "the OIDC client id, when SSO is configured by environment", fallback: "the stored SSO configuration" },
  { name: "SSO_CLIENT_SECRET", note: "the OIDC client secret, when SSO is configured by environment", secret: true },
  { name: "SSO_REDIRECT_URI", note: "the OIDC callback, when it is not the API's own /api/auth/sso/oidc/callback" },
  { name: "EMAIL_OAUTH_DEPLOY_CLIENT_ID", note: "the app registration the connector setup deploys against", fallback: "Microsoft's Graph command-line client id" },
  { name: "EMAIL_OAUTH_SECRET_MONTHS", note: "how long the client secret the setup creates is valid", secret: false, fallback: "12" },
  { name: "EWS_ENDPOINT", note: "an override for the Exchange Web Services endpoint" },
  { name: "EMAIL_EWS_MAX_MESSAGES", note: "how many messages one EWS poll reads", fallback: "25" },
  { name: "EMAIL_EWS_TIMEOUT_MS", note: "the EWS request timeout", fallback: "30000" },
  { name: "EWS_ALLOW_SELF_SIGNED", note: "accept a self-signed certificate from EWS", fallback: "false" },
  { name: "EMAIL_IMAP_ALLOW_SELF_SIGNED", note: "accept a self-signed certificate from IMAP", fallback: "false" },
  { name: "GRAPH_TOKEN_BASE", note: "the token endpoint the Graph calls use", fallback: "https://login.microsoftonline.com" },
  { name: "GRAPH_API_BASE", note: "the Graph base URL", fallback: "https://graph.microsoft.com/v1.0" },
  { name: "DD_READER_BASE_URL", note: "the reader outage-board fetches are proxied through", fallback: "https://r.jina.ai/" },
  { name: "X_API_BASE_URL", note: "the X (Twitter) API base", fallback: "https://api.x.com" },
  { name: "INFERENCE_MODEL", note: "overrides the model the configured AI provider runs", fallback: "the provider's own model" },
  { name: "DEVADMIN_PASSWORD", note: "read only by the Developer Admin seeding script", secret: true, fallback: "devadmin" },
  { name: "SMTP_HOST", note: "the mail relay, also declared by the registry's mail area", fallback: "the stored mail settings, then localhost" },
  { name: "SMTP_PORT", note: "the relay's port", fallback: "587" },
  { name: "SMTP_SECURE", note: "whether the relay connection uses TLS from the first byte", fallback: "false" },
  { name: "SMTP_USER", note: "the relay's username", fallback: "none" },
  { name: "SMTP_PASS", note: "the relay's password", secret: true },
  { name: "SMTP_FROM", note: "the From address on outbound mail", fallback: "noreply@cyber7group.com" },
];

/**
 * A short, useless-but-identifying fingerprint of a withheld value.
 *
 * The tail of a long value is what the task of confirming "which value is in place" needs, and five
 * characters of a hundred-character credential is nothing. A *short* value is a different case — five
 * characters of a ten-character passphrase is half of it — so anything under twelve characters is reported
 * by a truncated digest instead, which still lets an operator match it against what they set.
 */
function fingerprint(value: string): string {
  if (value.length < 12) {
    return `set; sha256 ${createHash("sha256").update(value).digest("hex").slice(0, 6)} (${value.length} characters)`;
  }
  return `set; ends …${value.slice(-5)}`;
}

/** Every environment name the application declares, with where it was declared. */
function declaredNames(): Array<{ name: string; declaredBy: string; field?: ConfigFieldSpec; note?: string; secret?: boolean; fallback?: string }> {
  const declared: Array<{ name: string; declaredBy: string; field?: ConfigFieldSpec; note?: string; secret?: boolean; fallback?: string }> = [];
  const seen = new Set<string>();

  for (const section of CONFIG_SECTIONS) {
    for (const field of section.fields) {
      if (!field.env || seen.has(field.env)) continue;
      seen.add(field.env);
      declared.push({
        name: field.env,
        declaredBy: `${section.label} · ${field.label}`,
        field,
        secret: field.secret,
        note: field.source === "environment" ? "owned by the deployment, shown and never written" : "a stored setting shadows it when one is saved",
      });
    }
    for (const requirement of section.requirements ?? []) {
      for (const name of requirement.env ?? []) {
        if (seen.has(name)) continue;
        seen.add(name);
        declared.push({ name, declaredBy: `${section.label} · ${requirement.label}`, note: requirement.detail });
      }
    }
  }

  for (const read of DIRECT_READS) {
    if (seen.has(read.name)) {
      // A name the registry also declares keeps the registry's declaration, with the direct read's
      // description appended — the reader learns both that it is configured and that it is read here.
      const existing = declared.find((entry) => entry.name === read.name);
      if (existing) existing.note = existing.note ? `${existing.note}; ${read.note}` : read.note;
      continue;
    }
    seen.add(read.name);
    declared.push({ name: read.name, declaredBy: "read directly by the API", note: read.note, secret: read.secret, fallback: read.fallback });
  }

  return declared;
}

/**
 * Describe one name.
 *
 * `set` is the environment's own answer. `source` is `default` when it is absent, which is a fact about
 * the deployment and not a problem: a name with a declared default is meant to be absent on a machine
 * that has not configured it.
 */
function describe(
  entry: ReturnType<typeof declaredNames>[number],
  env: Record<string, string | undefined>,
): EnvironmentVariable {
  const raw = env[entry.name];
  const set = raw !== undefined && raw !== "";
  const secret = entry.secret ?? (SECRET_NAME_PATTERN.test(entry.name) || CONNECTION_STRING_NAMES.has(entry.name));

  if (secret) {
    return {
      name: entry.name,
      set,
      effective: null,
      source: set ? "env" : "default",
      secret: true,
      hint: set ? fingerprint(String(raw)) : null,
      withheld: set,
      declaredBy: entry.declaredBy,
      ...(entry.note ? { note: entry.note } : {}),
    };
  }

  // A declared default is only meaningful when the environment is silent, and it is the field's own
  // default rather than the value in force: a stored setting can shadow either, which is what the
  // `settings` section of the response is for.
  const effective = set
    ? String(raw)
    : entry.field
      ? String(entry.field.default)
      : entry.fallback ?? null;

  return {
    name: entry.name,
    set,
    effective,
    source: set ? "env" : "default",
    secret: false,
    hint: null,
    declaredBy: entry.declaredBy,
    ...(entry.note ? { note: entry.note } : {}),
  };
}

/** Every declared name, described, sorted the way an operator reads a list: set names first, then by name. */
export function describeEnvironment(env: Record<string, string | undefined> = process.env as Record<string, string | undefined>): EnvironmentVariable[] {
  return declaredNames()
    .map((entry) => describe(entry, env))
    .sort((a, b) => Number(b.set) - Number(a.set) || a.name.localeCompare(b.name));
}

/** The version of the newest What's New entry — the same number `/api/system/version` reports. */
function appVersion(): string | null {
  try {
    const notes = require("../BuildNotes.json") as Array<{ version?: unknown }>;
    const newest = Array.isArray(notes) ? notes[0] : undefined;
    return typeof newest?.version === "string" ? newest.version : null;
  } catch {
    return null;
  }
}

/**
 * The commit this working copy is on, if it can be read.
 *
 * `git` first, because it is the answer for a checkout with a real object database; then `.git/HEAD` and
 * the ref it names, because a packaged or shallow copy may still carry the files even when the binary is
 * absent. Null when neither answers — a screen that shows nothing is better than one that shows a guess.
 */
export function readGitCommit(): string | null {
  const cwd = repoRoot ?? process.cwd();
  try {
    const out = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
      cwd,
      timeout: 2000,
      stdio: ["ignore", "pipe", "ignore"],
      encoding: "utf8",
    }).trim();
    if (out) return out;
  } catch { /* fall through to reading .git directly */ }

  try {
    const gitDir = path.join(cwd, ".git");
    if (!existsSync(gitDir)) return null;
    const head = readFileSync(path.join(gitDir, "HEAD"), "utf8").trim();
    const match = head.match(/^ref:\s*(.+)$/);
    if (!match?.[1]) return head.slice(0, 7) || null;
    const refFile = path.join(gitDir, match[1]);
    if (!existsSync(refFile)) return null;
    return readFileSync(refFile, "utf8").trim().slice(0, 7) || null;
  } catch {
    return null;
  }
}

/**
 * Which instance this is.
 *
 * `host` is the machine's own name rather than a configured origin: the question the badge answers is
 * "which process am I talking to", and a configured origin is a *claim* the deployment makes, which the
 * environment list already reports as `WEB_ORIGIN`. `port` mirrors the rule the server itself uses.
 */
export function environmentBadge(): EnvironmentBadge {
  const nodeEnv = process.env.NODE_ENV || "development";
  return {
    nodeEnv,
    isProduction: nodeEnv === "production",
    host: os.hostname() || null,
    port: Number(process.env.PORT) || 4000,
    version: appVersion(),
    commit: readGitCommit(),
  };
}

/**
 * The flag registry as read-only rows: one row per declared field, with the value in force, what is
 * saved, what the environment alone would give it, and whether a saved setting is shadowing it.
 *
 * A field the registry marks `secret` reports `value: null` and a `withheld` flag — the registry's own
 * secret handling, restated here because this endpoint bypasses `/api/configuration`'s rendering and
 * must not become the one place a credential leaks.
 */
export function describeFlags(): Array<Record<string, unknown>> {
  const rows: Array<Record<string, unknown>> = [];
  for (const section of CONFIG_SECTIONS) {
    for (const field of section.fields) {
      const value = configValue(section.id, field.id);
      const fallback = fallbackValue(section.id, field.id);
      const saved = savedValue(section.id, field.id);
      const fromEnvironment = environmentSupplied(field);
      rows.push({
        key: `${section.id}.${field.id}`,
        section: section.id,
        sectionLabel: section.label,
        id: field.id,
        label: field.label,
        type: field.type,
        source: field.source,
        env: field.env ?? null,
        secret: Boolean(field.secret),
        value: field.secret ? null : value,
        withheld: Boolean(field.secret),
        saved: field.secret ? null : saved ?? null,
        fallback: field.secret ? null : fallback,
        fromEnvironment,
        overridden: fromEnvironment && saved !== undefined && fallback !== value,
      });
    }
  }
  return rows;
}

/** The effective value of every declared setting, grouped by the section it belongs to. */
export function describeSettings(): Array<Record<string, unknown>> {
  return CONFIG_SECTIONS.map((section) => ({
    id: section.id,
    label: section.label,
    summary: section.summary,
    governs: section.governs,
    readPermission: section.readPermission,
    writePermission: section.writePermission,
    /** The `app_settings` view of this section: one entry per declared field, as it resolves today. */
    values: Object.fromEntries(
      section.fields.map((field) => [
        field.id,
        field.secret
          ? { withheld: true, set: Boolean(environmentSupplied(field)) || savedValue(section.id, field.id) !== undefined }
          : configValue(section.id, field.id),
      ]),
    ),
  }));
}

/**
 * What the environment payload says about its own withholding, so the rule travels with the data rather
 * than only living in this file.
 */
export const SECRET_WITHHELD_NOTE =
  "Secret-looking names are reported as `set` with a `hint` and never as a value: " +
  "`effective` is null and `withheld` is true for them. A hint is the last characters of a fingerprint, " +
  "which confirms which value is in place and is useless to anybody who reads it.";
