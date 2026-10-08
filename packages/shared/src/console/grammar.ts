/**
 * The console grammar: `<noun> <verb> [subject] [--flag value] [--flag]`.
 *
 * This file is the *lexer* — it turns a line into tokens and a line into statements — and nothing
 * else. It knows no nouns, no verbs and no routes: which command a token belongs to is
 * `catalogue.ts`'s question, and what it does is the route's. Keeping the split means the grammar can
 * be tested against a table of strings with no API, no session and no catalogue in the way.
 *
 * Deliberately absent, and not to be added later: pipes, redirection, `&&`, variables, arithmetic,
 * functions, file system access. `;` runs two commands in order and stops at the first failure, and
 * that is the whole of the language (PLAN-028 §5).
 */

export interface ConsoleToken {
  /** The token's text, with quotes removed. */
  value: string;
  /** Index of the token's first character in the line. */
  start: number;
  /** Index one past the token's last character in the line (quotes included). */
  end: number;
  quoted: boolean;
}

/** The exit codes the console and the CLI share (PLAN-028 §9). */
export const CONSOLE_EXIT = {
  ok: 0,
  /** Unknown command, bad flags, or a usage error — nothing was attempted. */
  usage: 1,
  /** Refused: you do not have the permission. */
  refused: 2,
  /** Not found, or ambiguous — nothing was attempted. */
  notFound: 3,
  /** Needs a confirmation a non-interactive session cannot give. */
  confirmation: 4,
  /** Refused by policy: not offered in the console at all. */
  policy: 5,
  /** The API ran it and it failed — the route's own message, printed verbatim. */
  failed: 6,
} as const;

export type ConsoleExitCode = (typeof CONSOLE_EXIT)[keyof typeof CONSOLE_EXIT];

/** One statement's tokens, or the reason the line could not be read. */
export type TokenizeResult =
  | { ok: true; tokens: ConsoleToken[] }
  | { ok: false; code: ConsoleExitCode; message: string };

function isSpace(ch: string): boolean {
  return ch === " " || ch === "\t";
}

/**
 * Split a line into tokens, honouring double and single quotes.
 *
 * A `#` is a comment only where the plan says it is — at the start of the line — so a `#` inside a
 * value (`--subject "Ticket #42"`) is a character, not the start of a comment. An unterminated quote
 * is an error rather than a guess: the alternative is executing a line the person did not write.
 */
export function tokenize(line: string): TokenizeResult {
  const tokens: ConsoleToken[] = [];
  let i = 0;

  while (i < line.length) {
    while (i < line.length && isSpace(line[i] ?? "")) i++;
    if (i >= line.length) break;

    const start = i;
    let value = "";
    let quoted = false;
    let closed = false;

    while (i < line.length && !isSpace(line[i] ?? "")) {
      const ch = line[i] ?? "";
      if (ch === '"' || ch === "'") {
        const closing = line.indexOf(ch, i + 1);
        if (closing === -1) {
          return {
            ok: false,
            code: CONSOLE_EXIT.usage,
            message: `Unterminated ${ch === '"' ? "double" : "single"} quote.`,
          };
        }
        value += line.slice(i + 1, closing);
        quoted = true;
        closed = true;
        i = closing + 1;
        continue;
      }
      value += ch;
      i++;
    }

    tokens.push({ value, start, end: i, quoted: quoted && closed });
  }

  return { ok: true, tokens };
}

/**
 * Split a line into statements on `;` and on newlines, ignoring either inside quotes.
 *
 * Newlines matter because a command file (and a paste of several lines) is input too: `#` comments and
 * blank lines then mean what §5 says they mean, and a script is a list of statements rather than one
 * very long line.
 */
export function splitStatements(line: string): string[] {
  const statements: string[] = [];
  let current = "";
  let quote: string | null = null;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (quote) {
      if (ch === quote) quote = null;
      current += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === ";") {
      statements.push(current);
      current = "";
      continue;
    }
    if (ch === "\n") {
      statements.push(current);
      current = "";
      continue;
    }
    if (ch === "\r") continue;
    current += ch;
  }
  statements.push(current);

  return statements
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("#"));
}

/** The word under the cursor, and the span a completion would replace. */
export interface WordAtCursor {
  /** The partial word, with a leading quote removed. */
  prefix: string;
  /** Index of the first character a completion would replace. */
  start: number;
  /** Index one past the last character a completion would replace. */
  end: number;
  /** True when the word is a `--flag` being typed. */
  isFlag: boolean;
  /** True when the cursor sits in whitespace, i.e. a new word is being started. */
  atWordStart: boolean;
}

/**
 * Find the word under the cursor — not the last word on the line.
 *
 * Completing into the middle of a line is the common case when a flag was forgotten, so the span to
 * replace comes from the cursor's position and everything to the right is preserved.
 */
export function wordAtCursor(line: string, cursor: number): WordAtCursor {
  const at = Math.max(0, Math.min(cursor, line.length));

  let start = at;
  while (start > 0 && !isSpace(line[start - 1] ?? "")) start--;
  let end = at;
  while (end < line.length && !isSpace(line[end] ?? "")) end++;

  const raw = line.slice(start, end);
  const prefix = raw.replace(/^["']/, "");
  return {
    prefix,
    start,
    end,
    isFlag: prefix.startsWith("--"),
    atWordStart: raw.length === 0,
  };
}

/** Replace the word under the cursor with `replacement`, returning the new line and caret. */
export function replaceWord(
  line: string,
  word: WordAtCursor,
  replacement: string,
): { line: string; caret: number } {
  const before = line.slice(0, word.start);
  const after = line.slice(word.end);
  return { line: before + replacement + after, caret: word.start + replacement.length };
}

/** The statement containing the cursor, and the index the statement starts at. */
export function statementAtCursor(line: string, cursor: number): { statement: string; offset: number } {
  const at = Math.max(0, Math.min(cursor, line.length));
  let start = 0;
  let quote: string | null = null;

  for (let i = 0; i < at; i++) {
    const ch = line[i] ?? "";
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ";") start = i + 1;
  }

  let end = line.length;
  quote = null;
  for (let i = at; i < line.length; i++) {
    const ch = line[i] ?? "";
    if (quote) {
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; continue; }
    if (ch === ";") { end = i; break; }
  }

  return { statement: line.slice(start, end), offset: start };
}
