/**
 * c7ntax — the C7NTAX command line.
 *
 * **One grammar with the in-app console.** The line is parsed by `packages/shared/src/console`, the same
 * module the popup uses, and completed by the same engine — so `c7ntax ticket l<Tab>` and the popup's
 * `ticket l<Tab>` cannot disagree about what comes next. What differs is only the frame: a terminal
 * instead of a dialog, `_complete` instead of a key handler.
 *
 * **What it does not do.** It does not authorize anything. Every command is a name for a route, sent with
 * the API key as the caller, and the route checks the permission — the key acts as its owner with
 * `ownerPermissions ∩ key.scopes` (PLAN-028 §6). There is no server-side execution endpoint and no second
 * permission list, which is what makes the CLI's presence safe.
 *
 * **Reads only, for now.** The catalogue it parses from is the same one the popup gets, so `ticket create`
 * is refused with the phase it arrives in — a hand-written write command in a CLI would be the second
 * authorization list §7 forbids, and shipping one before the manifest exists is exactly the mistake that
 * section is about.
 *
 * Usage:
 *   c7ntax login --server https://psa.example.com --key c7k_…
 *   c7ntax context
 *   c7ntax help [noun [verb]]
 *   c7ntax ticket list --status new --limit 10
 *   c7ntax client show northwind
 *   c7ntax _complete "ticket l"          # used by the generated completion scripts
 */
import {
  CONSOLE_COMMANDS,
  CONSOLE_EXIT,
  buildRequest,
  completionsAt,
  flagsFor,
  matchingCandidates,
  parseStatement,
  resolveSubject,
  rowsOf,
  valueAt,
  type ConsoleCommandSpec,
  type ConsoleExitCode,
} from "@C7NTAX/shared";

import { fetchCatalogue, apiFetch, type Catalogue, type CommandDescriptor } from "./client";
import { apiBase, clearProfile, looksLikeApiKey, resolveProfile, writeProfile, type ResolvedProfile } from "./profile";

// ── Output ─────────────────────────────────────────────────────────────
const isTty = (): boolean => Boolean(process.stdout.isTTY);
const dim = (text: string): string => (isTty() && !process.env.NO_COLOR ? `\u001b[2m${text}\u001b[22m` : text);
const bold = (text: string): string => (isTty() && !process.env.NO_COLOR ? `\u001b[1m${text}\u001b[22m` : text);
const red = (text: string): string => (isTty() && !process.env.NO_COLOR ? `\u001b[31m${text}\u001b[39m` : text);

function fail(code: ConsoleExitCode, message: string, hint?: string): never {
  process.stderr.write(`${red("error")} ${message}\n`);
  if (hint) process.stderr.write(`      ${dim(hint)}\n`);
  process.exit(code);
}

/** A right-aligned column table, sized to its content rather than to a guess. */
function renderTable(columns: readonly { header: string; path: string }[], rows: Record<string, unknown>[]): string {
  const cells = rows.map((row) => columns.map((column) => valueAt(row, column.path)));
  const widths = columns.map((column, index) =>
    Math.max(column.header.length, ...cells.map((row) => (row[index] ?? "").length)),
  );
  const line = (values: string[]): string =>
    values.map((value, index) => value.padEnd(widths[index] ?? 0)).join("  ").replace(/\s+$/, "");

  return [
    dim(line(columns.map((column) => column.header))),
    ...cells.map((row) => line(row)),
  ].join("\n");
}

/** Columns for a command that did not declare its own: enough to read a row without `--json`. */
function autoColumns(rows: Record<string, unknown>[]): { header: string; path: string }[] {
  const first = rows[0];
  if (!first) return [];
  return Object.keys(first)
    .filter((key) => {
      const value = first[key];
      return value === null || typeof value !== "object" || Array.isArray(value);
    })
    .slice(0, 8)
    .map((key) => ({ header: key.replace(/([a-z])([A-Z])/g, "$1 $2").toUpperCase(), path: key }));
}

// ── Catalogue ⇄ the shared engine ──────────────────────────────────────
/**
 * A served descriptor as the shared engine's own type.
 *
 * The type assertions are the boundary between "the API's JSON" and "the compile-time shape", which is the
 * one place in the CLI where a value is trusted rather than checked — and it is checked where it is used:
 * an unknown command is a 404 from the API, and an unknown flag is refused by the parser.
 */
function asCommands(catalogue: Catalogue): ConsoleCommandSpec[] {
  return catalogue.groups.flatMap((group) => group.commands) as unknown as ConsoleCommandSpec[];
}

function descriptorFor(commands: ConsoleCommandSpec[], name: string): CommandDescriptor | undefined {
  return commands.find((command) => command.name === name) as unknown as CommandDescriptor | undefined;
}

// ── Own verbs ──────────────────────────────────────────────────────────
async function withProfile(): Promise<ResolvedProfile> {
  const profile = resolveProfile();
  if (!profile) {
    fail(
      CONSOLE_EXIT.refused,
      "Not signed in.",
      "Run `c7ntax login --server <url> --key c7k_…`, or set C7NTAX_SERVER and C7NTAX_KEY.",
    );
  }
  return profile;
}

async function login(args: string[]): Promise<void> {
  const server = valueOf(args, "--server") ?? process.env.C7NTAX_SERVER?.trim();
  const key = valueOf(args, "--key") ?? process.env.C7NTAX_KEY?.trim();
  if (!server) fail(CONSOLE_EXIT.usage, "`c7ntax login` needs --server.", "e.g. --server https://psa.example.com");
  if (!key) {
    fail(
      CONSOLE_EXIT.usage,
      "`c7ntax login` needs --key.",
      "Create a key in the application under Administration → API Access, then pass it here. The CLI never asks for your password.",
    );
  }
  if (!looksLikeApiKey(key)) {
    fail(CONSOLE_EXIT.usage, "That does not look like an API key.", "Keys issued by this application start with `c7k_`.");
  }

  const profile: ResolvedProfile = { server: server.replace(/\/+$/, ""), apiKey: key, source: "file" };
  const me = await apiFetch(profile, "/users/me");
  if (!me.ok) {
    fail(me.code, `The server refused that key: ${me.message}`, me.hint ?? `Tried ${apiBase(profile.server)}/users/me`);
  }

  const identity = me.body as { email?: string; permissions?: string[] };
  const path = writeProfile({
    server: profile.server,
    apiKey: key,
    ...(identity.email ? { account: identity.email } : {}),
    ...(Array.isArray(identity.permissions) ? { scopes: identity.permissions } : {}),
  });

  process.stdout.write(`Signed in to ${bold(profile.server)} as ${identity.email ?? "unknown"}\n`);
  process.stdout.write(`${dim(`Key stored in ${path} (owner-only). Revoke it under Administration → API Access.`)}\n`);
}

async function context(): Promise<void> {
  const profile = await withProfile();
  const catalogue = await fetchCatalogue(profile);
  if (!catalogue.ok) fail(catalogue.code, catalogue.message, catalogue.hint);

  const me = await apiFetch(profile, "/users/me");
  const version = await apiFetch(profile, "/system/version");
  const identity = me.ok ? (me.body as { email?: string; permissions?: string[] }) : {};
  const build = version.ok ? (version.body as { version?: string }) : {};

  const label = (name: string, value: string): string => `  ${name.padEnd(12)} ${value}`;
  process.stdout.write(
    [
      label("Server", profile.server),
      label("Signed in", identity.email ?? "unknown"),
      label("Credentials", `${(identity.permissions ?? []).length} permissions (from ${profile.source === "file" ? "the stored key" : "the environment"})`),
      label("Commands", `${catalogue.body.counts.available} available of ${catalogue.body.counts.total} — reads; writes arrive with PLAN-026's action manifest`),
      label("Build", build.version ?? "unknown"),
      "",
    ].join("\n"),
  );
}

async function help(args: string[]): Promise<void> {
  const profile = await withProfile();
  const catalogue = await fetchCatalogue(profile);
  if (!catalogue.ok) fail(catalogue.code, catalogue.message, catalogue.hint);
  const commands = asCommands(catalogue.body);
  const noun = args[0]?.toLowerCase();
  const verb = args[1]?.toLowerCase();

  if (!noun) {
    process.stdout.write(`${bold("c7ntax")} — ${catalogue.body.counts.available} commands available to this key\n\n`);
    for (const group of catalogue.body.groups) {
      process.stdout.write(`  ${bold(group.label)}\n`);
      process.stdout.write(`    ${dim(group.summary)}\n`);
      process.stdout.write(`    ${group.commands.map((command) => command.name).join(", ")}\n\n`);
    }
    process.stdout.write(`  ${bold("Console verbs")}\n    ${catalogue.body.verbs.map((v) => v.name).join(", ")}\n\n`);
    process.stdout.write(`${dim("help <noun>  ·  help <noun> <verb>  ·  context  ·  version")}\n`);
    return;
  }

  const forNoun = commands.filter((command) => command.noun === noun);
  if (forNoun.length === 0) fail(CONSOLE_EXIT.notFound, `No noun \`${noun}\` you may use.`, "Run `c7ntax help`.");

  if (!verb) {
    process.stdout.write(`${bold(noun)} — ${forNoun.length} verb${forNoun.length === 1 ? "" : "s"}\n\n`);
    for (const command of forNoun) {
      const descriptor = descriptorFor(commands, command.name);
      process.stdout.write(`  ${command.verb.padEnd(12)} ${descriptor?.description ?? ""}\n`);
      if (command.permission) process.stdout.write(`  ${"".padEnd(12)} ${dim(`needs ${command.permission}`)}\n`);
    }
    return;
  }

  const command = forNoun.find((candidate) => candidate.verb === verb);
  if (!command) fail(CONSOLE_EXIT.notFound, `\`${noun} ${verb}\` is not a command you may run.`, `Try: ${forNoun.map((c) => c.name).join(", ")}`);

  const descriptor = descriptorFor(commands, command.name);
  process.stdout.write(`${bold(command.name)} — ${descriptor?.description ?? ""}\n\n`);
  process.stdout.write(`  ${"permission".padEnd(12)} ${command.permission ?? "none — any credential"}\n`);
  process.stdout.write(`  ${"route".padEnd(12)} GET ${command.path}\n`);
  if (descriptor?.subject) {
    process.stdout.write(`  ${"subject".padEnd(12)} ${descriptor.subject.label}${descriptor.subject.required ? " (required)" : ""}${descriptor.subject.values?.length ? ` — one of: ${descriptor.subject.values.join(", ")}` : ""}\n`);
  }
  process.stdout.write(`\n  ${bold("flags")}\n`);
  for (const flag of flagsFor(command)) {
    const values = flag.values?.length ? ` [${flag.values.join("|")}]` : "";
    process.stdout.write(`    --${flag.name.padEnd(14)} ${flag.help}${values}\n`);
  }
  const example = `${command.name}${descriptor?.subject ? ` ${descriptor.subject.values?.[0] ?? "1001"}` : ""}${command.flags?.[0] ? ` --${command.flags[0].name} ${command.flags[0].values?.[0] ?? "…"}` : ""}`;
  process.stdout.write(`\n  ${dim("e.g.")}  ${example}\n`);
}

async function version(): Promise<void> {
  const profile = resolveProfile();
  const server = profile ? await apiFetch(profile, "/system/version") : null;
  const build = server?.ok ? (server.body as { version?: string; title?: string }) : null;
  process.stdout.write(`c7ntax       1.0.0 (grammar 1, shared with the in-app console)\n`);
  process.stdout.write(`application  ${build?.version ?? "unknown"}${build?.title ? ` — ${build.title}` : ""}\n`);
}

// ── Completion ─────────────────────────────────────────────────────────
/**
 * `c7ntax _complete "<line>"` — the candidates for a line, one per line on stdout.
 *
 * The generated shell scripts call back into this, which is what keeps a completion script from going
 * stale: the candidates come from the *live* catalogue, filtered by what this key may run, and they are
 * the same candidates the popup offers because they come from the same engine (§5.1).
 */
async function complete(args: string[]): Promise<void> {
  const line = args.join(" ");
  const profile = resolveProfile();
  if (!profile) process.exit(CONSOLE_EXIT.refused);

  const catalogue = await fetchCatalogue(profile);
  if (!catalogue.ok) process.exit(catalogue.code);
  const commands = asCommands(catalogue.body);

  const result = completionsAt(line, line.length, { commands });
  for (const candidate of matchingCandidates(result.candidates, result.word.prefix)) {
    // `value<TAB>description` is the shape both bash and pwsh completion functions can read; a value with
    // no description is printed alone so a script that ignores the second field still works.
    process.stdout.write(candidate.description ? `${candidate.value}\t${candidate.description}\n` : `${candidate.value}\n`);
  }
}

// ── Running a command ──────────────────────────────────────────────────
async function run(line: string): Promise<void> {
  const profile = await withProfile();
  const catalogue = await fetchCatalogue(profile);
  if (!catalogue.ok) fail(catalogue.code, catalogue.message, catalogue.hint);

  const commands = asCommands(catalogue.body);
  const parsed = parseStatement(line, commands);
  if (!parsed.ok) {
    /*
     * A rejection the *catalogue* caused is not the same as a typo, and saying "no such command" to somebody
     * whose key is simply narrower than their account is the wrong answer.
     *
     * The served catalogue is filtered to this key, so a command the key may not run is absent from it and
     * the parser reports it as unknown. `CONSOLE_COMMANDS` — the same list the server serves from — is
     * compiled into the CLI, so "it exists, but not for this key" can be answered exactly, offline.
     *
     * **This is a message, not a gate.** The CLI still authorizes nothing: it does not run the command, and
     * if it did, the route would refuse it. Nothing here may ever be turned into "is this allowed?" — that
     * question belongs to the route (§6).
     */
    const [noun, verb] = line.trim().split(/\s+/);
    const exists = CONSOLE_COMMANDS.some((command) => command.noun === noun?.toLowerCase() && command.verb === verb?.toLowerCase());
    const available = commands.some((command) => command.noun === noun?.toLowerCase() && command.verb === verb?.toLowerCase());
    if (exists && !available) {
      const full = CONSOLE_COMMANDS.find((command) => command.noun === noun?.toLowerCase() && command.verb === verb?.toLowerCase());
      fail(
        CONSOLE_EXIT.refused,
        `\`${noun} ${verb}\` needs \`${full?.permission}\`, which this key does not carry.`,
        "The route would refuse it too. Issue a wider key under Administration → API Access, or run it in the application.",
      );
    }
    fail(parsed.code, parsed.message, parsed.hint);
  }

  if (parsed.kind === "own") {
    // `c7ntax help` and `c7ntax context` are the two own verbs that make sense with a stored profile;
    // `alias`, `history`, `clear` and `exit` belong to the interactive surface, not to a one-shot process.
    if (parsed.own.verb === "help") return help(parsed.own.args);
    if (parsed.own.verb === "context") return context();
    if (parsed.own.verb === "version") return version();
    fail(CONSOLE_EXIT.usage, `\`${parsed.own.verb}\` is available in the in-app console, not the CLI.`);
  }

  const { invocation } = parsed;
  const verbosity = { json: Boolean(invocation.flags.json), quiet: Boolean(invocation.flags.quiet), verbose: Boolean(invocation.flags.verbose) };

  // The subject is resolved through the same list route the console uses: one match proceeds, several are
  // an error with the candidates, none suggests the closest (§5).
  let subjectId: string | null = null;
  const lookup = invocation.command.subject?.lookup;
  if (lookup && invocation.subject) {
    const list = await apiFetch(profile, lookup.path, {
      ...(lookup.searchParam ? { [lookup.searchParam]: invocation.subject } : {}),
      limit: "25",
    });
    if (!list.ok) fail(list.code, list.message, list.hint);

    const resolution = await resolveSubject(invocation.command, invocation.subject, (path, query) => {
      return apiFetch(profile, path, query).then((response) =>
        response.ok ? response.body : (() => { throw new Error(response.message); })(),
      );
    });
    if (!resolution.ok) fail(resolution.code, resolution.message, resolution.hint);
    subjectId = resolution.resolution.id;
    if (!verbosity.quiet && resolution.resolution.label && resolution.resolution.label !== invocation.subject) {
      process.stderr.write(`${dim(`→ ${invocation.command.subject?.label.toLowerCase()} ${resolution.resolution.label}`)}\n`);
    }
  }

  const built = buildRequest(invocation, { subjectId });
  if (!built.ok) fail(built.code, built.message, built.hint);

  const started = Date.now();
  const response = await apiFetch(profile, built.request.path, built.request.query);
  if (!response.ok) fail(response.code, response.message, response.hint ?? `GET ${built.request.path}`);

  if (verbosity.verbose) {
    const query = new URLSearchParams(built.request.query).toString();
    process.stderr.write(
      `${dim(`GET ${built.request.path}${query ? `?${query}` : ""} · needs ${built.request.permission ?? "no permission"} · ${Date.now() - started}ms`)}\n`,
    );
  }

  if (verbosity.json) {
    process.stdout.write(`${JSON.stringify(response.body, null, 2)}\n`);
    return;
  }

  const descriptor = descriptorFor(commands, invocation.command.name);
  const rows = rowsOf(response.body, descriptor?.rows ?? invocation.command.rows);

  if (rows.length > 0) {
    if (verbosity.quiet) {
      const columns = descriptor?.columns ?? autoColumns(rows);
      const key = columns[0]?.path ?? "id";
      process.stdout.write(`${rows.map((row) => valueAt(row, key)).join("\n")}\n`);
      return;
    }
    const columns = (descriptor?.columns ?? autoColumns(rows)) as { header: string; path: string }[];
    process.stdout.write(`${renderTable(columns, rows)}\n`);
    process.stdout.write(`${dim(`${rows.length} row${rows.length === 1 ? "" : "s"}`)}\n`);
    return;
  }

  // A single record: one field per line, which is what a terminal should print for one thing.
  if (response.body && typeof response.body === "object" && !Array.isArray(response.body)) {
    const entries = Object.entries(response.body as Record<string, unknown>).filter(
      ([, value]) => value === null || typeof value !== "object",
    );
    if (entries.length > 0) {
      process.stdout.write(`${entries.map(([key, value]) => `  ${key.padEnd(18)} ${value === null ? "" : String(value)}`).join("\n")}\n`);
      return;
    }
  }

  process.stdout.write(`${JSON.stringify(response.body, null, 2)}\n`);
}

// ── Shell completion scripts ───────────────────────────────────────────
function completionScript(shell: string): void {
  const scripts: Record<string, string> = {
    bash: `# c7ntax completion for bash — call back into the CLI so the candidates are never stale.
_c7ntax_complete() {
  local line current out
  line="\${COMP_LINE}"
  current="\${COMP_WORDS[COMP_CWORD]}"
  out=$(c7ntax _complete "$line" 2>/dev/null | cut -f1)
  COMPREPLY=( $(compgen -W "$out" -- "$current") )
  return 0
}
complete -o nospace -F _c7ntax_complete c7ntax`,
    zsh: `# c7ntax completion for zsh.
_c7ntax() {
  local -a candidates
  candidates=(\${(f)"$(c7ntax _complete "$BUFFER" 2>/dev/null | cut -f1)"})
  compadd -a candidates
}
autoload -U compinit && compinit
compdef _c7ntax c7ntax`,
    pwsh: `# c7ntax completion for PowerShell — a menu with descriptions, the way the in-app console shows them.
Register-ArgumentCompleter -Native -CommandName c7ntax -ScriptBlock {
  param($wordToComplete, $commandAst, $cursorPosition)
  $line = $commandAst.ToString().Substring(0, $cursorPosition)
  c7ntax _complete $line 2>$null | ForEach-Object {
    $parts = $_ -split "\`t", 2
    [System.Management.Automation.CompletionResult]::new(
      $parts[0],
      if ($parts.Count -gt 1) { "$($parts[0])  —  $($parts[1])" } else { $parts[0] },
      'ParameterValue',
      if ($parts.Count -gt 1) { $parts[1] } else { $parts[0] }
    )
  }
}`,
  };

  const script = scripts[shell];
  if (!script) {
    fail(CONSOLE_EXIT.usage, `No completion script for \`${shell ?? ""}\`.`, "bash, zsh or pwsh.");
  }
  process.stdout.write(`${script}\n`);
}

// ── Argument handling ──────────────────────────────────────────────────
/**
 * A value for a flag in the *CLI's own* arguments (not the command's).
 *
 * The distinction matters: `c7ntax login --key` is the CLI's flag, while `c7ntax ticket list --status new` is
 * the command's and is parsed by the shared grammar. Only the own verbs look here.
 */
function valueOf(args: string[], name: string): string | undefined {
  const inline = args.find((arg) => arg.startsWith(`${name}=`));
  if (inline) return inline.slice(name.length + 1);
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

async function main(argv: string[]): Promise<void> {
  const [first, ...rest] = argv;

  switch (first) {
    case undefined:
    case "help":
    case "--help":
      return help(rest);
    case "login":
      return login(rest);
    case "logout":
      clearProfile();
      process.stdout.write(`Signed out. The key itself is untouched — revoke it under Administration → API Access.\n`);
      return;
    case "context":
      return context();
    case "version":
    case "--version":
      return version();
    case "_complete":
      return complete(rest);
    case "completion":
      return completionScript(rest[0] ?? "");
    default:
      // Anything else is a command line for the shared grammar.
      return run(argv.join(" "));
  }
}

void main(process.argv.slice(2)).catch((error: unknown) => {
  // An unexpected failure still exits through the vocabulary a script can branch on: exit 6 is "the API ran
  // it and it failed", which is what a crash in the CLI amounts to from the outside.
  process.stderr.write(`${red("error")} ${(error as Error)?.message ?? String(error)}\n`);
  process.exit(CONSOLE_EXIT.failed);
});
