/**
 * Turning a parsed command into a request, and a subject into a record.
 *
 * Two rules from PLAN-028 shape everything here:
 *
 * 1. **The console does not authorize.** It builds the same `GET` the screen builds and lets the
 *    route decide (§6). There is no permission logic in this file beyond the courtesy check the
 *    parser does so a refusal arrives before the round trip.
 * 2. **Ambiguous is an error, never a choice** (§5). Resolving `northwind` to two clients produces a
 *    list with enough context to disambiguate — never the first row.
 *
 * The I/O is injected (`fetchList`) rather than imported, so the browser passes its axios instance,
 * the CLI passes `fetch`, and neither becomes a dependency of the shared package.
 */
import { CONSOLE_VALUE_SOURCES, type ConsoleCommandSpec, type ConsoleValueSourceId } from "./catalogue";
import { CONSOLE_EXIT, type ConsoleExitCode } from "./grammar";
import type { ConsoleInvocation } from "./parse";

/** A read request, ready to hand to whatever client the front end has. */
export interface ConsoleRequest {
  method: "GET";
  /** Path relative to the API root, e.g. `/tickets`. */
  path: string;
  query: Record<string, string>;
  /** The permission the route will check, for `--verbose` and for the audit line. */
  permission: string | null;
}

export type ConsoleFailure = { ok: false; code: ConsoleExitCode; message: string; hint?: string };
export type ConsoleSuccess<T> = { ok: true } & T;

/** Build the request a parsed command runs. Resolves `me`, renames flags to the route's parameters. */
export function buildRequest(
  invocation: ConsoleInvocation,
  ctx: { meId?: string | null; subjectId?: string | null } = {},
): ConsoleSuccess<{ request: ConsoleRequest }> | ConsoleFailure {
  const { command, flags } = invocation;

  const subject = invocation.subject;
  if (command.subject?.required && subject === null) {
    return { ok: false, code: CONSOLE_EXIT.usage, message: `\`${command.name}\` needs a ${command.subject.label.toLowerCase()}.` };
  }
  if (command.subject?.lookup && !ctx.subjectId) {
    return { ok: false, code: CONSOLE_EXIT.notFound, message: `\`${command.name}\` could not resolve \`${subject}\`.` };
  }
  const path = command.path.replace("{subject}", encodeURIComponent(ctx.subjectId ?? subject ?? ""));

  const query: Record<string, string> = {};
  for (const [name, value] of Object.entries(flags)) {
    // Universal flags are the console's, not the route's.
    if (name === "json" || name === "quiet" || name === "verbose") continue;
    const spec = command.flags?.find((f) => f.name === name);
    const parameter = spec?.query ?? spec?.name ?? name;
    if (spec?.acceptsMe && typeof value === "string" && value.toLowerCase() === "me") {
      if (!ctx.meId) {
        return { ok: false, code: CONSOLE_EXIT.notFound, message: "The console could not work out who `me` is." };
      }
      query[parameter] = ctx.meId;
      continue;
    }
    if (value === true) {
      query[parameter] = "true";
      continue;
    }
    query[parameter] = value;
  }

  return { ok: true, request: { method: "GET", path, query, permission: command.permission } };
}

/** Rows inside a response body, whatever shape the route returns. */
export function rowsOf(body: unknown, path?: string): Record<string, unknown>[] {
  const find = (candidate: unknown): Record<string, unknown>[] | null => {
    if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
    if (candidate && typeof candidate === "object") {
      const record = candidate as Record<string, unknown>;
      for (const key of ["data", "items", "rows", "results"]) {
        const nested = record[key];
        if (Array.isArray(nested)) return nested as Record<string, unknown>[];
      }
    }
    return null;
  };

  if (path) {
    const scoped = path.split(".").reduce<unknown>((acc, key) => {
      if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
      return undefined;
    }, body);
    const rows = find(scoped);
    if (rows) return rows;
  }
  return find(body) ?? [];
}

/** `company.name` → the value, or an empty string. Never `undefined` in a table cell. */
export function valueAt(row: Record<string, unknown>, path: string): string {
  const value = path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") return (acc as Record<string, unknown>)[key];
    return undefined;
  }, row);
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if (Array.isArray(value)) return value.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(", ");
    return JSON.stringify(value);
  }
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "number") return String(value);
  return String(value);
}

/** Every word the person typed must appear somewhere in the record — §5's rule, not fuzzy matching. */
function matchesEveryWord(row: Record<string, unknown>, words: readonly string[], fields: readonly string[]): boolean {
  const haystack = fields.map((f) => valueAt(row, f).toLowerCase()).join(" ");
  return words.every((w) => haystack.includes(w));
}

/** A list fetch, injected: `(path, query) => body`. */
export type ConsoleListFetcher = (path: string, query: Record<string, string>) => Promise<unknown>;

export interface SubjectResolution {
  id: string;
  /** What the record is, for the echo line: "MSP-1001-1009 — Laptop will not boot". */
  label: string;
}

/**
 * Resolve a typed subject to one record.
 *
 * One match proceeds; several are an error with the candidates; none suggests the closest the API
 * returned. A record the caller may not see is "not found" rather than "forbidden", because the list
 * route is scoped and the console never learns what it was not shown.
 */
export async function resolveSubject(
  command: ConsoleCommandSpec,
  subject: string,
  fetchList: ConsoleListFetcher,
): Promise<ConsoleSuccess<{ resolution: SubjectResolution }> | ConsoleFailure> {
  const lookup = command.subject?.lookup;
  if (!lookup) return { ok: true, resolution: { id: subject, label: subject } };

  const query: Record<string, string> = { limit: "25" };
  if (lookup.searchParam) query[lookup.searchParam] = subject;
  const body = await fetchList(lookup.path, query);
  const rows = rowsOf(body);

  const words = subject.toLowerCase().split(/\s+/).filter(Boolean);
  const matches = lookup.searchParam
    ? rows
    : rows.filter((row) => matchesEveryWord(row, words, lookup.match));

  const describe = (row: Record<string, unknown>): string =>
    lookup.display.map((field) => valueAt(row, field)).filter(Boolean).join(" · ");

  if (matches.length === 0) {
    const closest = rows.slice(0, 5).map(describe).filter(Boolean);
    return {
      ok: false,
      code: CONSOLE_EXIT.notFound,
      message: `No ${command.subject?.label.toLowerCase() ?? "record"} matches \`${subject}\`.`,
      ...(closest.length ? { hint: `Closest: ${closest.join("; ")}` } : {}),
    };
  }

  const exact = matches.filter((row) => lookup.match.some((field) => valueAt(row, field).toLowerCase() === subject.toLowerCase()));
  if (exact.length === 1) {
    const row = exact[0] ?? {};
    return { ok: true, resolution: { id: valueAt(row, lookup.idField ?? "id"), label: describe(row) } };
  }
  if (matches.length === 1) {
    const row = matches[0] ?? {};
    return { ok: true, resolution: { id: valueAt(row, lookup.idField ?? "id"), label: describe(row) } };
  }

  return {
    ok: false,
    code: CONSOLE_EXIT.notFound,
    message: `\`${subject}\` matches ${matches.length} records — be specific.`,
    hint: matches.slice(0, 8).map(describe).filter(Boolean).join("; "),
  };
}

/** The list path and query a value source completes from — used to warm the caches. */
export function valueSourceQuery(source: ConsoleValueSourceId, search = ""): { path: string; query: Record<string, string> } {
  const spec = CONSOLE_VALUE_SOURCES[source];
  const query: Record<string, string> = { limit: "25" };
  if (search && spec.searchParam) query[spec.searchParam] = search;
  return { path: spec.path, query };
}
