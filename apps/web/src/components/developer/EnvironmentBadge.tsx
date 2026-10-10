import { Server } from "lucide-react";
import { useModernInterface } from "../../hooks/useNavigationStyle";
import type { Read, DeveloperEnvironment } from "./developerApi";
import { LoadingBlock, StateChip, UnavailablePanel } from "./developerUi";

/**
 * The environment badge — which instance this is.
 *
 * It is drawn from the section rather than from a page, so every screen says the same thing in the same
 * place, and it is the reason a dangerous control can refuse to arm: the badge is the fact, and the
 * control quotes it.
 *
 * Two arrangements, and they are deliberately not the same arrangement:
 *
 *   · **Modern** is a *band* across the top of the page — one line of consequence, the state as a chip,
 *     the host beside it. A band is something you read on the way in; it is not a field you fill in.
 *   · **Classic** is a **labelled field** in the page's own field grid — `Environment: development (not
 *     production)` — which is what every classic screen does with a fact it wants you to have seen.
 *     The classic page draws it where its header used to, and the fact is identical in both.
 *
 * A read that failed is a band too, and an amber one: the badge is the *only* entry in the catalogue
 * whose failure the section must not hide, because it is what every other refusal quotes.
 */
export function EnvironmentBadge({ read }: { read: Read<DeveloperEnvironment> }) {
  const modern = useModernInterface();

  if (read.status === "loading") {
    if (modern) return <LoadingBlock label="the environment badge" />;
    return (
      <div className="rounded-lg border border-surface-border bg-surface-light px-4 py-3">
        <p className="text-sm text-gray-500">Reading the environment badge…</p>
      </div>
    );
  }

  if (read.status === "unavailable" || !read.data?.badge) {
    const message = read.message ?? "The environment badge could not be read, so this page cannot say which instance it is.";
    if (modern) return <UnavailablePanel message={message} onRetry={read.reload} />;
    return (
      <div className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-4 py-3">
        <p className="text-sm text-white">Environment: <span className="text-alert-amber">could not be read</span></p>
        <p className="mt-1 text-xs text-gray-400">{message}</p>
        <button type="button" onClick={read.reload} className="btn-secondary mt-2 !px-2.5 !py-1 text-xs">Retry</button>
      </div>
    );
  }

  const badge = read.data.badge;
  const place = badge.host
    ? `${badge.host}${badge.port ? `:${badge.port}` : ""}`
    : "host not reported";

  // ── Classic: the fact as a labelled field, the way every classic screen states a fact ──────────
  if (!modern) {
    return (
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
        <div className="flex gap-2 text-sm">
          <dt className="text-gray-400">Environment:</dt>
          <dd className="text-white">
            {badge.nodeEnv}
            {badge.isProduction ? " (production)" : " (not production)"}
          </dd>
        </div>
        <div className="flex gap-2 text-sm">
          <dt className="text-gray-400">Instance:</dt>
          <dd className="font-mono text-xs text-gray-300">{place}</dd>
        </div>
      </dl>
    );
  }

  // ── Modern: a band carrying one line of consequence, the state as a chip ───────────────────────
  const tone = badge.isProduction ? "bad" : "good";
  return (
    <div
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border px-4 py-3 ${
        badge.isProduction ? "border-alert-red/40 bg-alert-red/10" : "border-alert-amber/40 bg-alert-amber/10"
      }`}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-surface-lighter text-cyber-400">
        <Server size={16} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-white">
          {badge.isProduction ? "Production" : "Not production"} — this instance is running{" "}
          <span className="font-mono text-xs">NODE_ENV={badge.nodeEnv}</span>
        </p>
        <p className="mt-0.5 text-xs text-gray-400">
          {badge.isProduction
            ? "The irreversible controls in this section will not arm here."
            : "The irreversible controls arm here; the section says so on every screen."}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <StateChip tone={tone}>{badge.nodeEnv.toUpperCase()}</StateChip>
        <span className="chip font-mono text-gray-300">{place}</span>
        {badge.version ? <span className="chip text-gray-400">v{badge.version}</span> : null}
      </div>
    </div>
  );
}
