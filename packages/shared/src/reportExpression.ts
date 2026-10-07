/**
 * The report expression language (PLAN-020).
 *
 * A report template is data typed by a user, so the expressions inside it are never handed to
 * `eval`, `new Function` or a template engine — they are tokenised, parsed into a fixed AST and
 * walked by this interpreter. The grammar has no member access on arbitrary objects, no assignment,
 * no loops and no way to name anything that is not in the evaluation context, so an expression
 * cannot reach the filesystem, the network, the database or the module system.
 *
 * Grammar (in binding order, weakest first):
 *
 *     or      := and ( OR and )*
 *     and     := not ( AND not )*
 *     not     := NOT not | comparison
 *     compare := additive ( ( = | == | != | <> | < | <= | > | >= | IN list | LIKE ) additive )?
 *     additive:= multiplicative ( ( + | - ) multiplicative )*
 *     multi   := unary ( ( * | / | % ) unary )*
 *     unary   := ( - | + ) unary | primary
 *     primary := number | string | TRUE | FALSE | NULL | call | path | ( or ) | list
 *     path    := ident ( "." ident )*
 *
 * Every context value is read through a namespace — `Fields`, `Parameters`, `Report`, `Page`,
 * `Group`, `DataSources` — and a bare name is looked up in `Fields` and then `Parameters`, so a
 * designer can write `Fields.total` or `total`.
 */

export type BinaryOp = "+" | "-" | "*" | "/" | "%" | "=" | "!=" | "<" | "<=" | ">" | ">=" | "AND" | "OR" | "LIKE";

export type Expr =
  | { kind: "number"; value: number }
  | { kind: "string"; value: string }
  | { kind: "boolean"; value: boolean }
  | { kind: "null" }
  | { kind: "path"; parts: string[] }
  | { kind: "call"; name: string; args: Expr[] }
  | { kind: "unary"; op: "-" | "NOT"; arg: Expr }
  | { kind: "binary"; op: BinaryOp; left: Expr; right: Expr }
  | { kind: "in"; left: Expr; list: Expr[] };

export type AggregateFunction = "SUM" | "AVG" | "MIN" | "MAX" | "COUNT" | "COUNTD";
export type AggregateScope = "report" | "group" | "page";

export const AGGREGATE_FUNCTIONS: AggregateFunction[] = ["SUM", "AVG", "MIN", "MAX", "COUNT", "COUNTD"];
export const AGGREGATE_SCOPES: AggregateScope[] = ["report", "group", "page"];

export interface ExpressionContext {
  fields: Record<string, unknown>;
  parameters: Record<string, unknown>;
  report?: Record<string, unknown>;
  page?: Record<string, unknown>;
  group?: Record<string, unknown> | null;
  /** Injected by the layout engine, which is the only thing that knows which rows a scope covers. */
  aggregate?: (request: { fn: AggregateFunction; path: string; scope: AggregateScope }) => unknown;
  /** Resolves a path in another declared data source, for `DataSources.key.field`. */
  dataSource?: (key: string, path: string) => unknown;
}

// ── Tokeniser ───────────────────────────────────────────────────────

type TokenType = "number" | "string" | "ident" | "op" | "eof";
interface Token { type: TokenType; value: string; pos: number; numberValue?: number }

const OPERATORS = ["<=", ">=", "!=", "<>", "==", "&&", "||", "=", "<", ">", "+", "-", "*", "/", "%", "(", ")", ","];

export class ExpressionError extends Error {
  position: number | undefined;
  constructor(message: string, position?: number) {
    super(message);
    this.name = "ExpressionError";
    this.position = position;
  }
}

function tokenise(source: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    if (/\s/.test(c)) { i++; continue; }
    if (c === "'" || c === '"') {
      const quote = c;
      let text = "";
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) { text += source[i + 1]; i += 2; continue; }
        text += source[i];
        i++;
      }
      if (i >= source.length) throw new ExpressionError(`Unterminated text — a ${quote === "'" ? "single" : "double"} quote was opened and never closed`, i);
      i++;
      tokens.push({ type: "string", value: text, pos: i });
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(source[i + 1] ?? ""))) {
      let text = "";
      const start = i;
      while (i < source.length && /[0-9.]/.test(source[i]!)) { text += source[i]; i++; }
      const value = Number(text);
      if (!Number.isFinite(value)) throw new ExpressionError(`"${text}" is not a number`, start);
      tokens.push({ type: "number", value: text, numberValue: value, pos: start });
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let text = "";
      const start = i;
      while (i < source.length && /[A-Za-z0-9_.]/.test(source[i]!)) { text += source[i]; i++; }
      tokens.push({ type: "ident", value: text, pos: start });
      continue;
    }
    const op = OPERATORS.find(o => source.startsWith(o, i));
    if (op) { tokens.push({ type: "op", value: op, pos: i }); i += op.length; continue; }
    throw new ExpressionError(`Unexpected character "${c}"`, i);
  }
  tokens.push({ type: "eof", value: "", pos: source.length });
  return tokens;
}

// ── Parser ──────────────────────────────────────────────────────────

class Parser {
  private index = 0;
  constructor(private readonly tokens: Token[], private readonly source: string) {}

  private peek(): Token { return this.tokens[this.index]!; }
  private next(): Token { return this.tokens[this.index++]!; }
  private atKeyword(word: string): boolean {
    const token = this.peek();
    return token.type === "ident" && token.value.toUpperCase() === word;
  }
  private matchOperator(...values: string[]): Token | null {
    const token = this.peek();
    if (token.type === "op" && values.includes(token.value)) return this.next();
    return null;
  }
  private matchKeyword(...words: string[]): Token | null {
    if (this.peek().type === "ident" && words.includes(this.peek().value.toUpperCase())) return this.next();
    return null;
  }

  parse(): Expr {
    const expression = this.parseOr();
    const token = this.peek();
    if (token.type !== "eof") throw new ExpressionError(`Unexpected "${token.value}" — the expression ends before this point`, token.pos);
    return expression;
  }

  private parseOr(): Expr {
    let left = this.parseAnd();
    for (;;) {
      if (this.matchKeyword("OR") || this.matchOperator("||")) left = { kind: "binary", op: "OR", left, right: this.parseAnd() };
      else return left;
    }
  }

  private parseAnd(): Expr {
    let left = this.parseNot();
    for (;;) {
      if (this.matchKeyword("AND") || this.matchOperator("&&")) left = { kind: "binary", op: "AND", left, right: this.parseNot() };
      else return left;
    }
  }

  private parseNot(): Expr {
    if (this.matchKeyword("NOT")) return { kind: "unary", op: "NOT", arg: this.parseNot() };
    return this.parseComparison();
  }

  private parseComparison(): Expr {
    const left = this.parseAdditive();
    const op = this.matchOperator("=", "==", "!=", "<>", "<", "<=", ">", ">=");
    if (op) {
      const normalised: BinaryOp = op.value === "==" ? "=" : op.value === "<>" ? "!=" : (op.value as BinaryOp);
      return { kind: "binary", op: normalised, left, right: this.parseAdditive() };
    }
    if (this.matchKeyword("IN")) return { kind: "in", left, list: this.parseList() };
    if (this.matchKeyword("LIKE")) return { kind: "binary", op: "LIKE", left, right: this.parseAdditive() };
    return left;
  }

  /** The parenthesised list half of `x IN (a, b, c)`, or a single value for `x IN a`. */
  private parseList(): Expr[] {
    if (this.matchOperator("(")) {
      const items: Expr[] = [];
      if (!this.matchOperator(")")) {
        do { items.push(this.parseOr()); } while (this.matchOperator(","));
        const close = this.matchOperator(")");
        if (!close) throw new ExpressionError("A list opened with \"(\" was never closed", this.peek().pos);
      }
      return items;
    }
    return [this.parseAdditive()];
  }

  private parseAdditive(): Expr {
    let left = this.parseMultiplicative();
    for (;;) {
      const op = this.matchOperator("+", "-");
      if (!op) return left;
      left = { kind: "binary", op: op.value as BinaryOp, left, right: this.parseMultiplicative() };
    }
  }

  private parseMultiplicative(): Expr {
    let left = this.parseUnary();
    for (;;) {
      const op = this.matchOperator("*", "/", "%");
      if (!op) return left;
      left = { kind: "binary", op: op.value as BinaryOp, left, right: this.parseUnary() };
    }
  }

  private parseUnary(): Expr {
    const op = this.matchOperator("-", "+");
    if (op) return op.value === "-" ? { kind: "unary", op: "-", arg: this.parseUnary() } : this.parseUnary();
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.next();
    if (token.type === "number") return { kind: "number", value: token.numberValue! };
    if (token.type === "string") return { kind: "string", value: token.value };
    if (token.type === "op" && token.value === "(") {
      const inner = this.parseOr();
      const close = this.matchOperator(")");
      if (!close) throw new ExpressionError('A "(" was never closed', token.pos);
      return inner;
    }
    if (token.type === "op") throw new ExpressionError(`"${token.value}" cannot start an expression`, token.pos);
    if (token.type === "eof") throw new ExpressionError("The expression is empty or ends early", token.pos);

    const upper = token.value.toUpperCase();
    if (upper === "TRUE") return { kind: "boolean", value: true };
    if (upper === "FALSE") return { kind: "boolean", value: false };
    if (upper === "NULL" || upper === "NOTHING") return { kind: "null" };

    if (this.peek().type === "op" && this.peek().value === "(") {
      this.next();
      const args: Expr[] = [];
      if (!this.matchOperator(")")) {
        do { args.push(this.parseOr()); } while (this.matchOperator(","));
        const close = this.matchOperator(")");
        if (!close) throw new ExpressionError(`The call to ${token.value.toUpperCase()} was never closed`, token.pos);
      }
      return { kind: "call", name: upper, args };
    }

    const parts = token.value.split(".").filter(Boolean);
    if (!parts.length) throw new ExpressionError(`"${token.value}" is not a value this report can read`, token.pos);
    return { kind: "path", parts };
  }
}

/** Parses an expression, returning either its AST or a message a designer can act on. */
export function parseExpression(source: string): { ast: Expr | null; error: string | null } {
  const text = String(source ?? "").trim();
  if (!text) return { ast: null, error: "The expression is empty" };
  try {
    return { ast: new Parser(tokenise(text), text).parse(), error: null };
  } catch (e) {
    return { ast: null, error: e instanceof Error ? e.message : String(e) };
  }
}

// ── Function registry ───────────────────────────────────────────────

export interface FunctionSpec {
  name: string;
  category: "Aggregate" | "Math" | "Text" | "Date" | "Logical" | "Format" | "Value";
  signature: string;
  description: string;
  minArgs: number;
  maxArgs: number;
  /** The first argument must name a field, because the aggregate is computed over a row set. */
  pathArg?: boolean;
  /** Accepts a second argument naming the scope: report, group or page. */
  scopeArg?: boolean;
}

export const FUNCTIONS: FunctionSpec[] = [
  { name: "SUM", category: "Aggregate", signature: "SUM(field, scope?)", description: "Adds a field across the report, the current group or the current page.", minArgs: 1, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "AVG", category: "Aggregate", signature: "AVG(field, scope?)", description: "The mean of a field's values that are numbers.", minArgs: 1, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "MIN", category: "Aggregate", signature: "MIN(field, scope?)", description: "The lowest value of a field.", minArgs: 1, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "MAX", category: "Aggregate", signature: "MAX(field, scope?)", description: "The highest value of a field.", minArgs: 1, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "COUNT", category: "Aggregate", signature: "COUNT(field?, scope?)", description: "Counts rows, or the rows where a field has a value.", minArgs: 0, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "COUNTD", category: "Aggregate", signature: "COUNTD(field, scope?)", description: "Counts the distinct values of a field.", minArgs: 1, maxArgs: 2, pathArg: true, scopeArg: true },
  { name: "ROUND", category: "Math", signature: "ROUND(value, digits?)", description: "Rounds a number, optionally to a number of decimal places.", minArgs: 1, maxArgs: 2 },
  { name: "ABS", category: "Math", signature: "ABS(value)", description: "The value without its sign.", minArgs: 1, maxArgs: 1 },
  { name: "CEIL", category: "Math", signature: "CEIL(value)", description: "Rounds up to a whole number.", minArgs: 1, maxArgs: 1 },
  { name: "FLOOR", category: "Math", signature: "FLOOR(value)", description: "Rounds down to a whole number.", minArgs: 1, maxArgs: 1 },
  { name: "SQRT", category: "Math", signature: "SQRT(value)", description: "The square root of a number.", minArgs: 1, maxArgs: 1 },
  { name: "POWER", category: "Math", signature: "POWER(value, exponent)", description: "A number raised to a power.", minArgs: 2, maxArgs: 2 },
  { name: "MOD", category: "Math", signature: "MOD(value, divisor)", description: "The remainder after dividing.", minArgs: 2, maxArgs: 2 },
  { name: "PERCENT", category: "Math", signature: "PERCENT(value, total)", description: "A share of a total, as a number of percent.", minArgs: 2, maxArgs: 2 },
  { name: "UPPER", category: "Text", signature: "UPPER(text)", description: "A value in capitals.", minArgs: 1, maxArgs: 1 },
  { name: "LOWER", category: "Text", signature: "LOWER(text)", description: "A value in lower case.", minArgs: 1, maxArgs: 1 },
  { name: "PROPER", category: "Text", signature: "PROPER(text)", description: "A value with each word capitalised.", minArgs: 1, maxArgs: 1 },
  { name: "TRIM", category: "Text", signature: "TRIM(text)", description: "A value without leading or trailing spaces.", minArgs: 1, maxArgs: 1 },
  { name: "LEFT", category: "Text", signature: "LEFT(text, count)", description: "The first characters of a value.", minArgs: 2, maxArgs: 2 },
  { name: "RIGHT", category: "Text", signature: "RIGHT(text, count)", description: "The last characters of a value.", minArgs: 2, maxArgs: 2 },
  { name: "MID", category: "Text", signature: "MID(text, start, count)", description: "Characters from the middle of a value. The first character is 1.", minArgs: 3, maxArgs: 3 },
  { name: "LEN", category: "Text", signature: "LEN(text)", description: "How many characters a value has.", minArgs: 1, maxArgs: 1 },
  { name: "CONCAT", category: "Text", signature: "CONCAT(part, …)", description: "Joins values end to end.", minArgs: 1, maxArgs: -1 },
  { name: "REPLACE", category: "Text", signature: "REPLACE(text, find, with)", description: "Replaces every occurrence of one piece of text with another.", minArgs: 3, maxArgs: 3 },
  { name: "COALESCE", category: "Logical", signature: "COALESCE(value, fallback, …)", description: "The first value that is not empty.", minArgs: 1, maxArgs: -1 },
  { name: "IF", category: "Logical", signature: "IF(condition, whenTrue, whenFalse)", description: "Chooses between two values.", minArgs: 2, maxArgs: 3 },
  { name: "ISNULL", category: "Logical", signature: "ISNULL(value)", description: "True when a value is empty or missing.", minArgs: 1, maxArgs: 1 },
  { name: "ISEMPTY", category: "Logical", signature: "ISEMPTY(text)", description: "True when a value is missing or has no characters.", minArgs: 1, maxArgs: 1 },
  { name: "NOW", category: "Date", signature: "NOW()", description: "The date and time this report is generated.", minArgs: 0, maxArgs: 0 },
  { name: "TODAY", category: "Date", signature: "TODAY()", description: "Today's date.", minArgs: 0, maxArgs: 0 },
  { name: "YEAR", category: "Date", signature: "YEAR(date)", description: "The year of a date.", minArgs: 1, maxArgs: 1 },
  { name: "MONTH", category: "Date", signature: "MONTH(date)", description: "The month of a date, as a number.", minArgs: 1, maxArgs: 1 },
  { name: "DAY", category: "Date", signature: "DAY(date)", description: "The day of the month.", minArgs: 1, maxArgs: 1 },
  { name: "DAYNAME", category: "Date", signature: "DAYNAME(date)", description: "The weekday of a date, as a word.", minArgs: 1, maxArgs: 1 },
  { name: "MONTHNAME", category: "Date", signature: "MONTHNAME(date)", description: "The month of a date, as a word.", minArgs: 1, maxArgs: 1 },
  { name: "DATEADD", category: "Date", signature: "DATEADD(date, amount, unit?)", description: "Moves a date by a number of days, weeks, months or years.", minArgs: 2, maxArgs: 3 },
  { name: "DATEDIFF", category: "Date", signature: "DATEDIFF(from, to, unit?)", description: "How far apart two dates are, in days, hours or minutes.", minArgs: 2, maxArgs: 3 },
  { name: "FORMATDATE", category: "Format", signature: "FORMATDATE(date, pattern?)", description: "A date written out to a pattern such as \"dd MMM yyyy\".", minArgs: 1, maxArgs: 2 },
  { name: "FORMATNUMBER", category: "Format", signature: "FORMATNUMBER(value, pattern?)", description: "A number written out to a pattern such as \"#,##0.00\".", minArgs: 1, maxArgs: 2 },
  { name: "IFEMPTY", category: "Value", signature: "IFEMPTY(value, placeholder)", description: "A dash, or any other placeholder, where a value is missing.", minArgs: 1, maxArgs: 2 },
];

const FUNCTION_BY_NAME = new Map(FUNCTIONS.map(f => [f.name, f]));

export const NAMESPACES = ["Fields", "Parameters", "Report", "Page", "Group", "DataSources"] as const;

// ── Evaluation ──────────────────────────────────────────────────────

const isBlank = (value: unknown): boolean =>
  value === null || value === undefined || (typeof value === "string" && value.trim() === "");

function toNumber(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value instanceof Date) return value.getTime();
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : NaN;
}

function toText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const named = (value as { name?: unknown }).name ?? (value as { title?: unknown }).title;
    if (typeof named === "string") return named;
    return JSON.stringify(value);
  }
  return String(value);
}

function toBoolean(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") return value !== "" && value.toLowerCase() !== "false" && value !== "0";
  return !isBlank(value);
}

/** Dates compare as dates; everything else compares numerically when both sides are numbers. */
function compareValues(left: unknown, right: unknown): number {
  const leftDate = left instanceof Date ? left : null;
  const rightDate = right instanceof Date ? right : null;
  if (leftDate || rightDate) {
    const a = leftDate ?? new Date(String(left));
    const b = rightDate ?? new Date(String(right));
    if (!Number.isNaN(a.getTime()) && !Number.isNaN(b.getTime())) return a.getTime() - b.getTime();
  }
  const a = toNumber(left);
  const b = toNumber(right);
  const bothNumeric = !Number.isNaN(a) && !Number.isNaN(b) && !isBlank(left) && !isBlank(right);
  if (bothNumeric) return a === b ? 0 : a < b ? -1 : 1;
  const leftText = toText(left);
  const rightText = toText(right);
  return leftText === rightText ? 0 : leftText < rightText ? -1 : 1;
}

function equalValues(left: unknown, right: unknown): boolean {
  if (isBlank(left) && isBlank(right)) return true;
  if (isBlank(left) || isBlank(right)) return false;
  if (typeof left === "boolean" || typeof right === "boolean") return toBoolean(left) === toBoolean(right);
  const a = toNumber(left);
  const b = toNumber(right);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return a === b;
  return toText(left) === toText(right);
}

function likeToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`^${escaped.replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
}

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function toDateValue(value: unknown): Date | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value === "number") return new Date(value);
  if (typeof value === "string") {
    // A plain `YYYY-MM-DD` is a *calendar day*, not an instant: parsing it as UTC midnight makes
    // YEAR/MONTH/DAY answer for the day before anywhere west of Greenwich, which is how a report
    // dated 1 August shows July.
    const dayOnly = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (dayOnly) return new Date(Number(dayOnly[1]), Number(dayOnly[2]) - 1, Number(dayOnly[3]));
    if (/^\d{4}-\d{2}-\d{2}/.test(value)) {
      const parsed = new Date(value);
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }
  }
  return null;
}

const two = (n: number) => String(n).padStart(2, "0");

/** `.NET`-flavoured patterns, which is what Crystal/FastReport users already know. */
function formatDatePattern(date: Date, pattern: string): string {
  const h24 = date.getHours();
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return pattern.replace(/yyyy|yy|MMMM|MMM|MM|M|dddd|ddd|dd|d|HH|H|hh|h|mm|m|ss|s|tt/g, token => {
    switch (token) {
      case "yyyy": return String(date.getFullYear());
      case "yy": return two(date.getFullYear() % 100);
      case "MMMM": return MONTHS[date.getMonth()]!;
      case "MMM": return MONTHS[date.getMonth()]!.slice(0, 3);
      case "MM": return two(date.getMonth() + 1);
      case "M": return String(date.getMonth() + 1);
      case "dddd": return DAYS[date.getDay()]!;
      case "ddd": return DAYS[date.getDay()]!.slice(0, 3);
      case "dd": return two(date.getDate());
      case "d": return String(date.getDate());
      case "HH": return two(h24);
      case "H": return String(h24);
      case "hh": return two(h12);
      case "h": return String(h12);
      case "mm": return two(date.getMinutes());
      case "m": return String(date.getMinutes());
      case "ss": return two(date.getSeconds());
      case "s": return String(date.getSeconds());
      case "tt": return h24 < 12 ? "AM" : "PM";
      default: return token;
    }
  });
}

function formatNumberPattern(value: number, pattern: string): string {
  const decimals = (pattern.split(".")[1] ?? "").length;
  const grouped = pattern.includes(",");
  return value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals, useGrouping: grouped });
}

/** The declared path of an aggregate's first argument, or null when it is not a simple field. */
export function aggregatePath(ast: Expr | undefined): string | null {
  if (!ast || ast.kind !== "path") return null;
  return ast.parts.join(".");
}

function scopeFrom(ast: Expr | undefined): AggregateScope {
  if (ast && ast.kind === "string") {
    const value = ast.value.toLowerCase() as AggregateScope;
    if (AGGREGATE_SCOPES.includes(value)) return value;
  }
  return "report";
}

export function evaluateAst(ast: Expr, ctx: ExpressionContext): unknown {
  switch (ast.kind) {
    case "number": return ast.value;
    case "string": return ast.value;
    case "boolean": return ast.value;
    case "null": return null;
    case "path": return resolvePath(ast.parts, ctx);
    case "unary": {
      if (ast.op === "-") return -toNumber(evaluateAst(ast.arg, ctx));
      return !toBoolean(evaluateAst(ast.arg, ctx));
    }
    case "in": {
      const value = evaluateAst(ast.left, ctx);
      return ast.list.some(item => equalValues(value, evaluateAst(item, ctx)));
    }
    case "binary": {
      const { op } = ast;
      // Short-circuit before the right side is evaluated, so `x != null AND x > 1` cannot throw.
      if (op === "AND") return toBoolean(evaluateAst(ast.left, ctx)) && toBoolean(evaluateAst(ast.right, ctx));
      if (op === "OR") return toBoolean(evaluateAst(ast.left, ctx)) || toBoolean(evaluateAst(ast.right, ctx));
      const left = evaluateAst(ast.left, ctx);
      const right = evaluateAst(ast.right, ctx);
      switch (op) {
        case "=": return equalValues(left, right);
        case "!=": return !equalValues(left, right);
        case "<": return compareValues(left, right) < 0;
        case "<=": return compareValues(left, right) <= 0;
        case ">": return compareValues(left, right) > 0;
        case ">=": return compareValues(left, right) >= 0;
        case "LIKE": return likeToRegExp(toText(right)).test(toText(left));
        case "+": return typeof left === "string" || typeof right === "string" ? toText(left) + toText(right) : toNumber(left) + toNumber(right);
        case "-": return toNumber(left) - toNumber(right);
        case "*": return toNumber(left) * toNumber(right);
        case "/": {
          const divisor = toNumber(right);
          return divisor === 0 ? null : toNumber(left) / divisor;
        }
        case "%": {
          const divisor = toNumber(right);
          return divisor === 0 ? null : toNumber(left) % divisor;
        }
        default: throw new ExpressionError(`"${op}" is not something this report can evaluate`);
      }
    }
    case "call": return evaluateCall(ast, ctx);
  }
}

function resolvePath(parts: string[], ctx: ExpressionContext): unknown {
  const [head, ...rest] = parts;
  if (!head) return null;
  const namespace = NAMESPACES.find(n => n.toLowerCase() === head.toLowerCase());

  if (!namespace) {
    // A bare name is a field first — that is what a designer means nine times in ten.
    const field = readPath(ctx.fields, parts);
    if (field !== undefined) return field;
    return readPath(ctx.parameters, parts);
  }

  const remainder = rest.join(".");
  switch (namespace) {
    case "Fields": return remainder ? readPath(ctx.fields, rest) : ctx.fields;
    case "Parameters": return remainder ? readPath(ctx.parameters, rest) : ctx.parameters;
    case "Report": return readPath(ctx.report ?? {}, rest);
    case "Page": return readPath(ctx.page ?? {}, rest);
    case "Group": return readPath(ctx.group ?? {}, rest);
    case "DataSources": {
      const [key, ...path] = rest;
      if (!key) return null;
      if (!ctx.dataSource) throw new ExpressionError("This report has no other data source to read from");
      return ctx.dataSource(key, path.join("."));
    }
    default: return null;
  }
}

/** Reads a dotted path, case-insensitively at the first segment so `fields.x` is not a mystery. */
function readPath(source: Record<string, unknown>, parts: string[]): unknown {
  const [head, ...rest] = parts;
  if (!head) return source;
  let value: unknown = source[head];
  if (value === undefined) {
    const actual = Object.keys(source).find(k => k.toLowerCase() === head.toLowerCase());
    if (actual) value = source[actual];
  }
  for (const part of rest) {
    if (value === null || value === undefined || typeof value !== "object") return undefined;
    if (value instanceof Date) return undefined;
    const record = value as Record<string, unknown>;
    let next = record[part];
    if (next === undefined) {
      const actual = Object.keys(record).find(k => k.toLowerCase() === part.toLowerCase());
      if (actual) next = record[actual];
    }
    value = next;
  }
  return value;
}

function evaluateCall(ast: { name: string; args: Expr[] }, ctx: ExpressionContext): unknown {
  const name = ast.name;
  const spec = FUNCTION_BY_NAME.get(name);
  if (!spec) throw new ExpressionError(`There is no function called ${name}`);
  if (ast.args.length < spec.minArgs || (spec.maxArgs >= 0 && ast.args.length > spec.maxArgs)) {
    throw new ExpressionError(`${name} takes ${spec.signature.split("(")[1]?.replace(")", "") || "no arguments"} — it was given ${ast.args.length}`);
  }

  if (AGGREGATE_FUNCTIONS.includes(name as AggregateFunction)) {
    const fn = name as AggregateFunction;
    const isCount = fn === "COUNT";
    const path = aggregatePath(ast.args[0]) ?? (isCount && ast.args.length === 0 ? "" : null);
    if (path === null) throw new ExpressionError(`${name} needs a field name as its first argument, such as ${name}(Fields.total)`);
    const scopeAst = fn === "COUNT" && ast.args.length === 1 && ast.args[0]?.kind === "string" ? ast.args[0] : ast.args[1];
    const scope = scopeFrom(scopeAst);
    if (scope === "group" && !ctx.group) throw new ExpressionError(`${name} is scoped to a group, but this band is not inside one`);
    if (!ctx.aggregate) throw new ExpressionError(`${name} cannot be worked out here`);
    return ctx.aggregate({ fn, path, scope });
  }

  const args = ast.args.map(a => evaluateAst(a, ctx));
  const first = args[0];

  switch (name) {
    case "ROUND": {
      const digits = args.length > 1 ? Math.max(0, Math.min(10, Math.trunc(toNumber(args[1])))) : 2;
      const factor = 10 ** digits;
      return Math.round(toNumber(first) * factor) / factor;
    }
    case "ABS": return Math.abs(toNumber(first));
    case "CEIL": return Math.ceil(toNumber(first));
    case "FLOOR": return Math.floor(toNumber(first));
    case "SQRT": { const n = toNumber(first); return n < 0 ? null : Math.sqrt(n); }
    case "POWER": return toNumber(first) ** toNumber(args[1]);
    case "MOD": { const d = toNumber(args[1]); return d === 0 ? null : toNumber(first) % d; }
    case "PERCENT": { const total = toNumber(args[1]); return total === 0 ? null : (toNumber(first) / total) * 100; }
    case "UPPER": return toText(first).toUpperCase();
    case "LOWER": return toText(first).toLowerCase();
    case "PROPER": return toText(first).replace(/\b\w/g, c => c.toUpperCase());
    case "TRIM": return toText(first).trim();
    case "LEFT": return toText(first).slice(0, Math.max(0, Math.trunc(toNumber(args[1]))));
    case "RIGHT": { const count = Math.max(0, Math.trunc(toNumber(args[1]))); return count ? toText(first).slice(-count) : ""; }
    case "MID": {
      const start = Math.max(1, Math.trunc(toNumber(args[1])));
      const count = Math.max(0, Math.trunc(toNumber(args[2])));
      return toText(first).slice(start - 1, start - 1 + count);
    }
    case "LEN": return toText(first).length;
    case "CONCAT": return args.map(toText).join("");
    case "REPLACE": return toText(first).split(toText(args[1])).join(toText(args[2]));
    case "COALESCE": return args.find(a => !isBlank(a)) ?? null;
    case "IF": return toBoolean(first) ? (args[1] ?? null) : (args[2] ?? null);
    case "ISNULL": return isBlank(first);
    case "ISEMPTY": return toText(first).trim() === "";
    case "NOW": return new Date();
    // Today, as a calendar day in the reader's own timezone — a UTC midnight reads as yesterday here.
    case "TODAY": { const now = new Date(); return new Date(now.getFullYear(), now.getMonth(), now.getDate()); }
    case "YEAR": { const d = toDateValue(first); return d ? d.getFullYear() : null; }
    case "MONTH": { const d = toDateValue(first); return d ? d.getMonth() + 1 : null; }
    case "DAY": { const d = toDateValue(first); return d ? d.getDate() : null; }
    case "DAYNAME": { const d = toDateValue(first); return d ? DAYS[d.getDay()] : null; }
    case "MONTHNAME": { const d = toDateValue(first); return d ? MONTHS[d.getMonth()] : null; }
    case "DATEADD": {
      const d = toDateValue(first);
      if (!d) return null;
      const amount = Math.trunc(toNumber(args[1]));
      const unit = (args.length > 2 ? toText(args[2]) : "day").toLowerCase();
      const moved = new Date(d.getTime());
      if (unit.startsWith("min")) moved.setMinutes(moved.getMinutes() + amount);
      else if (unit.startsWith("hour")) moved.setHours(moved.getHours() + amount);
      else if (unit.startsWith("week")) moved.setDate(moved.getDate() + amount * 7);
      else if (unit.startsWith("month")) moved.setMonth(moved.getMonth() + amount);
      else if (unit.startsWith("year")) moved.setFullYear(moved.getFullYear() + amount);
      else moved.setDate(moved.getDate() + amount);
      return moved;
    }
    case "DATEDIFF": {
      const from = toDateValue(first);
      const to = toDateValue(args[1]);
      if (!from || !to) return null;
      const unit = (args.length > 2 ? toText(args[2]) : "day").toLowerCase();
      const ms = to.getTime() - from.getTime();
      if (unit.startsWith("min")) return Math.round(ms / 60000);
      if (unit.startsWith("hour")) return Math.round(ms / 3600000);
      return Math.round(ms / 86400000);
    }
    case "FORMATDATE": {
      const d = toDateValue(first);
      if (!d) return "";
      return formatDatePattern(d, args.length > 1 ? toText(args[1]) : "yyyy-MM-dd");
    }
    case "FORMATNUMBER": return formatNumberPattern(toNumber(first), args.length > 1 ? toText(args[1]) : "#,##0.00");
    case "IFEMPTY": return isBlank(first) ? (args.length > 1 ? toText(args[1]) : "—") : first;
    default: throw new ExpressionError(`There is no function called ${name}`);
  }
}

/** Evaluates an expression's source text and returns its value. */
export function evaluateExpression(source: string, ctx: ExpressionContext): unknown {
  const { ast, error } = parseExpression(source);
  if (!ast) throw new ExpressionError(error ?? "The expression could not be read");
  return evaluateAst(ast, ctx);
}

/** Evaluates an expression and returns the value as display text, never throwing. */
export function evaluateToText(source: string, ctx: ExpressionContext): string {
  try {
    const value = evaluateExpression(source, ctx);
    return toText(value);
  } catch {
    return "";
  }
}

// ── Static analysis, for validation without data ────────────────────

export interface PathReference { parts: string[]; namespace: string }

/** Every path an expression reads, so a validator can check the names before anything runs. */
export function collectPaths(ast: Expr, found: PathReference[] = []): PathReference[] {
  switch (ast.kind) {
    case "path": found.push({ parts: ast.parts, namespace: ast.parts[0] ?? "" }); break;
    case "call": for (const arg of ast.args) collectPaths(arg, found); break;
    case "unary": collectPaths(ast.arg, found); break;
    case "binary": collectPaths(ast.left, found); collectPaths(ast.right, found); break;
    case "in": collectPaths(ast.left, found); for (const item of ast.list) collectPaths(item, found); break;
    default: break;
  }
  return found;
}

export interface CallReference { name: string; args: Expr[] }

export function collectCalls(ast: Expr, found: CallReference[] = []): CallReference[] {
  switch (ast.kind) {
    case "call": {
      found.push({ name: ast.name, args: ast.args });
      for (const arg of ast.args) collectCalls(arg, found);
      break;
    }
    case "unary": collectCalls(ast.arg, found); break;
    case "binary": collectCalls(ast.left, found); collectCalls(ast.right, found); break;
    case "in": collectCalls(ast.left, found); for (const item of ast.list) collectCalls(item, found); break;
    default: break;
  }
  return found;
}

// ── Interpolated text ───────────────────────────────────────────────

export interface TextSegment { text: string; expression: string | null }

/**
 * A text element is literal, except for `{{ … }}` holes that are evaluated — so a label can read
 * "Client: {{Fields.client}}" without becoming a field element with no label of its own.
 */
export function parseTextSegments(source: string): TextSegment[] {
  const segments: TextSegment[] = [];
  const pattern = /\{\{([\s\S]*?)\}\}/g;
  let last = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(source))) {
    if (match.index > last) segments.push({ text: source.slice(last, match.index), expression: null });
    segments.push({ text: match[0], expression: match[1]!.trim() });
    last = match.index + match[0].length;
  }
  if (last < source.length) segments.push({ text: source.slice(last), expression: null });
  return segments.length ? segments : [{ text: "", expression: null }];
}

/** A text element's finished string. A hole that fails to evaluate is left visible, not blanked. */
export function interpolateText(source: string, ctx: ExpressionContext): string {
  return parseTextSegments(source)
    .map(segment => {
      if (segment.expression === null) return segment.text;
      try {
        return toText(evaluateExpression(segment.expression, ctx));
      } catch (e) {
        return e instanceof ExpressionError ? `#${segment.expression}#` : "";
      }
    })
    .join("");
}
