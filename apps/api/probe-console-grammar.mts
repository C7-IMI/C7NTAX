/**
 * probe-console-grammar — the console's grammar, completion and subject resolution, checked as data.
 *
 * The console's grammar is the one part of PLAN-028 that can be verified without a running API: it is
 * a pure function from a line to a command. So this probe is a table of lines and expected outcomes,
 * run in one pass, and it fails loudly on the first disagreement — including the cases where being
 * *wrong* would be dangerous rather than merely annoying (an ambiguous client, a permission the caller
 * does not hold, a flag that is silently discarded).
 *
 * Run with: pnpm --filter @C7NTAX/api exec tsx probe-console-grammar.mts
 * No server, no database, no session.
 */
import {
  CONSOLE_COMMANDS,
  flagsFor,
  permittedCommands,
  type ConsoleCommandSpec,
} from "../../packages/shared/src/console/catalogue.ts";
import { CONSOLE_EXIT, wordAtCursor } from "../../packages/shared/src/console/grammar.ts";
import { parseLine, parseStatement } from "../../packages/shared/src/console/parse.ts";
import { completionsAt, historyMatches, longestCommonPrefix, matchingCandidates, predictionFor } from "../../packages/shared/src/console/completion.ts";
import { resolveSubject, rowsOf } from "../../packages/shared/src/console/execute.ts";

let passed = 0;
const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) { passed++; return; }
  failures.push(`${name}${detail ? ` — ${detail}` : ""}`);
}

/** Every permission the catalogue names, so a refusal case has to ask for a refusal explicitly. */
const ALL: string[] = [...new Set(CONSOLE_COMMANDS.map((c) => c.permission).filter((p): p is string => Boolean(p)))];

/** Parse one statement and hand the outcome to an assertion. */
function outcome(line: string, permissions: string[] = ALL) {
  return parseStatement(line, CONSOLE_COMMANDS, { permissions });
}

// ── The shape of a command line ────────────────────────────────────────
{
  const result = outcome("ticket list --status open --limit 10");
  check("a noun, a verb and flags parse", result.ok && result.kind === "command");
  if (result.ok && result.kind === "command") {
    const { invocation } = result;
    check("the command is ticket list", invocation.command.name === "ticket list", invocation.command.name);
    check("flags carry their values", invocation.flags.status === "open" && invocation.flags.limit === "10", JSON.stringify(invocation.flags));
    check("no subject on a list", invocation.subject === null);
  }
}

{
  const result = outcome("ticket show 1001");
  check("a subject parses", result.ok && result.kind === "command" && result.invocation.subject === "1001");
}

{
  const result = outcome('client show "Northwind Traders"');
  check(
    "quoted subjects keep their spaces",
    result.ok && result.kind === "command" && result.invocation.subject === "Northwind Traders",
    result.ok ? JSON.stringify(result) : result.message,
  );
}

{
  const result = outcome("ticket list --limit=25");
  check("--flag=value is one flag", result.ok && result.kind === "command" && result.invocation.flags.limit === "25");
}

{
  // `--low-stock` and `--lowStock` are the same flag, and it maps to the route's `lowStock`.
  const dashed = outcome("product list --low-stock");
  const camel = outcome("product list --lowStock");
  check("a dashed flag resolves", dashed.ok && dashed.kind === "command" && dashed.invocation.flags["low-stock"] === true);
  check("a camel-case flag resolves to the same flag", camel.ok && camel.kind === "command" && camel.invocation.flags["low-stock"] === true);
}

{
  const result = outcome("tick list");
  check("an unambiguous noun prefix resolves", result.ok && result.kind === "command" && result.invocation.command.noun === "ticket");
}

{
  const result = outcome("ticket l");
  check("an unambiguous verb prefix resolves", result.ok && result.kind === "command" && result.invocation.command.verb === "list");
}

{
  const result = outcome("t");
  check("an ambiguous noun prefix is refused with candidates", !result.ok && /could be/.test(result.message), result.ok ? "parsed" : result.message);
}

// ── Statements, comments and blanks ────────────────────────────────────
{
  const results = parseLine("ticket list; client list", CONSOLE_COMMANDS, { permissions: ALL });
  check("`;` splits into two commands", results.length === 2 && results.every((r) => r.ok), `${results.length}`);
}

{
  const results = parseLine("# a comment\nticket list", CONSOLE_COMMANDS, { permissions: ALL });
  check("a comment line is ignored", results.length === 1, `${results.length}`);
}

{
  const results = parseLine("   ", CONSOLE_COMMANDS, { permissions: ALL });
  check("a blank line is nothing", results.length === 0);
}

{
  const result = outcome('ticket list --search "unterminated');
  check("an unterminated quote is a usage error", !result.ok && result.code === CONSOLE_EXIT.usage, result.ok ? "parsed" : result.message);
}

// ── The console's own verbs ────────────────────────────────────────────
{
  const result = outcome("help");
  check("`help` is a console verb", result.ok && result.kind === "own" && result.own.verb === "help");
}

{
  const result = outcome("? ticket");
  check("`?` is help", result.ok && result.kind === "own" && result.own.verb === "help" && result.own.args[0] === "ticket");
}

{
  const result = outcome("context");
  check("`context` is a console verb", result.ok && result.kind === "own" && result.own.verb === "context");
}

// ── Refusals that have to be specific ──────────────────────────────────
{
  const result = outcome("widget list");
  check("an unknown noun says so", !result.ok && result.code === CONSOLE_EXIT.usage && /Unknown command/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("ticket fly");
  check("an unknown verb lists the real ones", !result.ok && /has no verb/.test(result.message) && /ticket list/.test(result.hint ?? ""), result.ok ? "parsed" : `${result.message} / ${result.hint}`);
}

{
  const result = outcome("ticket create --client northwind");
  check("a write verb is refused by policy, not as unknown", !result.ok && result.code === CONSOLE_EXIT.policy, result.ok ? "parsed" : result.message);
}

{
  const result = outcome("ticket list --nonsense");
  check("an unknown flag is a usage error", !result.ok && /has no flag/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("ticket list --status");
  check("a flag without its value is a usage error", !result.ok && /needs a value/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("ticket show");
  check("a missing subject says what to give it", !result.ok && /needs a ticket/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("board list 1001");
  check("a subject on a verb that takes none is refused", !result.ok && /takes no subject/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("report run nope");
  check("a closed subject set refuses a stranger", !result.ok && result.code === CONSOLE_EXIT.notFound, result.ok ? "parsed" : result.message);
}

{
  const result = outcome("ticket list", ["client:view"]);
  check("a permission the caller lacks is refused with its name", !result.ok && result.code === CONSOLE_EXIT.refused && /ticket:view/.test(result.message), result.ok ? "parsed" : result.message);
}

{
  const result = outcome("me show", []);
  check("a command with no permission runs for anybody signed in", result.ok && result.kind === "command");
}

// ── Aliases ────────────────────────────────────────────────────────────
{
  const result = parseStatement("t list --limit 5", CONSOLE_COMMANDS, { permissions: ALL, aliases: { t: "ticket" } });
  check("an alias expands to its noun", result.ok && result.kind === "command" && result.invocation.command.name === "ticket list", result.ok ? result.invocation.command.name : result.message);
}

// ── Completion ─────────────────────────────────────────────────────────
const context = { commands: permittedCommands(ALL) };

{
  const result = completionsAt("tick", 4, context);
  const nouns = matchingCandidates(result.candidates, result.word.prefix).map((c) => c.value);
  check("Tab on a partial noun offers nouns", result.position === "noun" && nouns.includes("ticket"), `${result.position} ${nouns.slice(0, 4).join(",")}`);
}

{
  const result = completionsAt("ticket ", 7, context);
  const verbs = result.candidates.map((c) => c.value);
  check("after a noun, completion offers its verbs", result.position === "verb" && verbs.includes("list") && verbs.includes("show"), `${result.position} ${verbs.join(",")}`);
}

{
  const result = completionsAt("ticket li", 9, context);
  const verbs = matchingCandidates(result.candidates, result.word.prefix).map((c) => c.value);
  check("a partial verb narrows to one", verbs.length === 1 && verbs[0] === "list", verbs.join(","));
}

{
  const result = completionsAt("ticket show ", 12, context);
  check("after a verb that takes a subject, the subject position is a value", result.position === "subject", result.position);
}

{
  const result = completionsAt("ticket list --", 14, context);
  const flags = result.candidates.map((c) => c.value);
  check("a `--` position offers flags", result.position === "flag" && flags.includes("--status") && flags.includes("--assignee"), `${result.position} ${flags.slice(0, 5).join(",")}`);
}

{
  const result = completionsAt("ticket list --status ", 21, context);
  const values = result.candidates.map((c) => c.value);
  // The board's real statuses, not a made-up `open`: `--status open` would return nothing, and
  // completion offering it would be an invitation to an empty table.
  check("after a flag that takes an enum, the enum is offered", result.position === "value" && values.includes("new") && values.includes("closed"), `${result.position} ${values.join(",")}`);
}

{
  // Completing in the middle of a line replaces the word under the cursor, not everything after it.
  const word = wordAtCursor("ticket list --status open", 9);
  check("the word under the cursor is found", word.prefix === "list" && word.start === 7 && word.end === 11, JSON.stringify(word));
}

{
  check("the longest common prefix is what Tab inserts first", longestCommonPrefix(["in_progress", "in_review"]) === "in_", longestCommonPrefix(["in_progress", "in_review"]));
  check("one candidate is its own prefix", longestCommonPrefix(["ticket"]) === "ticket");
}

// ── History prediction ─────────────────────────────────────────────────
{
  const history = ["client list", "ticket list --status open --limit 50", "client show northwind"];
  check("prediction continues a line you have run", predictionFor("ticket l", history) === "ticket list --status open --limit 50", String(predictionFor("ticket l", history)));
  check("prediction offers nothing for a line you have not run", predictionFor("ticket show 9", history) === null);
  check("history matches walk the newest first", historyMatches("client", history)[0] === "client show northwind", historyMatches("client", history).join(" | "));
}

// ── Subject resolution, including the dangerous case ───────────────────
/** A list route stub: it applies the search parameter the way the real route does. */
function listStub(rows: Record<string, unknown>[], searchParam?: string) {
  return async (_path: string, query: Record<string, string>) => {
    const needle = searchParam ? (query[searchParam] ?? "").toLowerCase() : "";
    const filtered = needle
      ? rows.filter((row) => Object.values(row).some((value) => String(value).toLowerCase().includes(needle)))
      : rows;
    return { data: filtered };
  };
}

{
  const ticket: ConsoleCommandSpec = CONSOLE_COMMANDS.find((c) => c.name === "ticket show")!;
  const rows = [
    { id: "1", ticketNumber: "MSP-1001-1009", title: "Laptop will not boot" },
    { id: "2", ticketNumber: "MSP-1001-1010", title: "New starter" },
  ];
  const stub = listStub(rows, "search");

  const resolved = await resolveSubject(ticket, "MSP-1001-1009", stub);
  check("one match resolves to its id", resolved.ok && resolved.resolution.id === "1", JSON.stringify(resolved));

  const none = await resolveSubject(ticket, "MSP-9999", stub);
  check("no match is not found", !none.ok && none.code === CONSOLE_EXIT.notFound, JSON.stringify(none));
}

{
  const client: ConsoleCommandSpec = CONSOLE_COMMANDS.find((c) => c.name === "client show")!;
  const rows = [
    { id: "1", name: "Northwind Traders", shortName: "northwind" },
    { id: "2", name: "Northwind Logistics", shortName: "northwind-log" },
  ];
  const stub = listStub(rows, "search");

  // Both names contain "northwin": the console must refuse rather than pick one.
  const ambiguous = await resolveSubject(client, "northwin", stub);
  check("an ambiguous subject is an error, never a choice", !ambiguous.ok && ambiguous.code === CONSOLE_EXIT.notFound && /be specific/.test(ambiguous.message), JSON.stringify(ambiguous));

  const byShortName = await resolveSubject(client, "northwind-log", stub);
  check("an exact short name proceeds", byShortName.ok && byShortName.resolution.id === "2", JSON.stringify(byShortName));
}

{
  // The list route is scoped, so a record the caller cannot see is "not found" — never "forbidden".
  const client: ConsoleCommandSpec = CONSOLE_COMMANDS.find((c) => c.name === "client show")!;
  const hidden = await resolveSubject(client, "acme", async () => ({ data: [] }));
  check("a record you may not see is not found", !hidden.ok && hidden.code === CONSOLE_EXIT.notFound, JSON.stringify(hidden));
}

// ── Rows, whatever shape a route returns ───────────────────────────────
{
  check("rows are found in a bare array", rowsOf([{ a: 1 }]).length === 1);
  check("rows are found under `data`", rowsOf({ data: [{ a: 1 }] }).length === 1);
  check("a single record has no rows", rowsOf({ id: "1" }).length === 0);
}

// ── The catalogue itself ───────────────────────────────────────────────
{
  check("every command has a distinct name", new Set(CONSOLE_COMMANDS.map((c) => c.name)).size === CONSOLE_COMMANDS.length);
  check("every command carries a description", CONSOLE_COMMANDS.every((c) => Boolean(c.description)));
  check("every command's path is absolute-relative", CONSOLE_COMMANDS.every((c) => c.path.startsWith("/")));
  const permitted = permittedCommands([]);
  check("a caller with no permissions still gets the permission-free commands", permitted.length > 0 && permitted.every((c) => c.permission === null), `${permitted.length}`);
  check("every command offers at least one flag", CONSOLE_COMMANDS.every((c) => flagsFor(c).length > 0));
}

console.log(`probe-console-grammar: ${passed} passed, ${failures.length} failed`);
if (failures.length) {
  for (const failure of failures) console.error(`  ✗ ${failure}`);
  process.exit(1);
}
