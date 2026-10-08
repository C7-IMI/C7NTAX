import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CornerDownLeft, Loader2, Terminal, X } from "lucide-react";
import {
  CONSOLE_VALUE_SOURCES,
  buildRequest,
  commandsByGroup,
  completionsAt,
  flagsFor,
  historyMatches,
  longestCommonPrefix,
  matchingCandidates,
  parseLine,
  permittedCommands,
  predictionFor,
  replaceWord,
  resolveSubject,
  rowsOf,
  valueAt,
  valueSourceQuery,
  wordAtCursor,
  type ConsoleCandidate,
  type ConsoleCommandSpec,
  type ConsoleInvocation,
  type CompletionResult,
} from "@C7NTAX/shared";
import api from "../api";
import { useAuth } from "../hooks/useAuth";
import { useAppVersion } from "../hooks/useAppVersion";

/**
 * The console — a popup in the C7NTAX header, wired to the icon that used to be a placeholder.
 *
 * PLAN-028 specifies the surface and this follows it, with one deliberate difference: the plan drew a
 * bottom-docked drawer, and the operator asked for a **popup dialog** with the application's own
 * border treatment. The keys, the grammar, the completion behaviour and the execution model are the
 * plan's (§5, §5.1, §6, §9, §10); only the frame is different.
 *
 * **What runs a command.** Nothing here executes anything of its own. A line is parsed in the browser
 * against the shared catalogue, the subject is resolved through the same list route the screen uses,
 * and the command's own `GET` is sent as the caller — so the permission that decides is the route's,
 * not this component's (§6). The only thing the console adds is the echo, the table and the history.
 */
type ConsoleEntryBody =
  | { kind: "input"; text: string }
  | { kind: "out"; lines: string[]; tone?: "dim" | "normal" }
  | { kind: "error"; text: string; hint?: string; code?: number }
  | { kind: "table"; columns: readonly { header: string; path: string }[]; rows: Record<string, unknown>[]; footer?: string }
  | { kind: "raw"; body: unknown; footer?: string };

type ConsoleEntry = ConsoleEntryBody & { id: number };

const HISTORY_KEY_PREFIX = "c7_console_history";
const ALIAS_KEY_PREFIX = "c7_console_alias";
const HISTORY_LIMIT = 200;

/** Column headers and dot-paths for a command that did not declare its own — enough to read a row. */
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

function readStorage<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeStorage(key: string, value: unknown): void {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* a full quota is not worth a message */ }
}

/** The route's own words, which §9 says to print verbatim rather than translate. */
function apiErrorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { error?: string; message?: string }; status?: number } })?.response;
  return response?.data?.error || response?.data?.message || (error as Error)?.message || "The request failed.";
}

export function ConsoleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, permissions } = useAuth();
  const appVersion = useAppVersion();
  const permitted = useMemo(() => permittedCommands(permissions), [permissions]);

  const [line, setLine] = useState("");
  const [entries, setEntries] = useState<ConsoleEntry[]>([]);
  const [history, setHistory] = useState<string[]>(() => readStorage(`${HISTORY_KEY_PREFIX}:${user?.email ?? "anon"}`, []));
  const [aliases, setAliases] = useState<Record<string, string>>(
    () => readStorage(`${ALIAS_KEY_PREFIX}:${user?.email ?? "anon"}`, {}),
  );
  const [historyIndex, setHistoryIndex] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const [menu, setMenu] = useState<{ candidates: ConsoleCandidate[]; index: number; result: CompletionResult } | null>(null);
  const [search, setSearch] = useState<{ active: boolean; query: string; index: number }>({ active: false, query: "", index: 0 });
  const [predictionList, setPredictionList] = useState(false);
  const [values, setValues] = useState<Record<string, ConsoleCandidate[]>>({});
  const [running, setRunning] = useState(false);
  const [catalog, setCatalog] = useState<{ available: number; total: number } | null>(null);

  const nextId = useRef(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  /** The Tab cycle: the same candidate set keeps cycling while the word under the cursor does not change. */
  const cycleRef = useRef<{ key: string; index: number; candidates: ConsoleCandidate[]; word: ReturnType<typeof wordAtCursor> } | null>(null);
  const applyingRef = useRef(false);

  const push = useCallback((entry: ConsoleEntryBody) => {
    setEntries((current) => [...current, { ...entry, id: nextId.current++ }].slice(-400));
  }, []);

  // ── Open and close ─────────────────────────────────────────────────
  useEffect(() => {
    if (!open) return;
    const focus = setTimeout(() => inputRef.current?.focus(), 0);
    // The catalogue is asked for once per session: it tells the console what the *server* will serve,
    // which is also how "42 of 85" in `context` stays true when a deployment turns commands off.
    if (!catalog) {
      api.get("/console/catalog")
        .then((r) => setCatalog(r.data?.counts ?? null))
        .catch(() => setCatalog(null));
    }
    return () => clearTimeout(focus);
  }, [open, catalog]);

  useEffect(() => {
    const container = scrollRef.current;
    if (container) container.scrollTop = container.scrollHeight;
  }, [entries]);

  useEffect(() => { writeStorage(`${HISTORY_KEY_PREFIX}:${user?.email ?? "anon"}`, history.slice(-HISTORY_LIMIT)); }, [history, user]);
  useEffect(() => { writeStorage(`${ALIAS_KEY_PREFIX}:${user?.email ?? "anon"}`, aliases); }, [aliases, user]);

  // ── Live values for completion ─────────────────────────────────────
  // One request per source per session, fetched when a position first needs it — never per keystroke,
  // which is the rule §5.1 states twice.
  const ensureSource = useCallback((key: string, sourceId: keyof typeof CONSOLE_VALUE_SOURCES, search?: string) => {
    const spec = CONSOLE_VALUE_SOURCES[sourceId];
    const cacheKey = search ? `${key}:${search}` : key;
    if (values[cacheKey]) return;
    const { path, query } = valueSourceQuery(sourceId, search ?? "");
    api.get(path, { params: query })
      .then((r) => {
        const candidates: ConsoleCandidate[] = rowsOf(r.data).map((row): ConsoleCandidate => ({
          value: valueAt(row, spec.valueField),
          label: spec.displayFields.map((f) => valueAt(row, f)).filter(Boolean).join(" · "),
          description: spec.label,
          kind: "value",
        })).filter((c) => c.value);
        setValues((current) => ({ ...current, [cacheKey]: candidates }));
      })
      .catch(() => setValues((current) => ({ ...current, [cacheKey]: [] })));
  }, [values]);

  const completionContext = useMemo(
    () => ({ commands: permitted, aliases, values }),
    [permitted, aliases, values],
  );

  const computeCompletions = useCallback(
    (text: string, caret: number): CompletionResult => completionsAt(text, caret, completionContext),
    [completionContext],
  );

  // Warm the sources a flag or subject needs as soon as the position asks for them.
  const warmFor = useCallback((result: CompletionResult) => {
    const spec = result.flag;
    if (result.position === "value" && spec?.from) ensureSource(spec.name, spec.from);
    if (result.position === "subject") {
      const lookup = result.command?.subject?.lookup;
      const source = (Object.keys(CONSOLE_VALUE_SOURCES) as (keyof typeof CONSOLE_VALUE_SOURCES)[])
        .find((key) => CONSOLE_VALUE_SOURCES[key].path === lookup?.path);
      if (source) ensureSource("subject", source);
    }
  }, [ensureSource]);

  // ── Output ─────────────────────────────────────────────────────────
  const helpFor = useCallback((args: string[]): string[] => {
    const lines: string[] = [];

    if (args.length === 0) {
      lines.push(`The console runs commands. ${permitted.length} of ${permitted.length} are available to you.`, "");
      for (const { group, commands } of commandsByGroup(permitted)) {
        lines.push(`  ${group.label}`);
        lines.push(`    ${group.summary}`);
        lines.push(`    ${commands.map((c) => c.name).join(", ")}`);
        lines.push("");
      }
      lines.push("  help <noun>            the verbs a noun offers");
      lines.push("  help <noun> <verb>     one command, with its flags");
      lines.push("");
      lines.push("  Read commands only: write commands arrive with PLAN-026's action manifest.");
      return lines;
    }

    const noun = args[0] ?? "";
    const forNoun = permitted.filter((c) => c.noun === noun || c.noun.startsWith(`${noun} `));
    if (args.length === 1) {
      if (forNoun.length === 0) {
        lines.push(`No noun \`${noun}\` you may use. Try \`help\`.`);
        return lines;
      }
      lines.push(`${noun} — ${forNoun.length} verb${forNoun.length === 1 ? "" : "s"}`, "");
      for (const command of forNoun) {
        lines.push(`  ${command.verb.padEnd(12)} ${command.description}`);
        if (command.permission) lines.push(`  ${"".padEnd(12)} needs ${command.permission}`);
      }
      return lines;
    }

    const command = forNoun.find((c) => c.verb === args[1]);
    if (!command) {
      lines.push(`\`${noun} ${args[1] ?? ""}\` is not a command you may run.`);
      if (forNoun.length) lines.push(`Try: ${forNoun.map((c) => `${c.noun} ${c.verb}`).join(", ")}`);
      return lines;
    }
    lines.push(`${command.name} — ${command.description}`, "");
    lines.push(`  permission   ${command.permission ?? "none — any signed-in session"}`);
    lines.push(`  route        GET ${command.path}`);
    if (command.subject) {
      lines.push(`  subject      ${command.subject.label}${command.subject.required ? " (required)" : ""}${command.subject.values ? ` — one of: ${command.subject.values.join(", ")}` : ""}`);
    }
    lines.push("", "  flags");
    for (const flag of flagsFor(command)) {
      const type = flag.values?.length ? ` [${flag.values.join("|")}]` : "";
      lines.push(`    --${flag.name.padEnd(14)} ${flag.help}${type}`);
    }
    const example = `${command.name}${command.subject ? ` ${command.subject.values?.[0] ?? "1001"}` : ""}${command.flags?.[0] ? ` --${command.flags[0].name} ${command.flags[0].values?.[0] ?? "…"}` : ""}`;
    lines.push("", `  e.g.  ${example}`);
    return lines;
  }, [permitted]);

  const contextLines = useCallback((): string[] => {
    const who = user?.email ?? "unknown";
    const available = catalog?.available ?? permitted.length;
    const total = catalog?.total ?? permitted.length;
    return [
      `Instance     ${window.location.host}`,
      `Signed in    ${who} (${permissions.length} permission${permissions.length === 1 ? "" : "s"})`,
      `Commands     ${available} available of ${total} (reads; writes need PLAN-026's action manifest)`,
      `Build        ${appVersion?.version ?? "unknown"}`,
      `Console      enabled — Workspace → Command console turns it off for everyone`,
    ];
  }, [user, catalog, permitted.length, permissions.length, appVersion]);

  const remember = useCallback((text: string) => {
    setHistory((current) => (current[current.length - 1] === text ? current : [...current, text].slice(-HISTORY_LIMIT)));
  }, []);

  const renderResult = useCallback((command: ConsoleCommandSpec, body: unknown, invocation: ConsoleInvocation) => {
    const rows = rowsOf(body, command.rows);
    const isList = Array.isArray(body) || (body as { data?: unknown })?.data !== undefined || rows.length > 0;

    if (invocation.flags.json) {
      push({ kind: "raw", body });
      return;
    }

    if (isList && rows.length > 0) {
      const columns = command.columns ?? autoColumns(rows);
      if (invocation.flags.quiet) {
        const key = columns[0]?.path ?? "id";
        push({ kind: "out", lines: rows.map((row) => valueAt(row, key)) });
        return;
      }
      push({
        kind: "table",
        columns,
        rows,
        footer: `${rows.length} row${rows.length === 1 ? "" : "s"}`,
      });
      return;
    }

    if (isList) {
      push({ kind: "out", lines: ["No rows."] });
      return;
    }

    // A single record: one field per line, which is what a console should print for one thing.
    const record = body as Record<string, unknown>;
    const lines = Object.entries(record)
      .filter(([, value]) => value === null || typeof value !== "object")
      .map(([key, value]) => `  ${key.padEnd(18)} ${value === null ? "" : String(value)}`);
    push({ kind: "out", lines: ["", ...lines] });
  }, [push]);

  // ── Running ────────────────────────────────────────────────────────
  const runCommand = useCallback(async (invocation: ConsoleInvocation): Promise<boolean> => {
    const { command } = invocation;
    let subjectId: string | null = null;

    if (command.subject?.lookup && invocation.subject) {
      const resolved = await resolveSubject(command, invocation.subject, async (path, query) => {
        const response = await api.get(path, { params: query });
        return response.data;
      });
      if (!resolved.ok) {
        push({ kind: "error", text: resolved.message, ...(resolved.hint ? { hint: resolved.hint } : {}), code: resolved.code });
        return false;
      }
      subjectId = resolved.resolution.id;
      if (resolved.resolution.label && resolved.resolution.label !== invocation.subject) {
        push({ kind: "out", lines: [`→ ${command.subject.label.toLowerCase()} ${resolved.resolution.label}`], tone: "dim" });
      }
    }

    const built = buildRequest(invocation, { meId: (user as { id?: string } | null)?.id ?? null, subjectId });
    if (!built.ok) {
      push({ kind: "error", text: built.message, ...(built.hint ? { hint: built.hint } : {}), code: built.code });
      return false;
    }

    const started = performance.now();
    try {
      const response = await api.get(built.request.path, { params: built.request.query });
      const elapsed = Math.round(performance.now() - started);
      if (invocation.flags.verbose) {
        push({
          kind: "out",
          tone: "dim",
          lines: [`GET ${built.request.path}${Object.keys(built.request.query).length ? `?${new URLSearchParams(built.request.query)}` : ""} · needs ${built.request.permission ?? "no permission"} · ${elapsed}ms`],
        });
      }
      renderResult(command, response.data, invocation);
      return true;
    } catch (error) {
      push({ kind: "error", text: apiErrorMessage(error), code: 6, hint: `GET ${built.request.path}` });
      return false;
    }
  }, [push, renderResult, user]);

  const runOwn = useCallback((verb: string, args: string[]): "continue" | "stop" | "exit" => {
    switch (verb) {
      case "help":
        push({ kind: "out", lines: helpFor(args) });
        return "continue";
      case "context":
        push({ kind: "out", lines: contextLines() });
        return "continue";
      case "history": {
        const lines = args.includes("--all")
          ? [...history].reverse()
          : entries.filter((e): e is Extract<ConsoleEntry, { kind: "input" }> => e.kind === "input").map((e) => e.text).reverse();
        push({ kind: "out", lines: lines.length ? lines.map((l, i) => `  ${String(i + 1).padStart(3)}  ${l}`) : ["No history yet."] });
        return "continue";
      }
      case "alias": {
        const argument = args[0] ?? "";
        if (!argument) {
          const keys = Object.keys(aliases);
          push({ kind: "out", lines: keys.length ? keys.map((k) => `  ${k} → ${aliases[k]}`) : ["No aliases yet. `alias t=ticket` then `t list`."] });
          return "continue";
        }
        const [word, ...expansion] = argument.split("=");
        const to = expansion.join("=").replace(/^["']|["']$/g, "");
        if (!word || !to) {
          push({ kind: "error", text: "An alias needs both sides: `alias t=ticket`.", code: 1 });
          return "stop";
        }
        setAliases((current) => ({ ...current, [word]: to }));
        push({ kind: "out", tone: "dim", lines: [`${word} → ${to}`] });
        return "continue";
      }
      case "unalias": {
        const word = args[0] ?? "";
        if (!aliases[word]) {
          push({ kind: "error", text: `No alias \`${word}\`.`, code: 3 });
          return "stop";
        }
        setAliases((current) => {
          const next = { ...current };
          delete next[word];
          return next;
        });
        return "continue";
      }
      case "clear":
        setEntries([]);
        return "continue";
      case "version":
        push({ kind: "out", lines: [`console      grammar 1 · ${permitted.length} commands available`, `application  ${appVersion?.version ?? "unknown"}`] });
        return "continue";
      case "exit":
        return "exit";
      default:
        push({ kind: "error", text: `\`${verb}\` is not a console verb.`, code: 1 });
        return "stop";
    }
  }, [aliases, appVersion, contextLines, entries, helpFor, history, permitted.length, push]);

  const runLine = useCallback(async (raw: string) => {
    const text = raw.trim();
    if (!text) return;
    push({ kind: "input", text });
    remember(text);
    setLine("");
    setMenu(null);
    setHistoryIndex(null);
    cycleRef.current = null;

    // `;` runs the statements in order and stops at the first failure (§5).
    const outcomes = parseLine(text, permitted, { permissions, aliases });
    setRunning(true);
    for (const outcome of outcomes) {
      if (!outcome.ok) {
        push({ kind: "error", text: outcome.message, ...(outcome.hint ? { hint: outcome.hint } : {}), code: outcome.code });
        break;
      }
      if (outcome.kind === "own") {
        const verdict = runOwn(outcome.own.verb, outcome.own.args);
        if (verdict === "exit") { onClose(); break; }
        if (verdict === "stop") break;
        continue;
      }
      const ok = await runCommand(outcome.invocation);
      if (!ok) break;
    }
    setRunning(false);
  }, [aliases, onClose, permissions, permitted, push, remember, runCommand, runOwn]);

  // ── Keys ───────────────────────────────────────────────────────────
  const applyCandidate = useCallback((candidate: ConsoleCandidate, result: CompletionResult) => {
    const replacement = candidate.takesValue ? `${candidate.value} ` : candidate.value;
    applyingRef.current = true;
    const next = replaceWord(line, result.word, replacement);
    setLine(next.line);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(next.caret, next.caret);
      applyingRef.current = false;
    });
  }, [line]);

  const cycle = useCallback((result: CompletionResult, direction: 1 | -1) => {
    const matches = matchingCandidates(result.candidates, result.word.prefix);
    if (matches.length === 0) return;
    const key = `${result.word.start}:${result.word.prefix}`;
    const existing = cycleRef.current;
    const state = existing && existing.key === key
      ? { ...existing, index: existing.index + direction }
      : { key, index: direction === 1 && matches.length > 1 ? -1 : 0, candidates: matches, word: result.word };

    if (state.index === -1) {
      // The first press extends to what is certain; the next one starts choosing (§5.1).
      const prefix = longestCommonPrefix(matches.map((c) => c.value));
      if (prefix.length > result.word.prefix.length) {
        cycleRef.current = { ...state, index: -1 };
        applyCandidate({ ...matches[0]!, value: prefix }, result);
        return;
      }
    }

    const wrapped = ((state.index % matches.length) + matches.length) % matches.length;
    cycleRef.current = { ...state, index: state.index === -1 ? 0 : wrapped };
    const candidate = matches[state.index === -1 ? 0 : wrapped];
    if (candidate) applyCandidate(candidate, result);
  }, [applyCandidate]);

  const onKeyDown = useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    const caret = inputRef.current?.selectionStart ?? line.length;

    // Esc: dismiss the menu first, then reverse search, then the console (§5.1, §10).
    if (event.key === "Escape") {
      event.preventDefault();
      if (menu) { setMenu(null); cycleRef.current = null; return; }
      if (search.active) { setSearch({ active: false, query: "", index: 0 }); return; }
      onClose();
      return;
    }

    // ── Reverse search (Ctrl+R) ──────────────────────────────────────
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "r") {
      event.preventDefault();
      setSearch({ active: true, query: "", index: 0 });
      return;
    }
    if (search.active) {
      const matches = historyMatches(search.query, history);
      if (event.key === "Enter") {
        event.preventDefault();
        const chosen = matches[search.index];
        if (chosen) { setLine(chosen); inputRef.current?.setSelectionRange(chosen.length, chosen.length); }
        setSearch({ active: false, query: "", index: 0 });
        return;
      }
      if (event.key === "ArrowUp" || event.key === "ArrowDown") {
        event.preventDefault();
        const next = event.key === "ArrowUp" ? search.index + 1 : search.index - 1;
        setSearch((s) => ({ ...s, index: Math.max(0, Math.min(next, matches.length - 1)) }));
        return;
      }
      if (event.key === "Backspace") {
        event.preventDefault();
        setSearch((s) => ({ ...s, query: s.query.slice(0, -1), index: 0 }));
        return;
      }
      if (event.key.length === 1 && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        setSearch((s) => ({ ...s, query: s.query + event.key, index: 0 }));
        return;
      }
    }

    // ── The menu, when it is open ────────────────────────────────────
    if (menu) {
      if (event.key === "ArrowDown" || (event.key === "Tab" && !event.shiftKey)) {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.min(m.index + 1, m.candidates.length - 1) } : m));
        return;
      }
      if (event.key === "ArrowUp" || (event.key === "Tab" && event.shiftKey)) {
        event.preventDefault();
        setMenu((m) => (m ? { ...m, index: Math.max(m.index - 1, 0) } : m));
        return;
      }
      if (event.key === "Enter") {
        event.preventDefault();
        const candidate = menu.candidates[menu.index];
        if (candidate) applyCandidate(candidate, menu.result);
        setMenu(null);
        return;
      }
    }

    if (event.key === "Enter") {
      event.preventDefault();
      void runLine(line);
      return;
    }

    // ── Completion ───────────────────────────────────────────────────
    if (event.key === "Tab") {
      event.preventDefault();
      const result = computeCompletions(line, caret);
      warmFor(result);
      cycle(result, event.shiftKey ? -1 : 1);
      return;
    }
    if (event.ctrlKey && event.key === " ") {
      event.preventDefault();
      const result = computeCompletions(line, caret);
      warmFor(result);
      const matches = matchingCandidates(result.candidates, result.word.prefix);
      if (matches.length) setMenu({ candidates: matches, index: 0, result });
      return;
    }

    // ── History prediction, and history itself ───────────────────────
    if (event.key === "F2") {
      event.preventDefault();
      setPredictionList((v) => !v);
      return;
    }
    if (event.key === "ArrowRight" && (caret >= line.length) && !event.altKey) {
      const prediction = predictionFor(line, history);
      if (prediction) {
        event.preventDefault();
        const accepted = event.ctrlKey ? `${line}${prediction.slice(line.length).split(" ")[0] ?? ""}` : prediction;
        setLine(accepted);
        requestAnimationFrame(() => inputRef.current?.setSelectionRange(accepted.length, accepted.length));
        return;
      }
      if (event.ctrlKey) return;
    }
    if (event.key === "ArrowUp" && !menu) {
      event.preventDefault();
      const matches = history;
      if (matches.length === 0) return;
      const next = historyIndex === null ? matches.length - 1 : Math.max(0, historyIndex - 1);
      if (historyIndex === null) setDraft(line);
      setHistoryIndex(next);
      const value = matches[next] ?? "";
      setLine(value);
      requestAnimationFrame(() => inputRef.current?.setSelectionRange(value.length, value.length));
      return;
    }
    if (event.key === "ArrowDown" && !menu) {
      event.preventDefault();
      if (historyIndex === null) return;
      const next = historyIndex + 1;
      if (next >= history.length) { setHistoryIndex(null); setLine(draft); return; }
      setHistoryIndex(next);
      const value = history[next] ?? "";
      setLine(value);
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "l") {
      event.preventDefault();
      setEntries([]);
      return;
    }
    if (event.ctrlKey && event.key.toLowerCase() === "c") {
      event.preventDefault();
      push({ kind: "input", text: `${line}^C` });
      setLine("");
      return;
    }
    if (event.key === "F1") {
      event.preventDefault();
      const result = computeCompletions(line, caret);
      const command = result.command;
      push({ kind: "out", lines: command ? helpFor([command.noun, command.verb]) : helpFor([]) });
    }
  }, [applyCandidate, computeCompletions, draft, helpFor, history, historyIndex, line, menu, onClose, push, runLine, search, warmFor, cycle]);

  const prediction = useMemo(() => predictionFor(line, history), [line, history]);
  const searchMatches = useMemo(
    () => (search.active ? historyMatches(search.query, history) : []),
    [search, history],
  );
  const hint = useMemo(() => {
    const result = computeCompletions(line, line.length);
    if (line.trim() && result.command) return `${result.command.name} · ${result.command.permission ?? "no permission"}`;
    return `${permitted.length} commands · Tab completes · Ctrl+Space lists them · ↑ history · Ctrl+R searches`;
  }, [computeCompletions, line, permitted.length]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center pt-[8vh] px-4 pb-4 bg-black/60"
      onMouseDown={onClose}
      role="presentation"
    >
      <div
        className="w-full max-w-4xl flex flex-col rounded-xl bg-surface shadow-2xl overflow-hidden border-2 border-cyber-600/50 ring-1 ring-cyber-600/20"
        onMouseDown={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="C7NTAX console"
        data-testid="console-dialog"
      >
        {/* Header — the brand's own border and tint, so the popup is unmistakably C7NTAX. */}
        <div className="flex items-center gap-2.5 px-3.5 py-2.5 border-b border-cyber-600/30 bg-cyber-600/10">
          <Terminal size={15} className="text-cyber-400 shrink-0" />
          <span className="text-sm font-medium text-white">Console</span>
          <span className="text-[11px] text-gray-500 truncate">{hint}</span>
          <button
            type="button"
            onClick={onClose}
            className="ml-auto p-1 rounded-md text-gray-400 hover:text-white hover:bg-surface-lighter transition-colors"
            title="Close (Esc)"
            aria-label="Close console"
          >
            <X size={14} />
          </button>
        </div>

        {/* Scrollback */}
        <div ref={scrollRef} className="flex-1 min-h-[18rem] max-h-[52vh] overflow-y-auto px-3.5 py-2 font-mono text-[12.5px] leading-relaxed">
          {entries.length === 0 && (
            <div className="text-gray-500 space-y-1">
              <p className="text-gray-400">C7NTAX console — type <span className="text-cyber-400">help</span> for what you can run, or try:</p>
              <p>  ticket list --status open --limit 10</p>
              <p>  client show northwind</p>
              <p>  report run ticket-volume</p>
              <p className="pt-1">Tab completes, Ctrl+Space lists candidates, ↑ walks history, Ctrl+R searches it.</p>
            </div>
          )}
          {entries.map((entry) => {
            if (entry.kind === "input") {
              return (
                <div key={entry.id} className="text-white whitespace-pre-wrap break-words">
                  <span className="text-cyber-400">{">"} </span>{entry.text}
                </div>
              );
            }
            if (entry.kind === "out") {
              return (
                <div key={entry.id} className={`whitespace-pre-wrap break-words ${entry.tone === "dim" ? "text-gray-500" : "text-gray-300"}`}>
                  {entry.lines.join("\n")}
                </div>
              );
            }
            if (entry.kind === "error") {
              return (
                <div key={entry.id} className="text-red-400 whitespace-pre-wrap break-words">
                  {entry.text}
                  {entry.hint ? <div className="text-gray-500">  {entry.hint}</div> : null}
                  {typeof entry.code === "number" ? <div className="text-gray-600">  exit {entry.code}</div> : null}
                </div>
              );
            }
            if (entry.kind === "table") {
              return (
                <div key={entry.id} className="my-1">
                  <div className="overflow-x-auto">
                    <table className="w-full text-left">
                      <thead>
                        <tr className="text-gray-500 border-b border-surface-border">
                          {entry.columns.map((column) => (
                            <th key={column.path} className="py-0.5 pr-4 font-medium whitespace-nowrap">{column.header}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {entry.rows.map((row, index) => (
                          <tr key={index} className="text-gray-300 align-top">
                            {entry.columns.map((column) => (
                              <td key={column.path} className="py-0.5 pr-4 whitespace-nowrap">{valueAt(row, column.path)}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {entry.footer ? <div className="text-gray-500 pt-0.5">{entry.footer}</div> : null}
                </div>
              );
            }
            return (
              <div key={entry.id} className="my-1">
                <pre className="text-gray-400 whitespace-pre-wrap break-words">{JSON.stringify(entry.body, null, 2)}</pre>
              </div>
            );
          })}
          {running && (
            <div className="text-gray-500 flex items-center gap-2"><Loader2 size={12} className="animate-spin" /> running…</div>
          )}
        </div>

        {/* Reverse search */}
        {search.active && (
          <div className="px-3.5 py-1 border-t border-surface-border font-mono text-[12.5px] text-gray-400">
            <span className="text-cyber-400">(reverse-i-search)</span>`{search.query}`:{" "}
            <span className="text-white">{searchMatches[search.index] ?? "no match"}</span>
            <span className="text-gray-600"> — Enter to use, Esc to cancel</span>
          </div>
        )}

        {/* Predictions, as a list (F2) */}
        {!search.active && predictionList && prediction && (
          <div className="px-3.5 py-1 border-t border-surface-border font-mono text-[12.5px] text-gray-500 max-h-24 overflow-y-auto">
            {historyMatches(line, history).slice(0, 6).map((match, index) => (
              <div key={index}>{match}</div>
            ))}
          </div>
        )}

        {/* Prompt */}
        <div className="border-t border-cyber-600/30 bg-surface-light">
          <div className="flex items-center gap-2 px-3.5 py-2">
            <span className="font-mono text-sm text-cyber-400 shrink-0">C7NTAX{">"}</span>
            <div className="relative flex-1 min-w-0">
              <div
                ref={mirrorRef}
                aria-hidden
                className="pointer-events-none absolute inset-0 font-mono text-sm whitespace-pre overflow-hidden"
              >
                <span className="text-white">{line}</span>
                {prediction ? <span className="text-gray-600">{prediction.slice(line.length)}</span> : null}
              </div>
              <input
                ref={inputRef}
                value={line}
                autoFocus
                spellCheck={false}
                autoComplete="off"
                aria-label="Console command"
                onChange={(event) => {
                  if (!applyingRef.current) { cycleRef.current = null; setMenu(null); }
                  setLine(event.target.value);
                }}
                onKeyDown={onKeyDown}
                onScroll={(event) => {
                  if (mirrorRef.current) mirrorRef.current.style.transform = `translateX(${-(event.currentTarget.scrollLeft)}px)`;
                }}
                className="relative w-full bg-transparent font-mono text-sm outline-none text-transparent"
                style={{ caretColor: "var(--cyber-400)" }}
              />
            </div>
            <kbd className="hidden sm:flex items-center gap-1 text-[10px] text-gray-500 border border-surface-border rounded px-1.5 py-0.5 shrink-0">
              <CornerDownLeft size={10} /> run
            </kbd>
          </div>

          {/* Candidates */}
          {menu && (
            <div className="max-h-56 overflow-y-auto border-t border-surface-border">
              {menu.candidates.map((candidate, index) => (
                <button
                  key={`${candidate.value}-${index}`}
                  type="button"
                  onMouseEnter={() => setMenu((m) => (m ? { ...m, index } : m))}
                  onClick={() => { applyCandidate(candidate, menu.result); setMenu(null); }}
                  className={`w-full flex items-baseline gap-3 px-3.5 py-1 text-left font-mono text-[12.5px] ${
                    index === menu.index ? "bg-surface-lighter text-white" : "text-gray-400"
                  }`}
                >
                  <span className="shrink-0">{candidate.label}</span>
                  {candidate.description ? <span className="text-gray-500 font-sans text-[11px] truncate">{candidate.description}</span> : null}
                  <span className="ml-auto text-[10px] text-gray-600 shrink-0">{candidate.kind}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
