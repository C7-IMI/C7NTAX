/**
 * The small pieces both Email Studio screens are built from.
 *
 * **These are shared by the modern and the classic arrangement, on purpose.** The repository's rule is
 * that the two arrangements are two designs rather than one design with a class toggled, and that a
 * thing which would come out identical in both belongs in a shared component with the reason written
 * down rather than left for the reader to guess. That is exactly what these are: a notice band, a
 * state chip, a key/value line and the panel a failed read draws are *facts about the message*, not
 * layouts. What differs between the interfaces is the furniture around them — a rail and rows you
 * press against a table and a dialog — and that difference lives in `EmailBrandModern` /
 * `EmailBrandClassic` and `EmailLogModern` / `EmailLogClassic`.
 *
 * Everything here is token-based (`surface`, `cyber`, `alert-*`, the themed text tokens), so all eight
 * colour schemes and both themes move it: there is no colour literal in this file.
 */
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";

export type BandTone = "info" | "warn" | "good" | "locked" | "bad" | "plain";

const BAND_TONE: Record<BandTone, string> = {
  info: "border-surface-border border-l-2 border-l-cyber-500 bg-surface-lighter",
  warn: "border-alert-amber/35 border-l-2 border-l-alert-amber bg-alert-amber/10",
  good: "border-alert-green/30 border-l-2 border-l-alert-green bg-alert-green/10",
  locked: "border-cyber-500/30 border-l-2 border-l-cyber-400 bg-cyber-600/10",
  /* `bad` is for a statement about something that does not exist or cannot be done — not for a failure. */
  bad: "border-alert-red/35 border-l-2 border-l-alert-red bg-alert-red/10",
  plain: "border-surface-border bg-surface-light",
};

/**
 * A notice that carries a fact and, where there is one, the reason beside it.
 *
 * Used for the statements the screens are built around — what the API cannot verify, what is
 * deliberately not batched, where a rule is enforced — because a sentence in a paragraph at the bottom
 * of a page is a sentence nobody acts on.
 */
export function Band({
  tone = "info",
  icon,
  title,
  children,
  right,
  className = "",
}: {
  tone?: BandTone;
  icon?: ReactNode;
  title?: ReactNode;
  children?: ReactNode;
  right?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex flex-wrap items-start gap-3 rounded-xl border px-3.5 py-2.5 ${BAND_TONE[tone]} ${className}`}>
      {icon ? <span className="mt-0.5 shrink-0">{icon}</span> : null}
      <div className="min-w-0 flex-1">
        {title ? <p className="text-xs font-semibold text-white">{title}</p> : null}
        {children ? <div className="mt-0.5 text-[11.5px] leading-relaxed text-gray-400">{children}</div> : null}
      </div>
      {right ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-1.5">{right}</div> : null}
    </div>
  );
}

export type ChipTone = "good" | "warn" | "bad" | "neutral" | "on" | "locked";

const CHIP_TONE: Record<ChipTone, string> = {
  good: "chip chip--good",
  warn: "chip chip--warn",
  bad: "chip chip--bad",
  neutral: "chip",
  on: "chip chip--on",
  /* Locked is the product's own rule rather than a warning or a failure: the accent, with a lock. */
  locked: "chip text-cyber-300",
};

/** A chip that reports a state rather than offering a filter. */
export function StateChip({ tone, children, icon }: { tone: ChipTone; children: ReactNode; icon?: ReactNode }) {
  return (
    <span className={CHIP_TONE[tone]}>
      {icon}
      {children}
    </span>
  );
}

/** The status of one message in the catalogue, in one place so both screens word it the same. */
export function MessageStatusChip({ status }: { status: "live" | "written-never-sent" | "proposed" }) {
  if (status === "live") return <StateChip tone="good">live</StateChip>;
  if (status === "written-never-sent") return <StateChip tone="warn">written, never sent</StateChip>;
  return <StateChip tone="bad">proposed</StateChip>;
}

/** A message key, in the monospace the product uses for identifiers. */
export function MonoTm({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <span className={`font-mono text-[11.5px] tracking-tight text-cyber-300 ${className}`}>{children}</span>;
}

/** An identifier or a filename inside a sentence. */
export function Mono({ children }: { children: ReactNode }) {
  return <code className="font-mono text-[11px] text-gray-300">{children}</code>;
}

/** One labelled fact. The label never wraps and the value carries the sentence. */
export function Fact({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 border-b border-surface-border/60 py-1.5 last:border-b-0">
      <span className="w-40 shrink-0 text-[11px] font-medium uppercase tracking-wide text-gray-500">{label}</span>
      <span className="min-w-0 flex-1 text-xs text-gray-300">{children}</span>
    </div>
  );
}

/**
 * What a panel draws when its read did not arrive.
 *
 * Not an `EmptyState`: an empty state says "there is nothing here", and this screen exists to refuse
 * that answer. This says what could not be read — the read's own sentence — and offers the retry, so
 * a panel that cannot be trusted is a panel that has said so. The same component is used on both
 * screens in both interfaces; see the note at the top of this file.
 */
export function UnavailablePanel({
  message,
  onRetry,
  what,
  className = "",
}: {
  message: string;
  onRetry?: () => void;
  /** What to go and look at instead, where the screen has something honest to offer. */
  what?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`rounded-xl border border-alert-amber/40 bg-alert-amber/10 p-4 ${className}`}>
      <div className="flex flex-wrap items-start gap-3">
        <AlertTriangle size={16} className="mt-0.5 shrink-0 text-alert-amber" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-white">This could not be read</p>
          <p className="mt-1 text-xs text-gray-400">{message}</p>
          {what ? <div className="mt-2 text-[11.5px] leading-relaxed text-gray-400">{what}</div> : null}
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

/** A placeholder for a panel whose read is in flight, so a slow panel is visibly a panel. */
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

/**
 * The sentence a write that could not be saved prints.
 *
 * It names the state the form is now in rather than only the failure, because the question a person
 * has after a refused save is "so did it save?".
 */
export function WriteFailure({ message }: { message: string }) {
  return (
    <p className="rounded-lg border border-alert-amber/40 bg-alert-amber/10 px-3 py-2 text-[11.5px] text-gray-300">
      {message} Nothing was saved, and the value shown is the one that was there before.
    </p>
  );
}

/** "3 rows" / "1 row", so a countable sentence stays a sentence. */
export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`;
}
