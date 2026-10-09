import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * The three small pieces every Developer screen shares: the honest read notice, the state chip and the
 * figure. They live here rather than in each page because the section's whole claim is that a failed
 * read, a refused action and a `skip` look and read the same wherever they appear.
 */

/**
 * What a panel draws when its read did not arrive.
 *
 * It is not an `EmptyState`: an empty state says "there is nothing here", and these screens exist to
 * refuse that answer. This says *what could not be read* — the `message` is the read's own sentence —
 * and offers the retry, so a panel that cannot be trusted is a panel that has said so.
 */
export function UnavailablePanel({
  message,
  onRetry,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-alert-amber/40 bg-alert-amber/10 p-4 ${className}`}>
      <div className="flex items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alert-amber" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">This could not be read</p>
          <p className="mt-1 text-xs text-gray-400">{message}</p>
        </div>
        {onRetry ? (
          <button type="button" onClick={onRetry} className="btn-secondary flex shrink-0 items-center gap-1.5 !px-2.5 !py-1.5 text-xs">
            <RefreshCw size={12} />
            Retry
          </button>
        ) : null}
      </div>
    </div>
  );
}

/** A square placeholder while a read is in flight, so a slow panel is visibly a panel. */
export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="rounded-xl border border-surface-border bg-surface p-4">
      <div className="flex items-center gap-2 text-xs text-gray-500">
        <RefreshCw size={12} className="animate-spin" />
        Reading {label}…
      </div>
    </div>
  );
}

export type ChipTone = "good" | "warn" | "bad" | "neutral" | "cyber";

const CHIP_CLASS: Record<ChipTone, string> = {
  good: "chip chip--good",
  warn: "chip chip--warn",
  bad: "chip chip--bad",
  neutral: "chip",
  cyber: "chip chip--on",
};

/** A chip that reports a state rather than offering a filter. */
export function StateChip({ tone, children }: { tone: ChipTone; children: ReactNode }) {
  return <span className={CHIP_CLASS[tone]}>{children}</span>;
}

/** Group a number so a figure read on the screen can be checked against the one in the dry run. */
export function formatCount(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US");
}

/** "3 tables" / "1 table", so the countable sentences stay sentences. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${formatCount(n)} ${n === 1 ? one : many}`;
}
