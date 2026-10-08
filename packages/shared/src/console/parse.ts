/**
 * Reading a line: which command it names, and whether the caller may run it.
 *
 * The parser validates against the catalogue rather than guessing, so every rejection is specific —
 * "unknown verb for `ticket` (list, show, contacts, expenses)", not "syntax error". That matters more
 * here than in most parsers, because a person typing at a console is usually typing a command they
 * half-remember, and the message is the documentation.
 */
import {
  CONSOLE_COMMANDS,
  CONSOLE_NOUNS,
  CONSOLE_OWN_VERBS,
  CONSOLE_WRITE_VERBS,
  findCommand,
  flagsFor,
  mayRun,
  verbsFor,
  type ConsoleCommandSpec,
  type ConsoleFlagSpec,
} from "./catalogue";
import { CONSOLE_EXIT, type ConsoleExitCode, splitStatements, tokenize } from "./grammar";

/** A line the console runs itself, with no route behind it. */
export interface ConsoleOwnInvocation {
  verb: string;
  args: string[];
}

/** A line that names a catalogue command, with its subject and flags read out of it. */
export interface ConsoleInvocation {
  /** The statement as typed, for history and for echoing back. */
  line: string;
  command: ConsoleCommandSpec;
  subject: string | null;
  /** Positionals after the subject, for a noun whose verb takes more than one. */
  extra: string[];
  /** Flags as given: `true` for a boolean, a string for a value. Keys are flag names without `--`. */
  flags: Record<string, string | true>;
}

export type ParseOutcome =
  | { ok: true; kind: "own"; own: ConsoleOwnInvocation; line: string }
  | { ok: true; kind: "command"; invocation: ConsoleInvocation }
  | { ok: false; code: ConsoleExitCode; message: string; hint?: string };

export interface ParseContext {
  /** The caller's permissions, used only to refuse early with a clear message. */
  permissions?: readonly string[];
  /** Per-user shorthands, applied to the first word. */
  aliases?: Record<string, string>;
}

/** Strip dashes and case so `--low-stock`, `--lowStock` and `--lowstock` are one flag. */
function flagKey(name: string): string {
  return name.replace(/-/g, "").toLowerCase();
}

/** Does a noun match what was typed, exactly or as an unambiguous prefix? */
function resolveNoun(typed: string): { noun?: string; ambiguous?: string[] } {
  const lower = typed.toLowerCase();
  const exact = CONSOLE_NOUNS.find((n) => n === lower);
  if (exact) return { noun: exact };
  const prefixed = CONSOLE_NOUNS.filter((n) => n.startsWith(lower));
  if (prefixed.length === 1) return { noun: prefixed[0] };
  return prefixed.length === 0 ? {} : { ambiguous: prefixed };
}

function resolveVerb(noun: string, typed: string, commands: readonly ConsoleCommandSpec[]): { verb?: string; ambiguous?: string[] } {
  const verbs = verbsFor(noun, commands);
  const lower = typed.toLowerCase();
  const exact = verbs.find((v) => v === lower);
  if (exact) return { verb: exact };
  const prefixed = verbs.filter((v) => v.startsWith(lower));
  if (prefixed.length === 1) return { verb: prefixed[0] };
  return prefixed.length === 0 ? {} : { ambiguous: prefixed };
}

function flagSpecFor(command: ConsoleCommandSpec, typed: string): ConsoleFlagSpec | undefined {
  const key = flagKey(typed.replace(/^--/, ""));
  return flagsFor(command).find((f) => flagKey(f.name) === key);
}

/**
 * Read one statement.
 *
 * `--flag=value` and `--flag value` are the same input; a flag the command does not accept is an
 * error rather than a silent no-op, because a flag that is quietly discarded is a command that does
 * something other than what was typed.
 */
export function parseStatement(
  statement: string,
  commands: readonly ConsoleCommandSpec[] = CONSOLE_COMMANDS,
  ctx: ParseContext = {},
): ParseOutcome {
  const catalogue = commands;
  const line = statement.trim();
  if (!line) return { ok: false, code: CONSOLE_EXIT.usage, message: "Nothing to run." };

  const aliased = applyAlias(line, ctx.aliases);
  const lexed = tokenize(aliased);
  if (!lexed.ok) return lexed;

  const tokens = lexed.tokens.map((t) => t.value);

  // The console's own verbs come first: `help` is not a noun, and never will be. `?` is its shorthand
  // (§5), so it never reaches the noun resolution below.
  const first = tokens[0] ?? "";
  const own = first === "?" ? CONSOLE_OWN_VERBS.find((v) => v.name === "help") : CONSOLE_OWN_VERBS.find((v) => v.name === first.toLowerCase());
  if (own) {
    return { ok: true, kind: "own", own: { verb: own.name, args: tokens.slice(1) }, line: aliased };
  }

  const nounMatch = resolveNoun(first);
  if (!nounMatch.noun) {
    if (nounMatch.ambiguous) {
      return {
        ok: false,
        code: CONSOLE_EXIT.usage,
        message: `\`${first}\` could be ${nounMatch.ambiguous.map((n) => `\`${n}\``).join(" or ")}.`,
        hint: "Type a little more, or `help` for the full list.",
      };
    }
    return {
      ok: false,
      code: CONSOLE_EXIT.usage,
      message: `Unknown command: \`${first}\`.`,
      hint: "`help` lists every command you may run.",
    };
  }

  const noun = nounMatch.noun;
  const nounWords = noun.split(" ").length;
  const verbToken = tokens[nounWords];
  if (!verbToken) {
    return {
      ok: false,
      code: CONSOLE_EXIT.usage,
      message: `\`${noun}\` needs a verb.`,
      hint: `Try: ${verbsFor(noun, catalogue).slice(0, 4).map((v) => `${noun} ${v}`).join(", ")}`,
    };
  }

  const verbMatch = resolveVerb(noun, verbToken, catalogue);
  if (!verbMatch.verb) {
    if (verbMatch.ambiguous) {
      return {
        ok: false,
        code: CONSOLE_EXIT.usage,
        message: `\`${verbToken}\` could be ${verbMatch.ambiguous.map((v) => `\`${v}\``).join(" or ")}.`,
      };
    }
    // A write verb that exists in the plan but not yet in the console is the one rejection worth
    // spelling out: the answer is "not yet, and here is why", not "unknown verb".
    if (CONSOLE_WRITE_VERBS.includes(verbToken.toLowerCase())) {
      return {
        ok: false,
        code: CONSOLE_EXIT.policy,
        message: `\`${noun} ${verbToken}\` is not available in the console yet.`,
        hint: "Write commands arrive with PLAN-026's action manifest; the console offers reads until then. Use the screen for now, or `help` for what you can run.",
      };
    }
    return {
      ok: false,
      code: CONSOLE_EXIT.usage,
      message: `\`${noun}\` has no verb \`${verbToken}\`.`,
      hint: `${noun} can: ${verbsFor(noun, catalogue).map((v) => `${noun} ${v}`).join(", ")}`,
    };
  }

  const command = findCommand(noun, verbMatch.verb, catalogue);
  if (!command) {
    return { ok: false, code: CONSOLE_EXIT.usage, message: `\`${noun} ${verbMatch.verb}\` is not in the catalogue.` };
  }

  // Flags and positionals, in the order typed.
  const rest = tokens.slice(nounWords + 1);
  const flags: Record<string, string | true> = {};
  const positionals: string[] = [];

  for (let i = 0; i < rest.length; i++) {
    const token = rest[i] ?? "";
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const body = token.slice(2);
    const equals = body.indexOf("=");
    const typedName = equals === -1 ? body : body.slice(0, equals);
    const inlineValue = equals === -1 ? null : body.slice(equals + 1);
    const spec = flagSpecFor(command, typedName);
    if (!spec) {
      return {
        ok: false,
        code: CONSOLE_EXIT.usage,
        message: `\`${command.name}\` has no flag \`--${typedName}\`.`,
        hint: `Flags: ${flagsFor(command).map((f) => `--${f.name}`).join(", ")}`,
      };
    }

    if (inlineValue !== null) {
      flags[spec.name] = inlineValue;
      continue;
    }
    if (spec.type === "boolean") {
      flags[spec.name] = true;
      continue;
    }
    const next = rest[i + 1];
    if (next === undefined || next.startsWith("--")) {
      return { ok: false, code: CONSOLE_EXIT.usage, message: `\`--${spec.name}\` needs a value.` };
    }
    flags[spec.name] = next;
    i++;
  }

  const subject = positionals[0] ?? null;
  if (command.subject?.required && subject === null) {
    return {
      ok: false,
      code: CONSOLE_EXIT.usage,
      message: `\`${command.name}\` needs a ${command.subject.label.toLowerCase()}.`,
      hint: `Try: ${command.name} ${command.subject.values?.[0] ?? "1001"}`,
    };
  }
  if (command.subject?.values && subject !== null && !command.subject.values.includes(subject)) {
    return {
      ok: false,
      code: CONSOLE_EXIT.notFound,
      message: `No report named \`${subject}\`.`,
      hint: `Available: ${command.subject.values.join(", ")}`,
    };
  }
  if (!command.subject && subject !== null) {
    return {
      ok: false,
      code: CONSOLE_EXIT.usage,
      message: `\`${command.name}\` takes no subject.`,
    };
  }

  if (ctx.permissions && !mayRun(command, ctx.permissions)) {
    return {
      ok: false,
      code: CONSOLE_EXIT.refused,
      message: `\`${command.name}\` needs \`${command.permission}\`, which your account does not have.`,
      hint: "The route enforces this; the console is only telling you before you try.",
    };
  }

  return {
    ok: true,
    kind: "command",
    invocation: { line: aliased, command, subject, extra: positionals.slice(1), flags },
  };
}

/** Expand a leading alias: `t list --status open` with `t=ticket` becomes `ticket list --status open`. */
function applyAlias(line: string, aliases: Record<string, string> | undefined): string {
  if (!aliases) return line;
  const space = line.search(/\s/);
  const head = space === -1 ? line : line.slice(0, space);
  const tail = space === -1 ? "" : line.slice(space);
  const expansion = aliases[head] ?? aliases[head.toLowerCase()];
  return expansion ? `${expansion}${tail}` : line;
}

/**
 * Read every statement on a line. `;` runs them in order and stops at the first failure (PLAN-028 §5),
 * so the caller runs statements one at a time rather than planning the whole line up front.
 */
export function parseLine(line: string, commands: readonly ConsoleCommandSpec[], ctx: ParseContext = {}): ParseOutcome[] {
  return splitStatements(line).map((statement) => parseStatement(statement, commands, ctx));
}
