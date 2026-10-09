/**
 * The vocabulary the whole screen shares: the five states, drawn the same way wherever they appear.
 *
 * Two things live here and are shared by **both** interfaces on purpose, which the repository's
 * two-designs rule normally discourages:
 *
 *   · the **state chip** and the **five-state legend** are the screen's vocabulary, not its furniture.
 *     A "blocked" that looked red on the track and grey in the form would be two designs of the same
 *     *word*, which is the one thing the rule asks to be shared; and
 *   · the **"could not read" panel**, whose two arrangements are genuinely different — see the comment
 *     on it below.
 *
 * The colours are the application's own chips (`.chip--good`, `.chip--warn`, `.chip--bad`) plus the
 * token classes for the two states that have no existing chip: `decision` borrows the cyber accent, and
 * `unverified` is drawn with a **dashed** border and the muted text token, so it cannot be mistaken for
 * a shade of green at a glance — which is the failure this screen exists to avoid.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Ban, Check, EyeOff, RotateCcw, Scale } from "lucide-react";
import { useRedesign } from "../../hooks/useNavigationStyle";
import { type DeploymentStateKey, STATE_LEGEND, STATE_LABEL } from "./deploymentContract";

const CHIP_CLASS: Record<DeploymentStateKey, string> = {
  done: "chip chip--good",
  attention: "chip chip--warn",
  blocked: "chip chip--bad",
  decision: "chip text-cyber-300 border-cyber-500/45 bg-cyber-600/20",
  unverified: "chip border-dashed text-gray-500",
};

const ICON_CLASS: Record<DeploymentStateKey, string> = {
  done: "text-emerald-400",
  attention: "text-amber-400",
  blocked: "text-red-400",
  decision: "text-cyber-300",
  unverified: "text-gray-500",
};

/** The left edge a step card carries, so the track is scannable before any text is read. */
export const STEP_EDGE_CLASS: Record<DeploymentStateKey, string> = {
  done: "border-l-[3px] border-l-emerald-500/70",
  attention: "border-l-[3px] border-l-amber-500/70",
  blocked: "border-l-[3px] border-l-red-500/70",
  decision: "border-l-[3px] border-l-cyber-500/70",
  unverified: "border-l-[3px] border-l-dashed border-l-gray-500/60",
};

export function StateIcon({ state, size = 12 }: { state: DeploymentStateKey; size?: number }) {
  const className = ICON_CLASS[state];
  if (state === "done") return <Check size={size} className={className} aria-hidden />;
  if (state === "attention") return <AlertTriangle size={size} className={className} aria-hidden />;
  if (state === "blocked") return <Ban size={size} className={className} aria-hidden />;
  if (state === "decision") return <Scale size={size} className={className} aria-hidden />;
  return <EyeOff size={size} className={className} aria-hidden />;
}

/**
 * One of the five states, as a chip. `label` is for the places that need to say something the state
 * cannot ("2 placeholders", "not deployed", "runner unverified") — the state keeps its own colour and
 * the extra words ride beside it rather than replacing it.
 */
export function StateChip({ state, label }: { state: DeploymentStateKey; label?: string }) {
  return (
    <span className={CHIP_CLASS[state]}>
      <StateIcon state={state} />
      {label ?? STATE_LABEL[state]}
    </span>
  );
}

/** A count of one state, as the headers of the checklist and the step dialog use them. */
export function StateCountChip({ state, count }: { state: DeploymentStateKey; count: number }) {
  return (
    <span className={CHIP_CLASS[state]}>
      {count} {STATE_LABEL[state].toLowerCase()}
    </span>
  );
}

/**
 * The five states, explained once — and `unverified` drawn with the same dashed edge as the cards, so
 * "we could not check" reads as a state beside the greens rather than as a quiet absence of one.
 */
export function StateLegend() {
  return (
    <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-5">
      {STATE_LEGEND.map((entry) => (
        <div
          key={entry.key}
          className={`flex items-start gap-2.5 rounded-lg border border-surface-border bg-surface-light p-3 ${STEP_EDGE_CLASS[entry.key]}`}
        >
          <span className={`mt-0.5 shrink-0 ${ICON_CLASS[entry.key]}`}>
            <StateIcon state={entry.key} size={16} />
          </span>
          <div>
            <p className="text-xs font-semibold text-white">{entry.label}</p>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">{entry.blurb}</p>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * The panel that says what could not be read.
 *
 * Two arrangements, because they answer the question in the two vocabularies the repository keeps:
 * the **modern** one leads with a sentence and puts the way out beside it ("nothing here is a pass —
 * read it again"), and the **classic** one is an alert block with a heading, a bulleted list of the
 * failed reads and a Retry button in a row of its own. Neither is a restyle of the other; the shared
 * part is the error text and the retry handler.
 */
export function DeploymentUnreadPanel({
  error,
  unreadable,
  onRetry,
  retrying,
}: {
  error: string | null;
  unreadable: string[];
  onRetry: () => void;
  retrying: boolean;
}) {
  const redesign = useRedesign();
  const readAgain = (
    <button type="button" onClick={onRetry} disabled={retrying} className="btn-secondary inline-flex items-center gap-1.5 disabled:opacity-50">
      <RotateCcw size={13} className={retrying ? "animate-spin" : undefined} />
      {retrying ? "Reading…" : "Read it again"}
    </button>
  );

  if (redesign) {
    return (
      <div className="card border-amber-500/40 bg-amber-500/[0.06]">
        <div className="flex flex-wrap items-start gap-3">
          <span className="text-amber-400 shrink-0 mt-0.5">
            <AlertTriangle size={16} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-white">This screen has not read the deployment state</p>
            <p className="mt-1 text-xs leading-relaxed text-gray-400">
              {error ?? "The deployment state could not be read."} Nothing below is a pass: every step is drawn as
              <span className="text-gray-300"> could not verify </span>
              because no verdict was read, and no check is shown as having run.
            </p>
          </div>
          {readAgain}
        </div>
      </div>
    );
  }

  return (
    <div className="card border border-amber-500/40 bg-amber-500/[0.06]">
      <h3 className="text-sm font-semibold text-white">Could not read the deployment state</h3>
      <p className="mt-1 text-xs text-gray-400">
        {error ?? "The deployment state could not be read."} A check that could not run is never drawn as a pass, so
        every step on this page is shown as <em>could not verify</em>.
      </p>
      {unreadable.length > 0 && (
        <ul className="mt-3 space-y-1 list-disc pl-5 text-xs text-gray-400">
          {unreadable.map((entry) => (
            <li key={entry}>{entry}</li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex justify-end">{readAgain}</div>
    </div>
  );
}

/** A labelled value as the modern screen writes one: the label above, the value under it. */
export function LabelledValue({ label, value, mono = true }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className={`mt-0.5 text-xs text-white break-words ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}
