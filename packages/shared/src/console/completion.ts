/**
 * Completion: what could come next, at the cursor.
 *
 * This file answers *what the candidates are* and nothing about keys — `Tab` cycling, the
 * `Ctrl+Space` menu, ghost-text prediction and `?` are the surface's business, and they differ
 * between the browser and a terminal. Keeping the candidate list here is what lets the CLI, the
 * in-app console and a future editor integration agree about what a half-typed command could become
 * (PLAN-028 §5.1).
 *
 * Everything local resolves with no I/O: nouns, verbs and flags come from the catalogue. Values that
 * need the application (`--client`, `--assignee`) are passed in as `values`, already fetched and
 * cached by the caller — completion never makes a request per keystroke, which is the one rule §5.1
 * states twice.
 */
import {
  CONSOLE_GROUPS,
  CONSOLE_NOUNS,
  CONSOLE_OWN_VERBS,
  CONSOLE_VALUE_SOURCES,
  findCommand,
  flagsFor,
  type ConsoleCommandSpec,
  type ConsoleFlagSpec,
  type ConsoleValueSourceId,
} from "./catalogue";
import { statementAtCursor, tokenize, wordAtCursor, type WordAtCursor } from "./grammar";

export type ConsoleCandidateKind = "noun" | "verb" | "flag" | "value" | "own" | "alias" | "subject";

export interface ConsoleCandidate {
  /** What replaces the word under the cursor. */
  value: string;
  /** What is shown in the menu — usually the value, sometimes with arguments appended. */
  label: string;
  /** One line of help, shown beside the candidate. */
  description?: string;
  kind: ConsoleCandidateKind;
  /** A flag that takes a value gets a trailing space instead of a space-and-stop. */
  takesValue?: boolean;
}

export interface CompletionContext {
  commands: readonly ConsoleCommandSpec[];
  /** Aliases the person has defined, offered as first words. */
  aliases?: Record<string, string>;
  /** Live record candidates, keyed by the flag or subject they belong to. */
  values?: Record<string, ConsoleCandidate[]>;
}

export interface CompletionResult {
  word: WordAtCursor;
  candidates: ConsoleCandidate[];
  /** What the console thinks is being typed, for the help line under the prompt. */
  position: "noun" | "verb" | "subject" | "flag" | "value";
  /** The command the line has resolved to so far, if any. */
  command?: ConsoleCommandSpec;
  /** The flag whose value is being completed, if any. */
  flag?: ConsoleFlagSpec;
}

/** Every noun the caller may run at least one verb of, alphabetical. */
function permittedNouns(commands: readonly ConsoleCommandSpec[]): string[] {
  const nouns = new Set(commands.map((c) => c.noun));
  return [...nouns].sort((a, b) => a.localeCompare(b));
}

/** A noun's verbs, with their descriptions. */
function verbCandidates(noun: string, commands: readonly ConsoleCommandSpec[]): ConsoleCandidate[] {
  return commands
    .filter((c) => c.noun === noun)
    .map((c) => ({
      value: c.verb,
      label: `${c.noun} ${c.verb}`,
      description: c.description,
      kind: "verb" as const,
    }));
}

/** The value candidates for a flag or a subject: a closed set, or whatever the caller fetched. */
function valueCandidates(
  name: string,
  spec: { values?: readonly string[]; from?: ConsoleValueSourceId } | undefined,
  values: Record<string, ConsoleCandidate[]> | undefined,
): ConsoleCandidate[] {
  if (spec?.values?.length) {
    return spec.values.map((v) => ({ value: v, label: v, kind: "value" as const }));
  }
  return values?.[name] ?? [];
}

/**
 * Candidates for the word under the cursor.
 *
 * Position rules from §5.1: the first word completes nouns (and the console's own verbs); the second
 * the verb for that noun; then the subject, then flags; and after a flag that takes a value, the
 * values — never another flag, so a mistyped value cannot silently become a flag.
 */
export function completionsAt(
  line: string,
  cursor: number,
  ctx: CompletionContext,
): CompletionResult {
  const { statement, offset } = statementAtCursor(line, cursor);
  const word = wordAtCursor(line, cursor);
  const localCursor = Math.max(0, Math.min(cursor - offset, statement.length));

  // Tokenise the statement up to the word being completed, so the position is unambiguous.
  const before = statement.slice(0, localCursor);
  const lexed = tokenize(before.replace(/\s+$/, ""));
  const tokens = lexed.ok ? lexed.tokens.map((t) => t.value) : [];
  const wordIsEmpty = before.trim() !== before || // the cursor sits after a space
    localCursor === 0 ||
    (statement[localCursor - 1] === " ");

  // A trailing space means a new word is starting, so the finished tokens are all "before".
  const settled = wordIsEmpty ? tokens : tokens.slice(0, -1);
  const nouns = permittedNouns(ctx.commands);

  // ── Flag values ────────────────────────────────────────────────────
  // `--status <Tab>` completes the values the flag takes, not the next flag.
  const previous = settled[settled.length - 1];
  if (previous?.startsWith("--")) {
    const command = commandAt(settled, ctx.commands);
    const spec = command ? flagByName(command, previous) : undefined;
    if (spec && spec.type !== "boolean") {
      return {
        word,
        position: "value",
        command,
        flag: spec,
        candidates: valueCandidates(spec.name, spec, ctx.values),
      };
    }
  }

  // ── Flags ──────────────────────────────────────────────────────────
  if (word.prefix.startsWith("--")) {
    const command = commandAt(settled, ctx.commands);
    const used = new Set(settled.filter((t) => t.startsWith("--")).map((t) => t.replace(/^--/, "")));
    const candidates = command
      ? flagsFor(command)
        .filter((f) => !used.has(f.name))
        .map((f) => ({
          value: `--${f.name}`,
          label: `--${f.name}`,
          description: f.help,
          kind: "flag" as const,
          takesValue: f.type !== "boolean",
        }))
      : [];
    return { word, position: "flag", command, candidates };
  }

  // ── The first word: nouns and the console's own verbs ──────────────
  if (settled.length === 0) {
    const own = CONSOLE_OWN_VERBS.map((v) => ({
      value: v.name,
      label: v.name,
      description: v.summary,
      kind: "own" as const,
    }));
    const aliasCandidates = Object.keys(ctx.aliases ?? {}).map((word) => ({
      value: word,
      label: word,
      description: `alias → ${ctx.aliases?.[word] ?? ""}`,
      kind: "alias" as const,
    }));
    return {
      word,
      position: "noun",
      candidates: [
        ...nouns.map((n) => ({
          value: n,
          label: n,
          description: nounDescription(n, ctx.commands),
          kind: "noun" as const,
        })),
        ...own,
        ...aliasCandidates,
      ],
    };
  }

  // ── The second word: the verb ──────────────────────────────────────
  const noun = settled[0] ?? "";
  const known = CONSOLE_NOUNS.includes(noun.toLowerCase());
  if (settled.length === 1 && known) {
    return { word, position: "verb", candidates: verbCandidates(noun.toLowerCase(), ctx.commands) };
  }

  // ── The subject, then more flags ───────────────────────────────────
  const command = commandAt(settled, ctx.commands);
  if (command?.subject && settled.length === 2 + (command.noun.split(" ").length - 1)) {
    return {
      word,
      position: "subject",
      command,
      candidates: valueCandidates("subject", command.subject, ctx.values),
    };
  }

  return {
    word,
    position: "flag",
    command,
    candidates: command
      ? flagsFor(command)
        .filter((f) => !settled.includes(`--${f.name}`))
        .map((f) => ({
          value: `--${f.name}`,
          label: `--${f.name}`,
          description: f.help,
          kind: "flag" as const,
          takesValue: f.type !== "boolean",
        }))
      : [],
  };
}

/** The command the settled words name, if they name one. */
function commandAt(settled: readonly string[], commands: readonly ConsoleCommandSpec[]): ConsoleCommandSpec | undefined {
  const first = settled[0]?.toLowerCase();
  if (!first) return undefined;
  const noun = CONSOLE_NOUNS.find((n) => n === first) ?? CONSOLE_NOUNS.find((n) => n.startsWith(first) && !n.includes(" "));
  if (!noun) return undefined;
  const words = noun.split(" ").length;
  const verb = settled[words]?.toLowerCase();
  if (!verb) return undefined;
  return commands.find((c) => c.noun === noun && c.verb.startsWith(verb));
}

function flagByName(command: ConsoleCommandSpec, typed: string): ConsoleFlagSpec | undefined {
  const key = typed.replace(/^--/, "").replace(/-/g, "").toLowerCase();
  return flagsFor(command).find((f) => f.name.replace(/-/g, "").toLowerCase() === key);
}

/** The first line of a noun's own summary, for the noun list in the menu. */
function nounDescription(noun: string, commands: readonly ConsoleCommandSpec[]): string {
  const verbs = commands.filter((c) => c.noun === noun).map((c) => c.verb);
  const group = CONSOLE_GROUPS.find((g) => g.id === commands.find((c) => c.noun === noun)?.group);
  return `${group?.label ?? ""} · ${verbs.join(", ")}`.replace(/^ · /, "");
}

/**
 * The longest common prefix of the candidates, which is what the first `Tab` inserts (§5.1).
 *
 * This is the behaviour that makes cycling usable: the first press extends to what is certain, and
 * only later presses start choosing between alternatives.
 */
export function longestCommonPrefix(values: readonly string[]): string {
  const first = values[0];
  if (first === undefined) return "";
  let prefix = first;
  for (const value of values.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < value.length && prefix[i] === value[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) break;
  }
  return prefix;
}

/** Candidates whose value starts with what has been typed, case-insensitively, in a stable order. */
export function matchingCandidates(candidates: readonly ConsoleCandidate[], prefix: string): ConsoleCandidate[] {
  const lower = prefix.toLowerCase();
  return candidates.filter((c) => c.value.toLowerCase().startsWith(lower));
}

/**
 * The rest of the line from your own history, as the inline prediction §5.1 asks for.
 *
 * Only the caller's own lines, and only a line that starts with exactly what has been typed — a
 * prediction that rewrites what you meant is worse than no prediction.
 */
export function predictionFor(line: string, history: readonly string[]): string | null {
  if (!line.trim()) return null;
  for (let i = history.length - 1; i >= 0; i--) {
    const candidate = history[i] ?? "";
    if (candidate.length > line.length && candidate.startsWith(line)) return candidate;
  }
  return null;
}

/** History lines starting with a prefix, newest first — what `↑` browses after typing. */
export function historyMatches(prefix: string, history: readonly string[], limit = 20): string[] {
  const lower = prefix.toLowerCase();
  const out: string[] = [];
  for (let i = history.length - 1; i >= 0 && out.length < limit; i--) {
    const candidate = history[i] ?? "";
    if (!prefix || candidate.toLowerCase().startsWith(lower)) out.push(candidate);
  }
  return out;
}

/**
 * The live value sources completion needs, and the query each one is fetched with.
 *
 * Exported so the surface can warm them in one pass when the console opens rather than fetching per
 * keystroke, and so the CLI can do the same with its own HTTP client.
 */
export const CONSOLE_COMPLETION_SOURCES = CONSOLE_VALUE_SOURCES;

/** The subject lookup a command's subject position completes from, if it has one. */
export function subjectSource(command: ConsoleCommandSpec): { path: string; searchParam?: string } | null {
  if (command.subject?.values?.length) return null;
  const lookup = command.subject?.lookup;
  return lookup ? { path: lookup.path, ...(lookup.searchParam ? { searchParam: lookup.searchParam } : {}) } : null;
}
