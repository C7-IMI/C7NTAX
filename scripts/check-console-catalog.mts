/**
 * `guard:console` — every command in the console catalogue still describes something real.
 *
 * PLAN-028 §7 asks for this check before the console exists, because a command list is an
 * authorization list by another name. Four things can quietly go wrong, and each of them is a
 * sentence in this file:
 *
 *   1. **A path that no longer resolves to a route** — the command 404s, or worse, names a path some
 *      other router now owns.
 *   2. **A permission that differs from the route's** — the console would show a command as available
 *      when the route refuses it, or claim a permission the route does not check. This is the check
 *      that stops the console becoming a *weaker* authorization layer than the API beside it.
 *   3. **A flag the route does not read** — a flag silently discarded is a command that does
 *      something other than what was typed, which is the worst failure mode a console can have.
 *   4. **A command with no description, no group, a duplicate name**, or a required subject without a
 *      way to resolve one — the catalogue's own structural rules, so `help` cannot lose a section.
 *
 * The authorities are the generated specification (`docs/openapi.yaml`, which is generated *from* the
 * routes) and the route sources themselves. Nothing here restates a route by hand.
 *
 * Run with: pnpm guard:console   (tsx, because the catalogue is TypeScript in packages/shared)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  CONSOLE_COMMANDS,
  CONSOLE_GROUPS,
  CONSOLE_UNIVERSAL_FLAGS,
  CONSOLE_WRITE_VERBS,
  flagsFor,
  permittedCommands,
} from "../packages/shared/src/console/catalogue.ts";
import { Permission } from "../packages/shared/src/enums.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spec = readFileSync(path.join(root, "docs/openapi.yaml"), "utf8");

interface Operation {
  /** `/api/tickets/{id}` — normalised so `{x}` and `{y}` compare equal. */
  path: string;
  method: string;
  permissions: string[];
  /** The route file that declares it, from `x-source`: `tickets/index.ts`. */
  source: string;
}

/** The operations the specification declares, which is what the routes declare. */
function operations(): Operation[] {
  const lines = spec.split(/\r?\n/);
  const found: Operation[] = [];
  let current: string | null = null;
  let method: string | null = null;
  let permissions: string[] = [];
  let source = "";

  const flush = () => {
    if (current && method) {
      found.push({ path: normalisePath(current), method, permissions, source });
    }
    method = null;
    permissions = [];
    source = "";
  };

  for (const line of lines) {
    const pathMatch = line.match(/^  "(\/[^"]+)":\s*$/);
    if (pathMatch) {
      flush();
      current = pathMatch[1] ?? null;
      continue;
    }
    const methodMatch = line.match(/^    (get|post|put|patch|delete):\s*$/);
    if (methodMatch) {
      flush();
      method = methodMatch[1] ?? null;
      continue;
    }
    if (!method) continue;
    const permMatch = line.match(/^\s+x-required-permissions: \[(.*)\]/);
    if (permMatch) permissions = [...(permMatch[1] ?? "").matchAll(/"([^"]+)"/g)].map((m) => m[1] ?? "");
    const sourceMatch = line.match(/^\s+x-source: "([^"]+)"/);
    if (sourceMatch) source = (sourceMatch[1] ?? "").split(" · ")[0] ?? "";
  }
  flush();
  return found;
}

function normalisePath(value: string): string {
  return value.replace(/\{[^}]+\}/g, "{}").replace(/\/$/, "");
}

const OPERATIONS = operations();

/** Query parameter names a route file actually reads. */
function queryNamesIn(file: string): Set<string> {
  let source: string;
  try {
    source = readFileSync(path.join(root, "apps/api/src/routes", file), "utf8");
  } catch {
    return new Set();
  }
  const names = new Set<string>();
  for (const m of source.matchAll(/req\.query\.([A-Za-z0-9_]+)/g)) names.add(m[1] ?? "");
  for (const m of source.matchAll(/req\.query\[["']([A-Za-z0-9_]+)["']\]/g)) names.add(m[1] ?? "");
  for (const m of source.matchAll(/([A-Za-z0-9_]+)\s*=\s*String\(req\.query/g)) names.add(m[1] ?? "");
  for (const m of source.matchAll(/const\s*\{([^}]*)\}\s*=\s*(?:\(?req\.query|req\.query)/g)) {
    for (const piece of (m[1] ?? "").split(",")) {
      const name = piece.split(/[:=]/)[0]?.trim();
      if (name && /^[A-Za-z0-9_]+$/.test(name)) names.add(name);
    }
  }
  return names;
}

/**
 * Query names read somewhere other than `req.query`, with the reason.
 *
 * `parsePeriod` walks the whole query object for the date window, so `from`/`to` are real parameters
 * of the reports routes without appearing in them; `reports/designer` takes the same window. A
 * command that declares a flag not covered here and not in the file fails, which is the point — this
 * list is the only way to add one, and it has to be argued for.
 */
const QUERY_ALLOWANCES: Record<string, { name: string; reason: string }[]> = {
  "reports.ts": [
    { name: "from", reason: "parsePeriod(req.query) reads the window's start from the whole query object" },
    { name: "to", reason: "parsePeriod(req.query) reads the window's end from the whole query object" },
  ],
};

/** Permissions the enum declares. */
const PERMISSIONS = new Set<string>(Object.values(Permission).filter((v): v is string => typeof v === "string"));

const problems: string[] = [];

for (const command of CONSOLE_COMMANDS) {
  const label = `\`${command.name}\``;

  if (!command.description?.trim()) problems.push(`${label} has no description`);
  if (!CONSOLE_GROUPS.some((g) => g.id === command.group)) problems.push(`${label} is in group \`${command.group}\`, which is not in CONSOLE_GROUPS`);
  if (command.permission && !PERMISSIONS.has(command.permission)) problems.push(`${label} claims permission \`${command.permission}\`, which is not in the Permission enum`);
  if (command.subject?.required && !command.subject.lookup && !command.subject.values && command.path.includes("{subject}") === false) {
    problems.push(`${label} requires a subject but has nothing to resolve one with`);
  }

  // 1 and 2 — the path resolves, and to an operation with the permission the command claims.
  // The path is normalised *before* a value is substituted, so both sides compare as templates.
  const declared = normalisePath(`/api${command.path}`);
  const candidates = command.subject?.values?.length
    ? command.subject.values.map((value) => normalisePath(`/api${command.path.replace("{subject}", value)}`))
    : [declared];

  const match = OPERATIONS.find((op) => op.method === "get" && candidates.includes(op.path));
  if (!match) {
    problems.push(`${label} GET ${command.path} does not resolve to a route (spec has ${candidates.length} candidate path${candidates.length === 1 ? "" : "s"})`);
    continue;
  }

  const routePermission = match.permissions[0] ?? null;
  if ((command.permission ?? null) !== routePermission) {
    problems.push(
      `${label} claims ${command.permission ?? "no permission"} but ${match.source} checks ${routePermission ?? "none"} for ${match.path}`,
    );
  }

  // 3 — every flag the command forwards is a parameter the route reads. The command's own `query`
  // list is checked too, so a declared parameter the route ignores is caught even when a universal
  // flag of the same name would otherwise hide it.
  const names = queryNamesIn(match.source);
  const allowed = new Set([...(QUERY_ALLOWANCES[match.source] ?? []).map((a) => a.name)]);
  const universal = new Set(CONSOLE_UNIVERSAL_FLAGS.map((f) => f.name));
  for (const flag of flagsFor(command)) {
    const parameter = flag.query ?? flag.name;
    if (universal.has(flag.name) && !(command.query ?? []).includes(parameter)) continue;
    if (names.has(parameter) || allowed.has(parameter)) continue;
    problems.push(`${label} declares \`--${flag.name}\` → \`${parameter}\`, which ${match.source} never reads from the query string`);
  }
  for (const parameter of command.query ?? []) {
    if (names.has(parameter) || allowed.has(parameter)) continue;
    problems.push(`${label} lists the query parameter \`${parameter}\`, which ${match.source} never reads`);
  }
}

// 4 — the catalogue's own rules.
const seen = new Map<string, string>();
for (const command of CONSOLE_COMMANDS) {
  const previous = seen.get(command.name);
  if (previous) problems.push(`two commands claim \`${command.name}\` (${previous} and ${command.group})`);
  seen.set(command.name, command.group);
  if (seen.size > CONSOLE_COMMANDS.length) break;
}

const nouns = new Set(CONSOLE_COMMANDS.map((c) => c.noun));

// A noun whose verbs collide with the universal flags cannot be completed unambiguously.
for (const noun of nouns) {
  const verbs = CONSOLE_COMMANDS.filter((c) => c.noun === noun).map((c) => c.verb);
  if (verbs.some((v) => CONSOLE_UNIVERSAL_FLAGS.some((f) => f.name === v))) {
    problems.push(`\`${noun}\` uses a universal flag name as a verb (${verbs.join(", ")})`);
  }
}

// A noun with only one verb is a noun people will type wrongly; it is not an error, but it is worth
// knowing which ones they are when reading `help` output.
const singleVerbNouns = [...nouns].filter((noun) => CONSOLE_COMMANDS.filter((c) => c.noun === noun).length === 1);

if (problems.length) {
  console.error(`console catalog: ${problems.length} problem(s).\n`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error("\nFix the catalogue in packages/shared/src/console/catalogue.ts, or add a reasoned allowance in this script.");
  process.exit(1);
}

const routes = new Set(CONSOLE_COMMANDS.map((c) => c.path)).size;
const groups = CONSOLE_GROUPS.filter((g) => CONSOLE_COMMANDS.some((c) => c.group === g.id)).length;

console.log("console catalog: ok");
console.log(`           ${CONSOLE_COMMANDS.length} read commands, ${nouns.size} nouns, ${groups} groups`);
console.log(`           ${routes} routes named · every path, permission and flag verified against the routes`);
if (singleVerbNouns.length) console.log(`           ${singleVerbNouns.length} nouns have a single verb: ${singleVerbNouns.join(", ")}`);
