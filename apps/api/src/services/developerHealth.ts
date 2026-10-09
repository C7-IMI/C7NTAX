/**
 * The repository's own checks, run from the Developer section.
 *
 * The guards are what stand between a change and the branch, and running them from the section means the
 * answer arrives before the push rather than after it. So this module runs *the repository's own scripts*
 * — not a re-statement of them — as child processes from the repository root.
 *
 * Three rules, and the third is the one that matters:
 *
 *   1. **A failing check never fails the request.** A guard that fails is the answer, not an error, and a
 *      screen that shows an HTTP 500 instead of "plugin metadata: fail" has hidden the thing it exists to
 *      show. Every check is collected and the response is always `200`.
 *   2. **The reported line is the check's own.** `detail` carries the script's output, so the reader can
 *      see what actually failed rather than a summary this file invented.
 *   3. **A check that did not run is `skip`, never `pass`.** A missing script, a tool that is not on the
 *      PATH, or a run that ran out of time is a fact that folds into no other status: `guard:plugin` fails
 *      here today and `guard:deps` needs `pnpm audit` to answer, and calling either of them green because
 *      nothing was printed is exactly the comfortable lie this section exists to refuse.
 */
import { spawn } from "child_process";
import { existsSync } from "fs";
import * as path from "path";
import { repoRoot } from "./sampleDataOperations";

export type HealthStatus = "pass" | "fail" | "skip";

export interface HealthCheck {
  id: string;
  label: string;
  command: string;
  status: HealthStatus;
  detail: string;
  ms: number;
}

interface CheckSpec {
  id: string;
  label: string;
  /** The script, relative to the repository root. */
  script: string;
  /** Extra arguments after the script. */
  args?: string[];
  /** How the script is run: `node` for `.mjs`, `tsx` for `.mts`. */
  via: "node" | "tsx";
  /** What the check answers, so the screen can say what a failure means. */
  answers: string;
  timeoutMs?: number;
}

/**
 * The checks, in the order the guards table reads. `guard:plugin` and `guard:deps` are here on purpose:
 * one currently fails and the other may not be able to answer off a machine with no registry access, and
 * a health panel that omitted them would be a panel that only ever shows greens.
 */
const CHECKS: readonly CheckSpec[] = [
  {
    id: "routes",
    label: "Route guards",
    script: "scripts/check-route-guards.mjs",
    via: "node",
    answers: "Every authenticated route carries a permission, or a documented exemption.",
  },
  {
    id: "api-docs",
    label: "API documentation",
    script: "scripts/check-api-docs.mjs",
    via: "node",
    answers: "docs/openapi.yaml matches the routes, and no curated description names a route that is gone.",
  },
  {
    id: "config",
    label: "Configuration reads",
    script: "scripts/check-config-reads.mts",
    via: "tsx",
    answers: "Every configFlag/configText/configNumber call names a field the registry declares.",
  },
  {
    id: "console",
    label: "Console catalogue",
    script: "scripts/check-console-catalog.mts",
    via: "tsx",
    answers: "Every console command names a route and a flag that exist, and none is unreachable.",
  },
  {
    id: "plugin",
    label: "Plugin metadata",
    script: "scripts/plugin-metadata.mts",
    args: ["check"],
    via: "tsx",
    answers: "The Outlook add-in's manifest, its version and its files agree — known to fail on this tree.",
  },
  {
    id: "deps",
    label: "Dependency audit baseline",
    script: "scripts/audit-baseline.mjs",
    via: "node",
    answers: "No advisory outside the accepted list — needs pnpm audit, so it may not run at all.",
    timeoutMs: 240_000,
  },
  {
    id: "encoding",
    label: "Encoding",
    script: "scripts/check-encoding.mjs",
    via: "node",
    answers: "No source file contains text round-tripped through the wrong code page.",
  },
  {
    id: "help-links",
    label: "Help links",
    script: "scripts/check-help-links.mjs",
    via: "node",
    answers: "Every Help link points at a route that exists, and no walkthrough is missing from the Index.",
  },
  {
    id: "design-tokens",
    label: "Design tokens",
    script: "scripts/lint-design-tokens.mjs",
    via: "node",
    answers: "No component uses a raw colour where the palette has a token.",
  },
];

/** The executable that runs a script of each kind, quoted for a shell because the paths contain spaces. */
function interpreter(via: "node" | "tsx"): { command: string; found: boolean } {
  if (via === "node") return { command: `"${process.execPath}"`, found: true };
  const bin = path.join(repoRoot ?? process.cwd(), "node_modules", ".bin", process.platform === "win32" ? "tsx.CMD" : "tsx");
  return { command: `"${bin}"`, found: existsSync(bin) };
}

/** Run one check and describe the outcome, never throwing. */
function runCheck(spec: CheckSpec): Promise<HealthCheck> {
  const started = Date.now();
  const cwd = repoRoot ?? process.cwd();
  const project = spec.script;
  const args = (spec.args ?? []).map((arg) => ` ${arg}`).join("");
  /** The command line as it actually runs, so a reader can copy it rather than trust the label. */
  const described = `${spec.via} ${project}${args}`;

  const fail = (status: HealthStatus, detail: string): HealthCheck => ({
    id: spec.id,
    label: spec.label,
    command: described,
    status,
    detail,
    ms: Date.now() - started,
  });

  if (!existsSync(path.join(cwd, spec.script))) {
    return Promise.resolve(fail("skip", `could not run: ${project} is not on this working copy`));
  }

  const { command, found } = interpreter(spec.via);
  if (!found) {
    return Promise.resolve(fail("skip", `could not run: ${spec.via} is not installed for this working copy`));
  }

  return new Promise<HealthCheck>((resolve) => {
    const child = spawn(`${command} "${project}"${args}`, {
      cwd,
      shell: true,
      env: { ...process.env, NODE_ENV: process.env.NODE_ENV || "development" },
    });

    const output: string[] = [];
    const collect = (chunk: Buffer): void => {
      output.push(chunk.toString("utf8"));
      // A check that prints megabytes (the encoding walk names every file) would otherwise be held in
      // memory for the length of the run; only the tail is ever reported.
      if (output.length > 400) output.splice(0, output.length - 400);
    };
    child.stdout?.on("data", collect);
    child.stderr?.on("data", collect);

    const timeoutMs = spec.timeoutMs ?? 120_000;
    const timer = setTimeout(() => {
      child.kill();
      resolve(fail("skip", `could not run: the check did not finish within ${Math.round(timeoutMs / 1000)}s`));
    }, timeoutMs);

    child.on("error", (error) => {
      clearTimeout(timer);
      resolve(fail("skip", `could not run: ${error.message}`));
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      const text = output.join("");
      resolve(describeResult(spec, described, code, text, Date.now() - started));
    });
  });
}

/** What the check printed, reduced to the line or two a reader needs. */
function describeResult(spec: CheckSpec, command: string, code: number | null, text: string, ms: number): HealthCheck {
  const lines = text.split(/\r?\n/).map((line) => line.trimEnd()).filter((line) => line.trim() !== "");
  const tail = (count: number): string => lines.slice(-count).join("\n");

  if (code === 0) {
    // The passing scripts end with their own summary line; that line is the report.
    const summary = [...lines].reverse().find((line) => /check|ok|clean|no |every|all /i.test(line));
    return { id: spec.id, label: spec.label, command, status: "pass", detail: (summary ?? tail(2)) || "exited 0 with no output", ms };
  }

  // The first line that looks like the failure, then the tail, so the reason and the context are both
  // present. A check that printed nothing at all still says something: it says what its exit code was.
  const failing = lines.find((line) => /✗|✖|error|fail|not |missing|cannot|no such/i.test(line));
  const detail = [failing, tail(failing ? 8 : 12)].filter(Boolean).join("\n");
  return {
    id: spec.id,
    label: spec.label,
    command,
    status: "fail",
    detail: detail || `${spec.script} exited with code ${code ?? "unknown"} and printed nothing`,
    ms,
  };
}

/** Run every check, a few at a time so `tsx`'s compilations do not fight each other. */
export async function runRepoHealth(): Promise<HealthCheck[]> {
  const results: HealthCheck[] = [];
  const limit = 3;
  for (let start = 0; start < CHECKS.length; start += limit) {
    const batch = CHECKS.slice(start, start + limit);
    results.push(...(await Promise.all(batch.map((spec) => runCheck(spec)))));
  }
  return results;
}

/** What each check is for, keyed by id, so the screen can explain a row without hard-coding it. */
export function healthCatalogue(): Array<{ id: string; label: string; command: string; answers: string }> {
  return CHECKS.map((spec) => ({
    id: spec.id,
    label: spec.label,
    command: `${spec.via} ${spec.script}${(spec.args ?? []).map((arg) => ` ${arg}`).join("")}`,
    answers: spec.answers,
  }));
}
