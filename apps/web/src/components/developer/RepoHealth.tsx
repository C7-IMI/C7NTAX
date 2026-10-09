import { useRedesign } from "../../hooks/useNavigationStyle";
import type { HealthCheck, HealthStatus, Read, RepoHealth } from "./developerApi";
import { LoadingBlock, StateChip, UnavailablePanel, formatCount } from "./developerUi";

/**
 * Repo health — the repository's own checks, as they answer on this working copy.
 *
 * It is the first panel on the hub because it is the one entry whose answer is not a promise: the guard
 * commands are what stand between a change and the branch, and running them from the section means the
 * answer arrives before the change does rather than after the push.
 *
 * **A `skip` is not a pass.** The status vocabulary is three words, not two, and the summary counts them
 * separately — `3 passed · 1 failed · 2 not run` — because a check that could not run because the tool
 * was not on the PATH is a fact the reader has to act on, and folding it into either column would be the
 * section telling a comfortable lie. A read that failed is not a pass either: it is drawn as the read
 * notice, never as a green row.
 *
 * Two arrangements: the modern panel is a list of rows with the check's own output under each and the
 * tallies as chips on the header; the classic panel is a table with Check, Command, Status and Output as
 * columns, which is how every classic screen shows a list of results.
 */
export function RepoHealthPanel({ read }: { read: Read<RepoHealth> }) {
  const redesign = useRedesign();

  const checks: HealthCheck[] = read.data?.checks ?? [];
  const passed = checks.filter((c) => c.status === "pass").length;
  const failed = checks.filter((c) => c.status === "fail").length;
  const skipped = checks.filter((c) => c.status !== "pass" && c.status !== "fail").length;

  const header = (
    <div className="flex flex-wrap items-center gap-2">
      <h3 className={redesign ? "text-sm font-semibold text-white" : "text-lg font-semibold text-white"}>Repo health</h3>
      <span className="text-xs text-gray-500">the guards, as they answer on this working copy</span>
      {read.status === "ok" ? (
        <span className="ml-auto flex flex-wrap items-center gap-1.5">
          <StateChip tone={passed > 0 ? "good" : "neutral"}>{formatCount(passed)} passed</StateChip>
          <StateChip tone={failed > 0 ? "bad" : "neutral"}>{formatCount(failed)} failed</StateChip>
          <StateChip tone={skipped > 0 ? "warn" : "neutral"}>{formatCount(skipped)} not run</StateChip>
        </span>
      ) : null}
    </div>
  );

  if (read.status === "loading") {
    return (
      <div className="space-y-3">
        {header}
        <LoadingBlock label="the repo-health checks" />
      </div>
    );
  }

  if (read.status === "unavailable") {
    return (
      <div className="space-y-3">
        {header}
        <UnavailablePanel message={read.message ?? "The repo-health checks could not be read."} onRetry={read.reload} />
      </div>
    );
  }

  if (checks.length === 0) {
    return (
      <div className="space-y-3">
        {header}
        <p className="rounded-xl border border-surface-border bg-surface p-4 text-xs text-gray-500">
          The endpoint answered, but named no checks — so there is nothing here that can be reported as passing.
        </p>
      </div>
    );
  }

  // ── Classic: a table of results, one row per check ─────────────────────────────────────────────
  if (!redesign) {
    return (
      <div className="space-y-3">
        {header}
        <div className="overflow-x-auto rounded-xl border border-surface-border">
          <table className="w-full text-left text-sm">
            <thead className="bg-surface-lighter text-xs uppercase tracking-wide text-gray-400">
              <tr>
                <th className="px-3 py-2 font-semibold">Check</th>
                <th className="px-3 py-2 font-semibold">Command</th>
                <th className="px-3 py-2 font-semibold">Status</th>
                <th className="px-3 py-2 font-semibold">Output</th>
              </tr>
            </thead>
            <tbody>
              {checks.map((check) => (
                <tr key={check.id} className="border-t border-surface-border align-top">
                  <td className="px-3 py-2 text-white">{check.label}</td>
                  <td className="px-3 py-2 font-mono text-xs text-gray-400">{check.command || check.id}</td>
                  <td className="px-3 py-2">
                    <StatusChipMini status={check.status} ms={check.ms} />
                  </td>
                  <td className="px-3 py-2">
                    <pre className="whitespace-pre-wrap font-mono text-xs text-gray-400">{check.detail || "—"}</pre>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  // ── Modern: rows, each carrying the check's own output under it ────────────────────────────────
  return (
    <div className="space-y-3">
      {header}
      <ul className="divide-y divide-surface-border overflow-hidden rounded-xl border border-surface-border bg-surface">
        {checks.map((check) => (
          <li key={check.id} className="p-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="text-sm font-medium text-white">{check.label}</span>
              <span className="font-mono text-[11px] text-gray-500">{check.command || check.id}</span>
              <span className="ml-auto">
                <StatusChipMini status={check.status} ms={check.ms} />
              </span>
            </div>
            <pre
              className={`mt-1.5 whitespace-pre-wrap font-mono text-[11px] leading-relaxed ${
                check.status === "fail" ? "text-alert-amber" : "text-gray-500"
              }`}
            >
              {check.detail || "no output"}
            </pre>
          </li>
        ))}
      </ul>
      <p className="text-[11px] text-gray-600">
        Every line above is the check's own output, including the failure and the one that could not run. A
        check that did not run is counted separately from one that passed.
      </p>
    </div>
  );
}

function StatusChipMini({ status, ms }: { status: HealthStatus; ms?: number | null }) {
  const label = status === "pass" ? "pass" : status === "fail" ? "fail" : "not run";
  const tone = status === "pass" ? "good" : status === "fail" ? "bad" : "warn";
  return (
    <span className="inline-flex items-center gap-1.5">
      <StateChip tone={tone}>{label}</StateChip>
      {typeof ms === "number" ? <span className="text-[10px] tabular-nums text-gray-600">{formatCount(ms)} ms</span> : null}
    </span>
  );
}
